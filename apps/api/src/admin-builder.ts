import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import type {createAuth} from './auth.js';
import type {createDatabase} from '@glitch/db';
import {publicationInput,validatePublication} from './publication-validation.js';

type DB=ReturnType<typeof createDatabase>;
type Auth=ReturnType<typeof createAuth>;
const uuid=z.uuid();
const title=z.string().trim().min(1).max(200);
const description=z.string().max(10000);
const content=z.string().max(100000);
const kind=z.enum(['video','exercise','feedback','reflection','handover']);
const policy=z.enum(['submit_to_complete','feedback_then_continue','instructor_approval','revision_required']);
const hierarchyType=z.enum(['weeks','days','chapters']);
const hierarchyInput=z.object({parentId:uuid,title,activeMinutes:z.int().nonnegative().max(1440).optional()});
const versionInput=z.object({title,description:description.default(''),learningObjective:description.default(''),required:z.boolean().default(true),content:content.default(''),completionPolicy:policy.optional(),prompt:content.optional(),revision:z.int().nonnegative().optional()});
const unitInput=versionInput.extend({chapterId:uuid,kind});
const courseInput=z.object({title,description:description.default('')});
const failure=(reply:FastifyReply,status:number,message:string)=>reply.code(status).send({code:status===401?'UNAUTHENTICATED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':status===409?'CONFLICT':'INVALID_INPUT',message});
const hierarchy:{[key:string]:{table:string,parent:string}}={
 weeks:{table:'weeks',parent:'course_id'},
 days:{table:'days',parent:'week_id'},
 chapters:{table:'chapters',parent:'day_id'}
};

export function registerAdminBuilderRoutes(app:FastifyInstance,database:DB,auth:Auth,requiresVideoAsset=false){
 const {pool}=database;
 async function actor(request:FastifyRequest,reply:FastifyReply){
  const session=await auth.api.getSession({headers:fromNodeHeaders(request.headers)});
  if(!session){failure(reply,401,'Sign in to continue');return null;}
  return session.user.id;
 }
 async function roles(who:string){const r=await pool.query('SELECT role FROM user_role_assignments WHERE user_id=$1',[who]);return r.rows.map(x=>x.role as string);}
 async function superAdmin(who:string){return (await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role='super_admin'",[who])).rowCount===1;}
 async function author(who:string,courseId:string){if(await superAdmin(who))return true;return (await pool.query("SELECT 1 FROM course_author_assignments a JOIN user_role_assignments r ON r.user_id=a.user_id AND r.role='content_admin' WHERE a.user_id=$1 AND a.course_id=$2",[who,courseId])).rowCount===1;}
 async function courseForHierarchy(type:string,parentId:string){
  if(type==='weeks')return parentId;
  if(type==='days'){const r=await pool.query('SELECT course_id FROM weeks WHERE id=$1',[parentId]);return r.rows[0]?.course_id as string|undefined;}
  const r=await pool.query('SELECT w.course_id FROM days d JOIN weeks w ON w.id=d.week_id WHERE d.id=$1',[parentId]);return r.rows[0]?.course_id as string|undefined;
 }
 async function courseForUnit(unitId:string){
  const r=await pool.query('SELECT w.course_id FROM learning_units u JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE u.id=$1',[unitId]);
  return r.rows[0]?.course_id as string|undefined;
 }
 async function guardedCourse(request:FastifyRequest,reply:FastifyReply,courseId:string){
  const who=await actor(request,reply);if(!who)return null;
  if(!uuid.safeParse(courseId).success||!await author(who,courseId)){failure(reply,404,'Course unavailable');return null;}
  return who;
 }
 async function detail(courseId:string){
  const c=await pool.query('SELECT id,title,description,state,created_at FROM courses WHERE id=$1',[courseId]);
  if(!c.rowCount)return null;
  const [weeks,days,chapters,units,versions,definitions,media,releases]=await Promise.all([
   pool.query('SELECT id,course_id,position,title FROM weeks WHERE course_id=$1 ORDER BY position',[courseId]),
   pool.query('SELECT d.id,d.week_id,d.position,d.title,d.active_minutes FROM days d JOIN weeks w ON w.id=d.week_id WHERE w.course_id=$1 ORDER BY w.position,d.position',[courseId]),
   pool.query('SELECT c.id,c.day_id,c.position,c.title FROM chapters c JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE w.course_id=$1 ORDER BY w.position,d.position,c.position',[courseId]),
   pool.query('SELECT u.id,u.chapter_id,u.position,u.kind FROM learning_units u JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE w.course_id=$1 ORDER BY w.position,d.position,c.position,u.position',[courseId]),
   pool.query('SELECT v.id,v.unit_id,v.version,v.revision,v.title,v.description,v.content,v.learning_objective,v.required,v.publication_state FROM learning_unit_versions v JOIN learning_units u ON u.id=v.unit_id JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE w.course_id=$1 ORDER BY v.version DESC',[courseId]),
   pool.query('SELECT x.unit_version_id,x.completion_policy,x.prompt FROM exercise_definitions x JOIN learning_unit_versions v ON v.id=x.unit_version_id JOIN learning_units u ON u.id=v.unit_id JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE w.course_id=$1',[courseId]),
   pool.query("SELECT m.id,m.unit_version_id,m.kind,m.state,m.video_provider,m.duration_seconds,m.failure_reason,m.mime_type FROM media_assets m JOIN learning_unit_versions v ON v.id=m.unit_version_id JOIN learning_units u ON u.id=v.unit_id JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE w.course_id=$1 AND m.kind IN ('stream_video','r2_resource') ORDER BY m.created_at DESC",[courseId]),
   pool.query('SELECT id,release_number,state,published_at FROM curriculum_releases WHERE course_id=$1 ORDER BY release_number DESC',[courseId])
  ]);
  const saved=await pool.query('SELECT unit_id,prerequisite_unit_id,condition_type FROM course_draft_prerequisites WHERE course_id=$1',[courseId]);
  const prerequisites=Object.fromEntries(saved.rows.map(x=>[x.unit_id,{unitId:x.prerequisite_unit_id,type:x.condition_type}]));
  return {course:c.rows[0],weeks:weeks.rows,days:days.rows,chapters:chapters.rows,units:units.rows,versions:versions.rows,definitions:definitions.rows,media:media.rows,releases:releases.rows,prerequisites};
 }
 app.get('/api/v1/admin/builder/me',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;
  return {roles:await roles(who)};
 });
 app.get('/api/v1/admin/builder/courses',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;const ownRoles=await roles(who);
  if(!ownRoles.some(x=>['super_admin','content_admin'].includes(x)))return failure(reply,403,'Course administration permission required');
  const r=await pool.query("SELECT c.id,c.title,c.description,c.state,(SELECT count(*)::int FROM curriculum_releases cr WHERE cr.course_id=c.id) release_count,(SELECT count(*)::int FROM enrollments e WHERE e.course_id=c.id) student_count FROM courses c WHERE $2::boolean OR EXISTS(SELECT 1 FROM course_author_assignments a WHERE a.course_id=c.id AND a.user_id=$1) ORDER BY c.created_at DESC",[who,ownRoles.includes('super_admin')]);
  return r.rows;
 });
 app.get<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id',async(request,reply)=>{
  if(!await guardedCourse(request,reply,request.params.id))return;
  return await detail(request.params.id)??failure(reply,404,'Course unavailable');
 });
 app.patch<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id',async(request,reply)=>{
  const who=await guardedCourse(request,reply,request.params.id);if(!who)return;
  const p=courseInput.safeParse(request.body);if(!p.success)return failure(reply,422,'Invalid course');
  const r=await pool.query('UPDATE courses SET title=$1,description=$2 WHERE id=$3 RETURNING id,title,description,state',[p.data.title,p.data.description,request.params.id]);
  if(!r.rowCount)return failure(reply,404,'Course unavailable');await pool.query("INSERT INTO audit_events(actor_id,action,target_id) VALUES($1,'edit_course',$2)",[who,request.params.id]);return r.rows[0];
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id/authors',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!await superAdmin(who))return failure(reply,403,'Super administrator required');
  const p=z.object({userId:uuid}).safeParse(request.body);if(!p.success)return failure(reply,422,'Invalid author');
  const target=await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role='content_admin'",[p.data.userId]);
  const c=await pool.query('SELECT 1 FROM courses WHERE id=$1',[request.params.id]);
  if(!target.rowCount||!c.rowCount)return failure(reply,404,'Course or content administrator unavailable');
  await pool.query('INSERT INTO course_author_assignments(user_id,course_id,assigned_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.data.userId,request.params.id,who]);
  return {ok:true};
 });
 app.get<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id/authors',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!await superAdmin(who))return failure(reply,403,'Super administrator required');
  const r=await pool.query("SELECT u.id,u.name,u.email,a.course_id IS NOT NULL assigned FROM \"user\" u JOIN user_role_assignments role ON role.user_id=u.id AND role.role='content_admin' LEFT JOIN course_author_assignments a ON a.user_id=u.id AND a.course_id=$1 ORDER BY u.name",[request.params.id]);return r.rows;
 });
 app.delete<{Params:{id:string;userId:string}}>('/api/v1/admin/builder/courses/:id/authors/:userId',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!await superAdmin(who))return failure(reply,403,'Super administrator required');
  await pool.query('DELETE FROM course_author_assignments WHERE course_id=$1 AND user_id=$2',[request.params.id,request.params.userId]);return {ok:true};
 });
 app.put<{Params:{id:string;unitId:string}}>('/api/v1/admin/builder/courses/:id/prerequisites/:unitId',async(request,reply)=>{
  if(!await guardedCourse(request,reply,request.params.id))return;
  const p=z.object({prerequisiteUnitId:uuid.nullable(),type:z.enum(['completed','first_attempt_submitted','review_approved'])}).safeParse(request.body);
  if(!p.success)return failure(reply,422,'Invalid prerequisite');
  const own=await courseForUnit(request.params.unitId),pre=p.data.prerequisiteUnitId?await courseForUnit(p.data.prerequisiteUnitId):null;
  if(own!==request.params.id||p.data.prerequisiteUnitId&&(pre!==own||p.data.prerequisiteUnitId===request.params.unitId))return failure(reply,422,'Prerequisite must belong to this course');
  if(!p.data.prerequisiteUnitId){await pool.query('DELETE FROM course_draft_prerequisites WHERE course_id=$1 AND unit_id=$2',[request.params.id,request.params.unitId]);return {ok:true};}
  await pool.query('INSERT INTO course_draft_prerequisites(course_id,unit_id,prerequisite_unit_id,condition_type) VALUES($1,$2,$3,$4) ON CONFLICT(course_id,unit_id) DO UPDATE SET prerequisite_unit_id=$3,condition_type=$4',[request.params.id,request.params.unitId,p.data.prerequisiteUnitId,p.data.type]);return {ok:true};
 });
 app.post<{Params:{type:string}}>('/api/v1/admin/builder/hierarchy/:type',async(request,reply)=>{
  const type=hierarchyType.safeParse(request.params.type);const p=hierarchyInput.safeParse(request.body);
  if(!type.success||!p.success)return failure(reply,422,'Invalid hierarchy item');
  const table=hierarchy[type.data],courseId=await courseForHierarchy(type.data,p.data.parentId);
  if(!courseId)return failure(reply,404,'Parent unavailable');
  const who=await guardedCourse(request,reply,courseId);if(!who)return;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   const n=await c.query(`SELECT COALESCE(MAX(position),0)+1 n FROM ${table.table} WHERE ${table.parent}=$1`,[p.data.parentId]);
   const r=await c.query(`INSERT INTO ${table.table}(${table.parent},position,title${type.data==='days'?',active_minutes':''}) VALUES($1,$2,$3${type.data==='days'?',$4':''}) RETURNING *`,type.data==='days'?[p.data.parentId,n.rows[0].n,p.data.title,p.data.activeMinutes??null]:[p.data.parentId,n.rows[0].n,p.data.title]);
   await c.query('COMMIT');return reply.code(201).send(r.rows[0]);
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.patch<{Params:{type:string;id:string}}>('/api/v1/admin/builder/hierarchy/:type/:id',async(request,reply)=>{
  const type=hierarchyType.safeParse(request.params.type);const p=z.object({title,activeMinutes:z.int().nonnegative().max(1440).nullable().optional()}).safeParse(request.body);
  if(!type.success||!p.success||!uuid.safeParse(request.params.id).success)return failure(reply,422,'Invalid hierarchy item');
  const table=hierarchy[type.data];const existing=await pool.query(`SELECT ${table.parent} parent_id FROM ${table.table} WHERE id=$1`,[request.params.id]);
  const courseId=existing.rowCount?await courseForHierarchy(type.data,existing.rows[0].parent_id):null;
  if(!courseId)return failure(reply,404,'Hierarchy item unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const r=await pool.query(`UPDATE ${table.table} SET title=$1${type.data==='days'?',active_minutes=$3':''} WHERE id=$2 RETURNING *`,type.data==='days'?[p.data.title,request.params.id,p.data.activeMinutes??null]:[p.data.title,request.params.id]);
  return r.rows[0];
 });
 app.post<{Params:{type:string;id:string}}>('/api/v1/admin/builder/hierarchy/:type/:id/move',async(request,reply)=>{
  const type=z.enum(['weeks','days','chapters','units']).safeParse(request.params.type);
  const p=z.object({direction:z.enum(['up','down'])}).safeParse(request.body);
  if(!type.success||!p.success||!uuid.safeParse(request.params.id).success)return failure(reply,422,'Invalid move');
  const table=type.data==='units'?{table:'learning_units',parent:'chapter_id'}:hierarchy[type.data];
  const row=await pool.query(`SELECT ${table.parent} parent_id FROM ${table.table} WHERE id=$1`,[request.params.id]);
  if(!row.rowCount)return failure(reply,404,'Item unavailable');
  const courseId=type.data==='units'?await courseForUnit(request.params.id):await courseForHierarchy(type.data,row.rows[0].parent_id);
  if(!courseId)return failure(reply,404,'Item unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   const current=await c.query(`SELECT id,position FROM ${table.table} WHERE id=$1 FOR UPDATE`,[request.params.id]);
   const nearby=await c.query(`SELECT id,position FROM ${table.table} WHERE ${table.parent}=$1 AND position ${p.data.direction==='up'?'<':'>'} $2 ORDER BY position ${p.data.direction==='up'?'DESC':'ASC'} LIMIT 1 FOR UPDATE`,[row.rows[0].parent_id,current.rows[0].position]);
   if(!nearby.rowCount){await c.query('ROLLBACK');return failure(reply,409,'Item is already at the edge');}
   const other=nearby.rows[0];await c.query(`UPDATE ${table.table} SET position=0 WHERE id=$1`,[current.rows[0].id]);
   await c.query(`UPDATE ${table.table} SET position=$1 WHERE id=$2`,[current.rows[0].position,other.id]);
   await c.query(`UPDATE ${table.table} SET position=$1 WHERE id=$2`,[other.position,current.rows[0].id]);
   await c.query('COMMIT');return {id:current.rows[0].id,position:other.position};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.delete<{Params:{type:string;id:string}}>('/api/v1/admin/builder/hierarchy/:type/:id',async(request,reply)=>{
  const type=hierarchyType.safeParse(request.params.type);if(!type.success||!uuid.safeParse(request.params.id).success)return failure(reply,422,'Invalid hierarchy item');
  const table=hierarchy[type.data],row=await pool.query(`SELECT ${table.parent} parent_id FROM ${table.table} WHERE id=$1`,[request.params.id]);
  const courseId=row.rowCount?await courseForHierarchy(type.data,row.rows[0].parent_id):null;
  if(!courseId)return failure(reply,404,'Hierarchy item unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const child=type.data==='weeks'?{table:'days',parent:'week_id'}:type.data==='days'?{table:'chapters',parent:'day_id'}:{table:'learning_units',parent:'chapter_id'};
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   if((await c.query(`SELECT 1 FROM ${child.table} WHERE ${child.parent}=$1 LIMIT 1`,[request.params.id])).rowCount){await c.query('ROLLBACK');return failure(reply,409,'Remove child drafts first; published content cannot be deleted');}
   await c.query(`DELETE FROM ${table.table} WHERE id=$1`,[request.params.id]);await c.query('COMMIT');return {deleted:true};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.delete<{Params:{id:string}}>('/api/v1/admin/builder/units/:id',async(request,reply)=>{
  if(!uuid.safeParse(request.params.id).success)return failure(reply,422,'Invalid unit');const courseId=await courseForUnit(request.params.id);
  if(!courseId)return failure(reply,404,'Unit unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   const versions=await c.query('SELECT id,publication_state FROM learning_unit_versions WHERE unit_id=$1 FOR UPDATE',[request.params.id]);
   const versionIds=versions.rows.map(x=>x.id);
   if(versions.rows.some(x=>!['draft','ready_for_review'].includes(x.publication_state))||(await c.query('SELECT 1 FROM curriculum_release_units WHERE unit_id=$1 LIMIT 1',[request.params.id])).rowCount||(versionIds.length&&(await c.query('SELECT 1 FROM media_assets WHERE unit_version_id=ANY($1::uuid[]) LIMIT 1',[versionIds])).rowCount)){
    await c.query('ROLLBACK');return failure(reply,409,'Published, pinned or uploaded units cannot be deleted');
   }
   await c.query('DELETE FROM exercise_definitions WHERE unit_version_id=ANY($1::uuid[])',[versionIds]);
   await c.query('DELETE FROM learning_unit_versions WHERE unit_id=$1',[request.params.id]);
   await c.query('DELETE FROM learning_units WHERE id=$1',[request.params.id]);await c.query('COMMIT');return {deleted:true};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.post('/api/v1/admin/builder/units',async(request,reply)=>{
  const p=unitInput.safeParse(request.body);if(!p.success||p.data.kind==='exercise'&&!p.data.completionPolicy)return failure(reply,422,'Invalid learning unit');
  const cr=await pool.query('SELECT w.course_id FROM chapters c JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE c.id=$1',[p.data.chapterId]);const courseId=cr.rows[0]?.course_id;
  if(!courseId)return failure(reply,404,'Chapter unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   const n=await c.query('SELECT COALESCE(MAX(position),0)+1 n FROM learning_units WHERE chapter_id=$1',[p.data.chapterId]);
   const u=await c.query('INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,$2,$3) RETURNING id,position,kind',[p.data.chapterId,n.rows[0].n,p.data.kind]);
   const v=await c.query("INSERT INTO learning_unit_versions(unit_id,version,title,description,content,learning_objective,required) VALUES($1,1,$2,$3,$4,$5,$6) RETURNING *",[u.rows[0].id,p.data.title,p.data.description,p.data.content,p.data.learningObjective,p.data.required]);
   if(p.data.kind==='exercise')await c.query('INSERT INTO exercise_definitions(unit_version_id,completion_policy,prompt) VALUES($1,$2,$3)',[v.rows[0].id,p.data.completionPolicy,p.data.prompt??'']);
   await c.query('COMMIT');return reply.code(201).send({unit:u.rows[0],version:v.rows[0]});
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.patch<{Params:{id:string}}>('/api/v1/admin/builder/unit-versions/:id',async(request,reply)=>{
  const p=versionInput.safeParse(request.body);if(!p.success||!uuid.safeParse(request.params.id).success)return failure(reply,422,'Invalid version');
  const v=await pool.query('SELECT v.unit_id,u.kind FROM learning_unit_versions v JOIN learning_units u ON u.id=v.unit_id WHERE v.id=$1',[request.params.id]);
  if(!v.rowCount)return failure(reply,404,'Version unavailable');const courseId=await courseForUnit(v.rows[0].unit_id);
  if(!courseId)return failure(reply,404,'Version unavailable');if(!await guardedCourse(request,reply,courseId))return;
  if(v.rows[0].kind==='exercise'&&!p.data.completionPolicy)return failure(reply,422,'Exercise policy required');
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   const locked=await c.query('SELECT publication_state,revision FROM learning_unit_versions WHERE id=$1 FOR UPDATE',[request.params.id]);
   const pinned=await c.query('SELECT 1 FROM curriculum_release_units WHERE unit_version_id=$1',[request.params.id]);
   if(!['draft','ready_for_review'].includes(locked.rows[0].publication_state)||pinned.rowCount){await c.query('ROLLBACK');return failure(reply,409,'Published or pinned version is immutable');}
   if(p.data.revision===undefined||p.data.revision!==locked.rows[0].revision){await c.query('ROLLBACK');return failure(reply,409,'Draft changed since you opened it. Reload current content before saving.');}
   const updated=await c.query("UPDATE learning_unit_versions SET title=$1,description=$2,content=$3,learning_objective=$4,required=$5,publication_state='draft',revision=revision+1 WHERE id=$6 RETURNING *",[p.data.title,p.data.description,p.data.content,p.data.learningObjective,p.data.required,request.params.id]);
   if(v.rows[0].kind==='exercise')await c.query('UPDATE exercise_definitions SET completion_policy=$1,prompt=$2 WHERE unit_version_id=$3',[p.data.completionPolicy,p.data.prompt??'',request.params.id]);
   await c.query('COMMIT');return updated.rows[0];
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/builder/units/:id/versions',async(request,reply)=>{
  if(!uuid.safeParse(request.params.id).success)return failure(reply,404,'Unit unavailable');const courseId=await courseForUnit(request.params.id);
  if(!courseId)return failure(reply,404,'Unit unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM learning_units WHERE id=$1 FOR UPDATE',[request.params.id]);
   const latest=await c.query('SELECT * FROM learning_unit_versions WHERE unit_id=$1 ORDER BY version DESC LIMIT 1',[request.params.id]);
   if(!latest.rowCount){await c.query('ROLLBACK');return failure(reply,404,'Version unavailable');}
   const x=latest.rows[0];const v=await c.query('INSERT INTO learning_unit_versions(unit_id,version,title,description,content,learning_objective,required) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[request.params.id,x.version+1,x.title,x.description,x.content,x.learning_objective,x.required]);
   await c.query('INSERT INTO exercise_definitions(unit_version_id,completion_policy,prompt) SELECT $1,completion_policy,prompt FROM exercise_definitions WHERE unit_version_id=$2',[v.rows[0].id,x.id]);
   await c.query('COMMIT');return reply.code(201).send(v.rows[0]);
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/builder/unit-versions/:id/ready',async(request,reply)=>{
  if(!uuid.safeParse(request.params.id).success)return failure(reply,404,'Version unavailable');const v=await pool.query('SELECT unit_id FROM learning_unit_versions WHERE id=$1',[request.params.id]);
  if(!v.rowCount)return failure(reply,404,'Version unavailable');const courseId=await courseForUnit(v.rows[0].unit_id);
  if(!courseId)return failure(reply,404,'Version unavailable');if(!await guardedCourse(request,reply,courseId))return;
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM courses WHERE id=$1 FOR UPDATE',[courseId]);
   const r=await c.query("UPDATE learning_unit_versions SET publication_state='ready_for_review',revision=revision+1 WHERE id=$1 AND publication_state IN ('draft','ready_for_review') RETURNING id,publication_state,revision",[request.params.id]);
   if(!r.rowCount){await c.query('ROLLBACK');return failure(reply,409,'Published version is immutable');}
   await c.query('COMMIT');return r.rows[0];
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 });
 app.get<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id/preview',async(request,reply)=>{
  if(!await guardedCourse(request,reply,request.params.id))return;
  const d=await detail(request.params.id);if(!d)return failure(reply,404,'Course unavailable');
  return d;
 });
 app.post<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id/preflight',async(request,reply)=>{
  if(!await guardedCourse(request,reply,request.params.id))return;
  const p=publicationInput.safeParse(request.body);if(!p.success)return failure(reply,422,'Invalid publication selection');
  const sharedIssues=await validatePublication(pool,request.params.id,p.data,requiresVideoAsset);
  return {valid:sharedIssues.length===0,issues:sharedIssues,unitCount:p.data.units.length};

 });
 app.get<{Params:{id:string}}>('/api/v1/admin/builder/courses/:id/students',async(request,reply)=>{
  const who=await guardedCourse(request,reply,request.params.id);if(!who)return;
  const r=await pool.query('SELECT e.id,e.student_id,e.state,e.release_id,e.created_at,u.name,u.email,cr.release_number FROM enrollments e JOIN "user" u ON u.id=e.student_id JOIN curriculum_releases cr ON cr.id=e.release_id WHERE e.course_id=$1 ORDER BY e.created_at DESC',[request.params.id]);return r.rows;
 });
 app.get('/api/v1/admin/builder/students',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!await superAdmin(who))return failure(reply,403,'Super administrator required');
  const r=await pool.query("SELECT u.id,u.name,u.email FROM \"user\" u JOIN user_role_assignments a ON a.user_id=u.id AND a.role='student' WHERE u.email_verified=true ORDER BY u.name,u.email LIMIT 500");
  return r.rows;
 });
 app.get<{Params:{id:string}}>('/api/v1/admin/builder/enrollments/:id/progress',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!uuid.safeParse(request.params.id).success)return failure(reply,404,'Enrollment unavailable');
  const e=await pool.query('SELECT e.*,u.name,u.email FROM enrollments e JOIN "user" u ON u.id=e.student_id WHERE e.id=$1',[request.params.id]);if(!e.rowCount)return failure(reply,404,'Enrollment unavailable');
  const row=e.rows[0];const permitted=await author(who,row.course_id)||(await pool.query("SELECT 1 FROM staff_student_assignments s JOIN user_role_assignments r ON r.user_id=s.staff_id AND r.role='instructor' WHERE s.staff_id=$1 AND s.student_id=$2 AND s.course_id=$3",[who,row.student_id,row.course_id])).rowCount===1;
  if(!permitted)return failure(reply,404,'Enrollment unavailable');
  const units=await pool.query("SELECT ru.id,ru.position,ru.kind,ru.required,ru.day_title,ru.chapter_title,ru.completion_policy,COALESCE(p.state,'not_started') state FROM enrollment_release_units eu JOIN curriculum_release_units ru ON ru.id=eu.release_unit_id LEFT JOIN student_unit_progress p ON p.enrollment_id=eu.enrollment_id AND p.release_unit_id=ru.id WHERE eu.enrollment_id=$1 ORDER BY ru.position",[row.id]);
  const required=units.rows.filter(x=>x.required),done=required.filter(x=>x.state==='completed');
  return {enrollment:{id:row.id,courseId:row.course_id,releaseId:row.release_id,state:row.state,studentId:row.student_id,name:row.name,email:row.email},completedRequired:done.length,totalRequired:required.length,percent:required.length?Math.round(done.length/required.length*100):100,units:units.rows};
 });
}
