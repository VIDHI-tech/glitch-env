import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {buildApp} from '../../src/app.js';
import {CaptureMailer} from '../../src/mail.js';
import {bootstrapFirstSuperAdmin} from '../../src/bootstrap.js';
import {createDatabase,migrateDatabase} from '@glitch/db';
import type {MediaProvider,StreamStatus} from '../../src/media-provider.js';

if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required');
const base=new URL(process.env.TEST_DATABASE_URL),name=`glitch_m3_it_${process.pid}_${Math.floor(Math.random()*100000)}`;
const adminUrl=new URL(base);adminUrl.pathname='/postgres';const dbUrl=new URL(base);dbUrl.pathname=`/${name}`;
const origin='http://127.0.0.1:3002',secret='m3-webhook-secret',mailer=new CaptureMailer();
let admin:Pool,db:ReturnType<typeof createDatabase>,app:ReturnType<typeof buildApp>,now=Date.now();
const objects=new Map<string,{sizeBytes:number;mimeType:string;fingerprint?:string}>();let uploads=0,raceKey:string|null=null,rejectedOverwrite=0;
function conditionalPut(key:string,item:{sizeBytes:number;mimeType:string;fingerprint?:string}){if(objects.has(key))throw new Error('PreconditionFailed');objects.set(key,item);}
const provider:MediaProvider={
 async createStreamUpload(){uploads++;return {uid:`video-${uploads}`,uploadUrl:`https://upload.example/video-${uploads}`};},
 async streamStatus(uid){return {uid,state:'ready',readyToStream:true,durationSeconds:10};},
 async streamPlayback(uid,expiresAt){return {url:`https://stream.example/${uid}/signed`,expiresAt:expiresAt.toISOString()};},
 async r2Upload(key){return `https://r2.example/${key}?signed=put`;},
 async r2Download(key){return `https://r2.example/${key}?signed=get`;},
 async r2Head(key){return objects.get(key)??null;},
 async r2Validate(key){if(key===raceKey){try{conditionalPut(key,{sizeBytes:123,mimeType:'application/pdf',fingerprint:'attacker'});}catch{rejectedOverwrite++;}}return true;},
 async r2Promote(tempKey,finalKey){const item=objects.get(tempKey);if(!item)throw new Error('Source missing');objects.set(finalKey,item);},
 async r2Delete(key){objects.delete(key);}
};
async function req(method:string,url:string,payload?:object,cookie?:string,extra:Record<string,string>={}){return app.inject({method,url,headers:{host:'127.0.0.1:3002',...(method!=='GET'?{origin}:{}),...(cookie?{cookie}:{}),...extra},...(payload?{payload}:{})});}
const post=(url:string,payload:object,cookie?:string)=>req('POST',url,payload,cookie),get=(url:string,cookie?:string)=>req('GET',url,undefined,cookie);
async function signup(email:string){const r=await post('/api/auth/sign-up/email',{name:email,email,password:'m3-password-12345'});assert.equal(r.statusCode,200,r.body);const m=mailer.messages.findLast(x=>x.to===email&&x.subject.startsWith('Verify'));assert.ok(m);const u=new URL(m.text.split(' ').at(-1));assert.ok([200,302].includes((await get(u.pathname+u.search)).statusCode));return r.json().user.id as string;}
async function login(email:string){const r=await post('/api/auth/sign-in/email',{email,password:'m3-password-12345'});assert.equal(r.statusCode,200,r.body);return String(r.headers['set-cookie']).split(';')[0];}
function webhook(event:object,at=now,signature='valid'){const body=JSON.stringify(event),time=Math.floor(at/1000),sig=createHmac('sha256',secret).update(`${time}.${body}`).digest('hex');return app.inject({method:'POST',url:'/webhooks/cloudflare/stream',headers:{'content-type':'application/json','webhook-signature':`time=${time},sig1=${signature==='valid'?sig:'0'.repeat(64)}`},payload:body});}
before(async()=>{admin=new Pool({connectionString:adminUrl.toString()});await admin.query(`CREATE DATABASE ${name}`);db=createDatabase(dbUrl.toString());await migrateDatabase(db,resolve(process.cwd(),'../../packages/db/migrations'));app=buildApp({databaseUrl:dbUrl.toString(),origin,secret:'m3-test-only-better-auth-secret-minimum-32-characters',mailer,clock:()=>now,mediaProvider:provider,webhookSecret:secret});});
after(async()=>{await app?.close();await db?.pool.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();}});

test('M3 private media lifecycle and M2 progression',async t=>{
 const suffix=randomUUID(),rootEmail=`root-${suffix}@example.test`,aEmail=`a-${suffix}@example.test`,bEmail=`b-${suffix}@example.test`;
 const root=await signup(rootEmail),a=await signup(aEmail),b=await signup(bEmail);const rootCookie=await login(rootEmail),aCookie=await login(aEmail),bCookie=await login(bEmail);await bootstrapFirstSuperAdmin(db.pool,rootEmail);
 const course=(await post('/api/v1/admin/courses',{title:'M3 Media Course'},rootCookie)).json().id;
 const week=(await db.pool.query('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[course,'Week'])).rows[0].id;
 const day=(await db.pool.query('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[week,'Day'])).rows[0].id;
 const chapter=(await db.pool.query('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[day,'Chapter'])).rows[0].id;
 const videoUnit=(await db.pool.query("INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,1,'video') RETURNING id",[chapter])).rows[0].id;
 const otherUnit=(await db.pool.query("INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,2,'reflection') RETURNING id",[chapter])).rows[0].id;
 const version=(await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,'Video','ready_for_review') RETURNING id",[videoUnit])).rows[0].id;
 const otherVersion=(await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,'Reflection','ready_for_review') RETURNING id",[otherUnit])).rows[0].id;
 let videoId='',resourceId='',orphanId='',releaseId='',unitId='',otherId='',aEnrollment='',bEnrollment='';
 await t.test('admin only, scoped uploads, idempotency, signature and replay',async()=>{
  const input={unitVersionId:version,idempotencyKey:randomUUID(),maxDurationSeconds:10};
  assert.equal((await post('/api/v1/admin/media/videos/uploads',input,aCookie)).statusCode,403);
  const first=await post('/api/v1/admin/media/videos/uploads',input,rootCookie);assert.equal(first.statusCode,201,first.body);videoId=first.json().id;
  const dup=await post('/api/v1/admin/media/videos/uploads',input,rootCookie);assert.equal(dup.statusCode,200,dup.body);assert.equal(uploads,1);assert.equal(dup.json().uploadUrl,first.json().uploadUrl);
  assert.equal((await post('/api/v1/admin/media/videos/uploads',{...input,maxDurationSeconds:11},rootCookie)).statusCode,409);
  const failed={uid:'video-1',status:{state:'error',errReasonCode:'encoding_failed'},readyToStream:false};
  assert.equal((await webhook(failed,now,'invalid')).statusCode,401);
  assert.equal((await webhook(failed,now-400000)).statusCode,401);
  assert.equal((await webhook(failed)).statusCode,200);
  assert.equal((await webhook(failed)).json().duplicate,true);
  assert.equal((await get(`/api/v1/admin/media/${videoId}`,rootCookie)).json().state,'failed');
  const retry=await post(`/api/v1/admin/media/${videoId}/retry`,{},rootCookie);assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().attempt,2);
  await webhook(failed);assert.equal((await get(`/api/v1/admin/media/${videoId}`,rootCookie)).json().state,'pending_upload');
  const ready={uid:'video-2',status:{state:'ready'},readyToStream:true,duration:10};assert.equal((await webhook(ready)).statusCode,200);
  assert.equal((await webhook(ready)).json().duplicate,true);
  const state=(await get(`/api/v1/admin/media/${videoId}`,rootCookie)).json();assert.equal(state.state,'ready');assert.equal(state.duration_seconds,10);
  assert.equal((await post(`/api/v1/admin/media/${videoId}/retry`,{},rootCookie)).statusCode,409);
 });
 await t.test('expired and abandoned Stream uploads recover without reusing a URL',async()=>{
  const altVersion=(await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,2,'Alternate','ready_for_review') RETURNING id",[videoUnit])).rows[0].id;
  const input={unitVersionId:altVersion,idempotencyKey:randomUUID(),maxDurationSeconds:10};
  const first=await post('/api/v1/admin/media/videos/uploads',input,rootCookie);assert.equal(first.statusCode,201,first.body);
  const oldUrl=first.json().uploadUrl,oldUid=`video-${uploads}`;now+=15*60_000+1;
  const renewed=await post('/api/v1/admin/media/videos/uploads',input,rootCookie);assert.equal(renewed.statusCode,200,renewed.body);assert.notEqual(renewed.json().uploadUrl,oldUrl);assert.equal(renewed.json().attempt,2);
  await webhook({uid:oldUid,status:{state:'ready'},readyToStream:true,duration:10});assert.equal((await get(`/api/v1/admin/media/${first.json().id}`,rootCookie)).json().state,'pending_upload');
  const currentUid=`video-${uploads}`;await webhook({uid:currentUid,status:{state:'inprogress'},readyToStream:false});
  now+=60*60_000+1;const retry=await post(`/api/v1/admin/media/${first.json().id}/retry`,{},rootCookie);assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().attempt,3);assert.notEqual(retry.json().uploadUrl,renewed.json().uploadUrl);
  await webhook({uid:currentUid,status:{state:'ready'},readyToStream:true,duration:10});assert.equal((await get(`/api/v1/admin/media/${first.json().id}`,rootCookie)).json().state,'pending_upload');
 });
 await t.test('R2 metadata, size and type validation',async()=>{
  const input={unitVersionId:version,idempotencyKey:randomUUID(),mimeType:'application/pdf',sizeBytes:123};
  assert.equal((await post('/api/v1/media/resources/uploads',{...input,mimeType:'application/x-executable'},rootCookie)).statusCode,422);
  assert.equal((await post('/api/v1/media/resources/uploads',{...input,sizeBytes:30*1024*1024},rootCookie)).statusCode,422);
  const upload=await post('/api/v1/media/resources/uploads',input,rootCookie);assert.equal(upload.statusCode,201,upload.body);resourceId=upload.json().id;
  assert.equal((await post('/api/v1/media/resources/uploads',input,rootCookie)).json().id,resourceId);
  assert.equal((await post(`/api/v1/media/resources/${resourceId}/confirm`,{},rootCookie)).statusCode,409);
  const key=(await db.pool.query('SELECT object_key FROM media_assets WHERE id=$1',[resourceId])).rows[0].object_key;assert.ok(key.startsWith('staging/course/'));
  conditionalPut(key,{sizeBytes:123,mimeType:'application/pdf',fingerprint:'validated'});raceKey=key;
  assert.equal((await post(`/api/v1/media/resources/${resourceId}/confirm`,{},rootCookie)).statusCode,200);raceKey=null;assert.equal(rejectedOverwrite,1);assert.equal(objects.has(key),false);const finalKey=(await db.pool.query('SELECT object_key FROM media_assets WHERE id=$1',[resourceId])).rows[0].object_key;assert.equal(objects.get(finalKey)?.fingerprint,'validated');
  assert.equal((await post(`/api/v1/media/resources/${resourceId}/confirm`,{},rootCookie)).statusCode,200);
  const badInput={unitVersionId:otherVersion,idempotencyKey:randomUUID(),mimeType:'image/png',sizeBytes:50};const bad=(await post('/api/v1/media/resources/uploads',badInput,rootCookie)).json();const badKey=(await db.pool.query('SELECT object_key FROM media_assets WHERE id=$1',[bad.id])).rows[0].object_key;objects.set(badKey,{sizeBytes:40,mimeType:'image/png'});assert.equal((await post(`/api/v1/media/resources/${bad.id}/confirm`,{},rootCookie)).statusCode,422);assert.equal(objects.has(badKey),false);
  const orphan=(await post('/api/v1/media/resources/uploads',{unitVersionId:otherVersion,idempotencyKey:randomUUID(),mimeType:'application/pdf',sizeBytes:10},rootCookie)).json();orphanId=orphan.id;const orphanKey=(await db.pool.query('SELECT object_key FROM media_assets WHERE id=$1',[orphanId])).rows[0].object_key;objects.set(orphanKey,{sizeBytes:10,mimeType:'application/pdf'});assert.equal((await post(`/api/v1/media/resources/${orphanId}/confirm`,{},rootCookie)).statusCode,200);
 });
 await t.test('publication pins ready media and rejects unassigned or mutable references',async()=>{
  const wrong=await post(`/api/v1/admin/courses/${course}/releases`,{units:[{unitVersionId:otherVersion,mediaAssetIds:[videoId],durationSeconds:10}]},rootCookie);assert.equal(wrong.statusCode,422,wrong.body);
  const published=await post(`/api/v1/admin/courses/${course}/releases`,{units:[{unitVersionId:version,mediaAssetIds:[videoId,resourceId]},{unitVersionId:otherVersion}]},rootCookie);assert.equal(published.statusCode,201,published.body);releaseId=published.json().id;[unitId,otherId]=published.json().unitIds;
  const duration=(await db.pool.query('SELECT duration_seconds FROM curriculum_release_units WHERE id=$1',[unitId])).rows[0].duration_seconds;assert.equal(duration,10);
  await assert.rejects(db.pool.query('UPDATE media_assets SET provider_id=$1 WHERE id=$2',['tampered',videoId]));
  await assert.rejects(db.pool.query("UPDATE media_assets SET state='processing' WHERE id=$1",[videoId]));
  await assert.rejects(db.pool.query('DELETE FROM release_unit_media WHERE release_unit_id=$1 AND asset_id=$2',[unitId,videoId]));
  await assert.rejects(db.pool.query('INSERT INTO release_unit_media(release_unit_id,asset_id) VALUES($1,$2)',[otherId,resourceId]));
  assert.equal((await post(`/api/v1/admin/media/${videoId}/retry`,{},rootCookie)).statusCode,409);
  const ae=await post('/api/v1/admin/enrollments',{studentId:a,courseId:course},rootCookie),be=await post('/api/v1/admin/enrollments',{studentId:b,courseId:course},rootCookie);assert.equal(ae.statusCode,201,ae.body);assert.equal(be.statusCode,201,be.body);aEnrollment=ae.json().id;bEnrollment=be.json().id;
 });
 await t.test('playback and resources are pinned, private, and time limited',async()=>{
  assert.equal((await get(`/api/v1/release-units/${unitId}/resources`,undefined)).statusCode,401);
  assert.equal((await get(`/api/v1/release-units/${otherId}`,aCookie)).statusCode,404);
  const start=await post(`/api/v1/release-units/${unitId}/video-sessions`,{},aCookie);assert.equal(start.statusCode,201,start.body);assert.equal(start.json().adapter,'cloudflare-stream');const session=start.json().id;
  assert.equal((await post(`/api/v1/video-sessions/${session}/playback`,{},bCookie)).statusCode,404);
  const authorized=await post(`/api/v1/video-sessions/${session}/playback`,{},aCookie);assert.equal(authorized.statusCode,200,authorized.body);assert.ok(authorized.json().url.includes('video-2'));
  assert.equal((await get(`/api/v1/release-units/${unitId}/resources`,aCookie)).json()[0].id,resourceId);
  assert.equal((await get(`/api/v1/release-units/${unitId}/resources/${resourceId}/download`,aCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${otherId}/resources/${resourceId}/download`,aCookie)).statusCode,404);
  now+=121000;assert.equal((await post(`/api/v1/video-sessions/${session}/events`,{positionSeconds:2,type:'heartbeat'},aCookie)).statusCode,403);
  assert.equal((await post(`/api/v1/video-sessions/${session}/playback`,{},aCookie)).statusCode,200);
  await post(`/api/v1/video-sessions/${session}/events`,{positionSeconds:0,type:'seek'},aCookie);
  for(const pos of [2,4,6,8,10]){now+=2000;const event=await post(`/api/v1/video-sessions/${session}/events`,{positionSeconds:pos,type:pos===10?'end':'heartbeat'},aCookie);assert.equal(event.statusCode,200,event.body);}
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json().completedRequired,1);
  assert.equal((await get(`/api/v1/enrollments/${bEnrollment}/roadmap`,bCookie)).json().completedRequired,0);
  assert.equal((await get(`/api/v1/release-units/${otherId}`,aCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${otherId}/resources/${orphanId}/download`,aCookie)).statusCode,404);
  const upload=await post('/api/v1/media/resources/uploads',{enrollmentId:aEnrollment,idempotencyKey:randomUUID(),mimeType:'image/png',sizeBytes:20},aCookie);assert.equal(upload.statusCode,201,upload.body);const studentAsset=upload.json().id;const key=(await db.pool.query('SELECT object_key FROM media_assets WHERE id=$1',[studentAsset])).rows[0].object_key;assert.ok(key.startsWith(`staging/student/${aEnrollment}/`));objects.set(key,{sizeBytes:20,mimeType:'image/png'});assert.equal((await post(`/api/v1/media/resources/${studentAsset}/confirm`,{},aCookie)).statusCode,200);assert.equal((await db.pool.query('SELECT object_key FROM media_assets WHERE id=$1',[studentAsset])).rows[0].object_key.startsWith(`student/${aEnrollment}/`),true);
  assert.equal((await get(`/api/v1/media/my-resources/${studentAsset}/download`,bCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/media/my-resources/${studentAsset}/download`,aCookie)).statusCode,200);
  assert.equal((await post('/api/v1/media/resources/uploads',{enrollmentId:aEnrollment,idempotencyKey:randomUUID(),mimeType:'image/png',sizeBytes:20},bCookie)).statusCode,404);
  assert.equal((await post(`/api/v1/admin/enrollments/${aEnrollment}/suspend`,{},rootCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/video-sessions/${session}/playback`,{},aCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/media/my-resources/${studentAsset}/download`,aCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/release-units/${unitId}/resources/${resourceId}/download`,aCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/release-units/${unitId}/resources/${resourceId}/download`,bCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/admin/media/${resourceId}/revoke`,{},rootCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${unitId}/resources/${resourceId}/download`,bCookie)).statusCode,404);
  assert.equal((await post(`/api/v1/admin/media/${videoId}/revoke`,{},rootCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/release-units/${unitId}/video-sessions`,{},bCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json().completedRequired,1);
 });
});
