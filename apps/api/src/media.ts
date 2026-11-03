import {createHash,randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import type {createAuth} from './auth.js';
import type {createDatabase} from '@glitch/db';
import {verifyStreamWebhook,type MediaProvider,type StreamStatus} from './media-provider.js';

const id=z.uuid();
const videoInput=z.object({unitVersionId:id,idempotencyKey:id,maxDurationSeconds:z.int().min(1).max(36000)});
const resourceInput=z.object({unitVersionId:id.optional(),enrollmentId:id.optional(),idempotencyKey:id,mimeType:z.enum(['application/pdf','image/png','image/jpeg','image/webp','text/plain','application/zip']),sizeBytes:z.int().min(1).max(25*1024*1024)});
const failure=(reply:FastifyReply,status:number,code:string,message:string)=>reply.code(status).send({code,message});
const unavailable=(reply:FastifyReply)=>failure(reply,503,'MEDIA_UNAVAILABLE','Media provider is not configured');
type DB=ReturnType<typeof createDatabase>;
type Auth=ReturnType<typeof createAuth>;

export function registerMediaRoutes(app:FastifyInstance,database:DB,auth:Auth,provider:MediaProvider|null,webhookSecret?:string,clock:()=>number=Date.now){
 const {pool}=database;
 async function actor(request:FastifyRequest,reply:FastifyReply){const session=await auth.api.getSession({headers:fromNodeHeaders(request.headers)});if(!session){failure(reply,401,'UNAUTHENTICATED','Sign in to continue');return null;}return session.user.id;}
 async function admin(request:FastifyRequest,reply:FastifyReply){const who=await actor(request,reply);if(!who)return null;const role=await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role IN ('super_admin','content_admin')",[who]);if(!role.rowCount){failure(reply,403,'FORBIDDEN','Media administration permission required');return null;}return who;}
 async function providerCall<T>(reply:FastifyReply,action:()=>Promise<T>):Promise<T|null>{try{return await action();}catch(error){requestLog(reply,error);failure(reply,502,'MEDIA_PROVIDER_ERROR','Media provider is unavailable');return null;}}
 function requestLog(reply:FastifyReply,error:unknown){reply.log.error({err:error},'Media provider operation failed');}

 app.post('/api/v1/admin/media/videos/uploads',async(request,reply)=>{
  const who=await admin(request,reply);if(!who)return;
  if(!provider)return unavailable(reply);
  const parsed=videoInput.safeParse(request.body);if(!parsed.success)return failure(reply,422,'INVALID_INPUT','Invalid video upload');
  const input=parsed.data,client=await pool.connect();
  try{
   await client.query('BEGIN');
   const version=await client.query("SELECT v.id FROM learning_unit_versions v JOIN learning_units u ON u.id=v.unit_id WHERE v.id=$1 AND u.kind='video' AND v.publication_state IN ('draft','ready_for_review')",[input.unitVersionId]);
   if(!version.rowCount){await client.query('ROLLBACK');return failure(reply,422,'INVALID_INPUT','Editable video unit version required');}
   const inserted=await client.query("INSERT INTO media_assets(kind,state,unit_version_id,created_by,idempotency_key,max_duration_seconds) VALUES('stream_video','pending_upload',$1,$2,$3,$4) ON CONFLICT(created_by,idempotency_key) DO NOTHING RETURNING id",[input.unitVersionId,who,input.idempotencyKey,input.maxDurationSeconds]);
   const asset=await client.query('SELECT * FROM media_assets WHERE created_by=$1 AND idempotency_key=$2 FOR UPDATE',[who,input.idempotencyKey]);const row=asset.rows[0];
   if(row.kind!=='stream_video'||row.unit_version_id!==input.unitVersionId||row.max_duration_seconds!==input.maxDurationSeconds){await client.query('ROLLBACK');return failure(reply,409,'CONFLICT','Idempotency key belongs to another upload');}
   if(!inserted.rowCount){
    if(row.state==='pending_upload'&&(!row.upload_expires_at||new Date(row.upload_expires_at).getTime()<=clock())){
     if((await client.query('SELECT 1 FROM release_unit_media WHERE asset_id=$1',[row.id])).rowCount){await client.query('ROLLBACK');return failure(reply,409,'CONFLICT','Published video cannot be replaced');}
     const expiry=new Date(clock()+15*60_000),renewed=await providerCall(reply,()=>provider.createStreamUpload({assetId:row.id,maxDurationSeconds:row.max_duration_seconds,expiresAt:expiry}));if(!renewed){await client.query('ROLLBACK');return;}
     await client.query("UPDATE media_assets SET provider_id=$1,upload_url=$2,upload_expires_at=$3,upload_attempt=upload_attempt+1,updated_at=now() WHERE id=$4",[renewed.uid,renewed.uploadUrl,expiry,row.id]);await client.query('COMMIT');reply.header('Cache-Control','no-store');return reply.code(200).send({id:row.id,state:'pending_upload',uploadUrl:renewed.uploadUrl,expiresAt:expiry.toISOString(),attempt:row.upload_attempt+1});
    }
    await client.query('COMMIT');reply.header('Cache-Control','no-store');return reply.code(200).send({id:row.id,state:row.state,uploadUrl:row.state==='pending_upload'?row.upload_url:null,expiresAt:row.state==='pending_upload'?row.upload_expires_at:null,attempt:row.upload_attempt});
   }
   const expiry=new Date(clock()+15*60_000),created=await providerCall(reply,()=>provider.createStreamUpload({assetId:row.id,maxDurationSeconds:input.maxDurationSeconds,expiresAt:expiry}));
   if(!created){await client.query('ROLLBACK');return;}
   await client.query('UPDATE media_assets SET provider_id=$1,upload_url=$2,upload_expires_at=$3,updated_at=now() WHERE id=$4',[created.uid,created.uploadUrl,expiry,row.id]);
   await client.query('COMMIT');reply.header('Cache-Control','no-store');return reply.code(201).send({id:row.id,state:'pending_upload',uploadUrl:created.uploadUrl,expiresAt:expiry.toISOString(),attempt:1});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });

 app.get<{Params:{id:string}}>('/api/v1/admin/media/:id',async(request,reply)=>{
  const who=await admin(request,reply);if(!who)return;if(!id.safeParse(request.params.id).success)return failure(reply,404,'NOT_FOUND','Media not found');
  const r=await pool.query("SELECT id,kind,state,unit_version_id,mime_type,size_bytes,duration_seconds,failure_reason,upload_attempt,created_at,updated_at FROM media_assets WHERE id=$1 AND kind IN ('stream_video','r2_resource')",[request.params.id]);
  if(!r.rowCount)return failure(reply,404,'NOT_FOUND','Media not found');return r.rows[0];
 });

 async function updateStream(uid:string,status:StreamStatus){
  if(status.uid!==uid)return;
  const next=status.state==='ready'&&status.readyToStream&&status.durationSeconds?'ready':status.state==='failed'?'failed':'processing';
  await pool.query(`UPDATE media_assets SET state=CASE WHEN $1='ready' AND $2>max_duration_seconds THEN 'failed' ELSE $1 END,duration_seconds=CASE WHEN $1='ready' AND $2<=max_duration_seconds THEN $2 ELSE duration_seconds END,failure_reason=CASE WHEN $1='ready' AND $2>max_duration_seconds THEN 'Duration exceeds limit' ELSE $3 END,upload_url=NULL,updated_at=now() WHERE provider_id=$4 AND kind='stream_video' AND state NOT IN ('revoked','ready')`,[next,status.durationSeconds??null,status.error??null,uid]);
 }
 app.post<{Params:{id:string}}>('/api/v1/admin/media/:id/sync',async(request,reply)=>{
  const who=await admin(request,reply);if(!who)return;if(!provider)return unavailable(reply);if(!id.safeParse(request.params.id).success)return failure(reply,404,'NOT_FOUND','Media not found');
  const r=await pool.query("SELECT provider_id FROM media_assets WHERE id=$1 AND kind='stream_video'",[request.params.id]);if(!r.rowCount||!r.rows[0].provider_id)return failure(reply,404,'NOT_FOUND','Media not found');
  const status=await providerCall(reply,()=>provider.streamStatus(r.rows[0].provider_id));if(!status)return;await updateStream(r.rows[0].provider_id,status);
  const updated=await pool.query('SELECT id,state,duration_seconds,failure_reason,upload_attempt FROM media_assets WHERE id=$1',[request.params.id]);return updated.rows[0];
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/media/:id/retry',async(request,reply)=>{
  const who=await admin(request,reply);if(!who)return;if(!provider)return unavailable(reply);if(!id.safeParse(request.params.id).success)return failure(reply,404,'NOT_FOUND','Media not found');
  const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query("SELECT * FROM media_assets WHERE id=$1 AND kind='stream_video' FOR UPDATE",[request.params.id]);const row=q.rows[0];if(!row){await client.query('ROLLBACK');return failure(reply,404,'NOT_FOUND','Media not found');}const expired=row.state==='pending_upload'&&(!row.upload_expires_at||new Date(row.upload_expires_at).getTime()<=clock());const abandoned=row.state==='processing'&&new Date(row.updated_at).getTime()+60*60_000<=clock();
   const editable=await client.query("SELECT 1 FROM learning_unit_versions WHERE id=$1 AND publication_state IN ('draft','ready_for_review')",[row.unit_version_id]);
   if(!editable.rowCount||!(row.state==='failed'||expired||abandoned)||(await client.query('SELECT 1 FROM release_unit_media WHERE asset_id=$1',[row.id])).rowCount){await client.query('ROLLBACK');return failure(reply,409,'CONFLICT','Only failed, expired or abandoned unpublished videos can be retried');}
   const expiry=new Date(clock()+15*60_000),created=await providerCall(reply,()=>provider.createStreamUpload({assetId:row.id,maxDurationSeconds:row.max_duration_seconds,expiresAt:expiry}));if(!created){await client.query('ROLLBACK');return;}
   await client.query("UPDATE media_assets SET state='pending_upload',provider_id=$1,upload_url=$2,upload_expires_at=$3,duration_seconds=NULL,failure_reason=NULL,upload_attempt=upload_attempt+1,updated_at=now() WHERE id=$4",[created.uid,created.uploadUrl,expiry,row.id]);await client.query('COMMIT');reply.header('Cache-Control','no-store');return {id:row.id,state:'pending_upload',attempt:row.upload_attempt+1,uploadUrl:created.uploadUrl,expiresAt:expiry.toISOString()};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/media/:id/revoke',async(request,reply)=>{
  const who=await admin(request,reply);if(!who)return;if(!id.safeParse(request.params.id).success)return failure(reply,404,'NOT_FOUND','Media not found');
  const q=await pool.query("UPDATE media_assets SET state='revoked',upload_url=NULL,updated_at=now() WHERE id=$1 AND kind IN ('stream_video','r2_resource') RETURNING id,kind,object_key,state",[request.params.id]);const row=q.rows[0];if(!row)return failure(reply,404,'NOT_FOUND','Media not found');
  if(row.object_key&&provider){try{await provider.r2Delete(row.object_key);}catch(error){requestLog(reply,error);return failure(reply,502,'MEDIA_PROVIDER_ERROR','Resource was revoked but object deletion needs retry');}}
  return {id:row.id,state:row.state};
 });

 app.post('/api/v1/media/resources/uploads',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!provider)return unavailable(reply);const parsed=resourceInput.safeParse(request.body);if(!parsed.success||Boolean(parsed.data?.unitVersionId)===Boolean(parsed.data?.enrollmentId))return failure(reply,422,'INVALID_INPUT','Exactly one resource scope is required');
  const input=parsed.data;let kind:'r2_resource'|'r2_student';
  if(input.unitVersionId){kind='r2_resource';const role=await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role IN ('super_admin','content_admin')",[who]);const unit=await pool.query("SELECT 1 FROM learning_unit_versions WHERE id=$1 AND publication_state IN ('draft','ready_for_review')",[input.unitVersionId]);if(!role.rowCount)return failure(reply,403,'FORBIDDEN','Media administration permission required');if(!unit.rowCount)return failure(reply,422,'INVALID_INPUT','Editable unit version required');}
  else{kind='r2_student';const e=await pool.query("SELECT 1 FROM enrollments WHERE id=$1 AND student_id=$2 AND state='active'",[input.enrollmentId,who]);if(!e.rowCount)return failure(reply,404,'NOT_FOUND','Enrollment unavailable');}
  const key=`staging/${kind==='r2_student'?'student':'course'}/${input.enrollmentId??input.unitVersionId}/${randomUUID()}`;
  const q=await pool.query(`INSERT INTO media_assets(kind,state,unit_version_id,enrollment_id,created_by,idempotency_key,object_key,mime_type,size_bytes) VALUES($1,'pending_upload',$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(created_by,idempotency_key) DO UPDATE SET updated_at=media_assets.updated_at RETURNING *`,[kind,input.unitVersionId??null,input.enrollmentId??null,who,input.idempotencyKey,key,input.mimeType,input.sizeBytes]);const row=q.rows[0];
  if(row.kind!==kind||row.unit_version_id!==(input.unitVersionId??null)||row.enrollment_id!==(input.enrollmentId??null)||row.mime_type!==input.mimeType||Number(row.size_bytes)!==input.sizeBytes)return failure(reply,409,'CONFLICT','Idempotency key belongs to another upload');
  if(row.state==='ready')return {id:row.id,state:row.state};if(row.state!=='pending_upload')return failure(reply,409,'CONFLICT','Upload is not available');
  const url=await providerCall(reply,()=>provider.r2Upload(row.object_key,row.mime_type,Number(row.size_bytes),120));if(!url)return;reply.header('Cache-Control','no-store');return reply.code(201).send({id:row.id,state:row.state,uploadUrl:url,expiresAt:new Date(clock()+120000).toISOString()});
 });
 app.post<{Params:{id:string}}>('/api/v1/media/resources/:id/confirm',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!provider)return unavailable(reply);if(!id.safeParse(request.params.id).success)return failure(reply,404,'NOT_FOUND','Resource not found');
  const client=await pool.connect();let stagingKey:string|null=null;
  try{await client.query('BEGIN');const q=await client.query('SELECT * FROM media_assets WHERE id=$1 AND created_by=$2 AND kind IN ($3,$4) FOR UPDATE',[request.params.id,who,'r2_resource','r2_student']);const row=q.rows[0];if(!row){await client.query('ROLLBACK');return failure(reply,404,'NOT_FOUND','Resource not found');}if(row.state==='ready'){await client.query('COMMIT');return {id:row.id,state:'ready'};}if(row.state!=='pending_upload'){await client.query('ROLLBACK');return failure(reply,409,'CONFLICT','Resource cannot be confirmed');}
   const head=await providerCall(reply,()=>provider.r2Head(row.object_key));if(head===null&&reply.sent){await client.query('ROLLBACK');return;}if(!head){await client.query('ROLLBACK');return failure(reply,409,'CONFLICT','Upload not found');}
   const metadataMatches=head.sizeBytes===Number(row.size_bytes)&&head.mimeType===row.mime_type;
   const typeMatches=metadataMatches?await providerCall(reply,()=>provider.r2Validate(row.object_key,row.mime_type)):false;
   if(reply.sent){await client.query('ROLLBACK');return;}
   if(!metadataMatches||!typeMatches){await client.query("UPDATE media_assets SET state='failed',failure_reason='Object validation failed',updated_at=now() WHERE id=$1",[row.id]);await client.query('COMMIT');try{await provider.r2Delete(row.object_key);}catch(error){requestLog(reply,error);}return failure(reply,422,'INVALID_UPLOAD','Uploaded object does not match authorization');}
   const finalKey=`${row.kind==='r2_student'?'student':'course'}/${row.enrollment_id??row.unit_version_id}/${randomUUID()}`;
   const copied=await providerCall(reply,()=>provider.r2Promote(row.object_key,finalKey));if(reply.sent){await client.query('ROLLBACK');return;}
   const final=await providerCall(reply,()=>provider.r2Head(finalKey));if(reply.sent){await client.query('ROLLBACK');return;}if(!final||final.sizeBytes!==Number(row.size_bytes)||final.mimeType!==row.mime_type){await client.query('ROLLBACK');return failure(reply,502,'MEDIA_PROVIDER_ERROR','Promoted object did not match upload');}
   await client.query("UPDATE media_assets SET state='ready',object_key=$1,updated_at=now() WHERE id=$2",[finalKey,row.id]);await client.query('COMMIT');stagingKey=row.object_key;
   return {id:row.id,state:'ready'};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();if(stagingKey){try{await provider.r2Delete(stagingKey);}catch(error){requestLog(reply,error);}}}
 });
 app.get<{Params:{id:string}}>('/api/v1/media/my-resources/:id/download',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!provider)return unavailable(reply);if(!id.safeParse(request.params.id).success)return failure(reply,404,'NOT_FOUND','Resource not found');
  const r=await pool.query("SELECT a.object_key FROM media_assets a JOIN enrollments e ON e.id=a.enrollment_id WHERE a.id=$1 AND a.kind='r2_student' AND a.state='ready' AND e.student_id=$2 AND e.state='active'",[request.params.id,who]);if(!r.rowCount)return failure(reply,404,'NOT_FOUND','Resource not found');
  const url=await providerCall(reply,()=>provider.r2Download(r.rows[0].object_key,120));if(!url)return;reply.header('Cache-Control','no-store');return {url,expiresAt:new Date(clock()+120000).toISOString()};
 });
 app.register(async scope=>{
  scope.addContentTypeParser('application/json',{parseAs:'buffer'},(_request,body,done)=>done(null,body));
  scope.post('/webhooks/cloudflare/stream',async(request,reply)=>{
   if(!webhookSecret)return unavailable(reply);const body=request.body;if(!Buffer.isBuffer(body)||!verifyStreamWebhook(body,request.headers['webhook-signature'] as string|undefined,webhookSecret,clock()))return failure(reply,401,'INVALID_SIGNATURE','Webhook signature invalid or expired');
   let event:Record<string,any>;try{event=JSON.parse(body.toString('utf8'));}catch{return failure(reply,422,'INVALID_INPUT','Invalid webhook body');}
   if(typeof event.uid!=='string'||!event.uid)return failure(reply,422,'INVALID_INPUT','Video ID missing');
   const digest=createHash('sha256').update(body).digest('hex');const client=await pool.connect();try{await client.query('BEGIN');const inserted=await client.query('INSERT INTO stream_webhook_events(digest,provider_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING digest',[digest,event.uid]);if(inserted.rowCount){const status:StreamStatus={uid:event.uid,state:event.status?.state==='error'?'failed':event.readyToStream===true&&event.status?.state==='ready'?'ready':'processing',readyToStream:event.readyToStream===true,durationSeconds:Number(event.duration)>0?Math.ceil(Number(event.duration)):undefined,error:typeof event.status?.errReasonCode==='string'?event.status.errReasonCode:undefined};const next=status.state==='ready'&&status.durationSeconds?'ready':status.state==='failed'?'failed':'processing';await client.query("UPDATE media_assets SET state=CASE WHEN $1='ready' AND $2>max_duration_seconds THEN 'failed' ELSE $1 END,duration_seconds=CASE WHEN $1='ready' AND $2<=max_duration_seconds THEN $2 ELSE duration_seconds END,failure_reason=CASE WHEN $1='ready' AND $2>max_duration_seconds THEN 'Duration exceeds limit' ELSE $3 END,upload_url=NULL,updated_at=now() WHERE provider_id=$4 AND kind='stream_video' AND state NOT IN ('revoked','ready')",[next,status.durationSeconds??null,status.error??null,event.uid]);}await client.query('COMMIT');return {accepted:true,duplicate:!inserted.rowCount};}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
 });
}
