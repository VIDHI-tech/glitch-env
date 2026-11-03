import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {buildApp} from '../../src/app.js';
import {CaptureMailer} from '../../src/mail.js';
import {bootstrapFirstSuperAdmin} from '../../src/bootstrap.js';
import {createDatabase,migrateDatabase} from '@glitch/db';
if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required');
const base=new URL(process.env.TEST_DATABASE_URL),name=`glitch_m2_it_${process.pid}_${Math.floor(Math.random()*100000)}`;
const adminUrl=new URL(base);adminUrl.pathname='/postgres';const dbUrl=new URL(base);dbUrl.pathname=`/${name}`;
const origin='http://127.0.0.1:3002',mailer=new CaptureMailer();
let admin:Pool,db:ReturnType<typeof createDatabase>,app:ReturnType<typeof buildApp>,now=Date.now();
const trace:Array<Record<string,unknown>>=[];
async function request(method:string,url:string,payload?:object,cookie?:string){const r=await app.inject({method,url,headers:{host:'127.0.0.1:3002',...(method!=='GET'?{origin}:{}),...(cookie?{cookie}:{})},...(payload?{payload}:{})});if(url.startsWith('/api/v1/'))trace.push({method,url,status:r.statusCode,response:r.statusCode<500?r.json():null});return r;}
const post=(url:string,payload:object,cookie?:string)=>request('POST',url,payload,cookie),get=(url:string,cookie?:string)=>request('GET',url,undefined,cookie),put=(url:string,payload:object,cookie?:string)=>request('PUT',url,payload,cookie);
const session=(r:{headers:Record<string,unknown>})=>String(r.headers['set-cookie']).split(';')[0];
async function signup(email:string){const r=await post('/api/auth/sign-up/email',{name:email.split('@')[0],email,password:'m2-password-12345'});assert.equal(r.statusCode,200,r.body);const m=mailer.messages.findLast(x=>x.to===email&&x.subject.startsWith('Verify'));assert.ok(m);const u=new URL(m.text.split(' ').at(-1));assert.ok([200,302].includes((await get(u.pathname+u.search)).statusCode));return r.json().user.id as string;}
async function login(email:string){const r=await post('/api/auth/sign-in/email',{email,password:'m2-password-12345'});assert.equal(r.statusCode,200,r.body);return session(r);}
let root:string,a:string,b:string,c:string,staff:string,rootCookie:string,aCookie:string,bCookie:string,staffCookie:string,courseId:string,releaseId:string,units:string[]=[],aEnrollment:string,bEnrollment:string,artifactId:string;
before(async()=>{admin=new Pool({connectionString:adminUrl.toString()});await admin.query(`CREATE DATABASE ${name}`);db=createDatabase(dbUrl.toString());await migrateDatabase(db,resolve(process.cwd(),'../../packages/db/migrations'));app=buildApp({databaseUrl:dbUrl.toString(),origin,secret:'m2-test-only-better-auth-secret-minimum-32-characters',mailer,clock:()=>now});});
after(async()=>{if(process.env.M2_DEMO_OUTPUT)await writeFile(process.env.M2_DEMO_OUTPUT,JSON.stringify({description:'Disposable M2 PostgreSQL HTTP demonstration; cookies omitted',steps:trace},null,2)+'\n');await app?.close();await db?.pool.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();}});
test('M2 learning journey and isolation',async t=>{
 async function fixture(kinds:string[],policies:Record<number,string>={}){
  const course=(await post('/api/v1/admin/courses',{title:`Hardening ${crypto.randomUUID()}`},rootCookie)).json().id as string;
  const week=(await db.pool.query('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[course,'Week'])).rows[0].id;
  const day=(await db.pool.query('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[week,'Day'])).rows[0].id;
  const chapter=(await db.pool.query('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[day,'Chapter'])).rows[0].id;
  const versions:string[]=[];
  for(const [i,kind] of kinds.entries()){
   const unit=(await db.pool.query('INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,$2,$3) RETURNING id',[chapter,i+1,kind])).rows[0].id;
   versions.push((await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,$2,'ready_for_review') RETURNING id",[unit,`Unit ${i+1}`])).rows[0].id);
   if(kind==='exercise')await db.pool.query('INSERT INTO exercise_definitions(unit_version_id,completion_policy) VALUES($1,$2)',[versions[i],policies[i]??'submit_to_complete']);
  }
  return {course,versions};
 }
 await t.test('administrator publishes an immutable four-unit release and enrolls two students',async()=>{
  const suffix=crypto.randomUUID();root=await signup(`root-${suffix}@example.test`);a=await signup(`a-${suffix}@example.test`);b=await signup(`b-${suffix}@example.test`);staff=await signup(`staff-${suffix}@example.test`);rootCookie=await login(`root-${suffix}@example.test`);aCookie=await login(`a-${suffix}@example.test`);bCookie=await login(`b-${suffix}@example.test`);staffCookie=await login(`staff-${suffix}@example.test`);await bootstrapFirstSuperAdmin(db.pool,`root-${suffix}@example.test`);
  const course=await post('/api/v1/admin/courses',{title:'M2 HTTP Journey'},rootCookie);assert.equal(course.statusCode,200,course.body);courseId=course.json().id;
  const week=(await db.pool.query('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[courseId,'Week 1'])).rows[0].id;
  const day=(await db.pool.query('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[week,'Day 1'])).rows[0].id;
  const chapter=(await db.pool.query('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[day,'Chapter 1'])).rows[0].id;
  const versions:string[]=[];for(let i=0;i<4;i++){const kind=['video','video','exercise','feedback'][i];const unit=(await db.pool.query('INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,$2,$3) RETURNING id',[chapter,i+1,kind])).rows[0].id;const version=(await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,$2,'ready_for_review') RETURNING id",[unit,`Unit ${i+1}`])).rows[0].id;versions.push(version);}
  await db.pool.query("INSERT INTO exercise_definitions(unit_version_id,completion_policy,prompt) VALUES($1,'instructor_approval','Explain your observation')",[versions[2]]);
  const released=await post(`/api/v1/admin/courses/${courseId}/releases`,{units:[{unitVersionId:versions[0],durationSeconds:10,content:'Video 01 test adapter'},{unitVersionId:versions[1],durationSeconds:10,content:'Video 02 test adapter'},{unitVersionId:versions[2],content:'Exercise 01'},{unitVersionId:versions[3],required:false,content:'Evidence revealed after first attempt',conditions:[{prerequisiteIndex:2,type:'first_attempt_submitted'}]}]},rootCookie);assert.equal(released.statusCode,201,released.body);releaseId=released.json().id;units=released.json().unitIds;
  assert.equal((await post('/api/v1/portfolio/artifacts',{courseId,title:'Unenrolled',body:'Blocked'},aCookie)).statusCode,404);
  const ae=await post('/api/v1/admin/enrollments',{studentId:a,courseId},rootCookie),be=await post('/api/v1/admin/enrollments',{studentId:b,courseId},rootCookie);assert.equal(ae.statusCode,201,ae.body);assert.equal(be.statusCode,201,be.body);aEnrollment=ae.json().id;bEnrollment=be.json().id;
  assert.equal((await post('/api/v1/admin/enrollments',{studentId:a,courseId},rootCookie)).statusCode,409);
  assert.equal((await get(`/api/v1/release-units/${units[1]}`,aCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/release-units/${units[3]}`,aCookie)).statusCode,404);
  const roadA=(await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json(),roadB=(await get(`/api/v1/enrollments/${bEnrollment}/roadmap`,bCookie)).json();assert.equal(roadA.percent,0);assert.equal(roadB.percent,0);assert.equal(roadA.currentUnitId,units[0]);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,bCookie)).statusCode,404);
  await assert.rejects(db.pool.query('UPDATE curriculum_release_units SET content=$1 WHERE id=$2',['tamper',units[0]]));
  await assert.rejects(db.pool.query('INSERT INTO curriculum_release_units(release_id,unit_id,unit_version_id,position,required,kind,completion_policy,content,week_id,week_title,week_position,day_id,day_title,day_position,chapter_id,chapter_title,chapter_position) SELECT release_id,unit_id,unit_version_id,99,required,kind,completion_policy,content,week_id,week_title,week_position,day_id,day_title,day_position,chapter_id,chapter_title,chapter_position FROM curriculum_release_units WHERE id=$1',[units[0]]));
  await assert.rejects(db.pool.query("INSERT INTO release_conditions(release_unit_id,prerequisite_release_unit_id,condition_type) VALUES($1,$2,'completed')",[units[1],units[0]]));
  await assert.rejects(db.pool.query("UPDATE release_conditions SET condition_type='completed' WHERE release_unit_id=$1",[units[3]]));
  await assert.rejects(db.pool.query('DELETE FROM release_conditions WHERE release_unit_id=$1',[units[3]]));
  await assert.rejects(db.pool.query('DELETE FROM curriculum_release_units WHERE id=$1',[units[0]]));
  await assert.rejects(db.pool.query('DELETE FROM curriculum_releases WHERE id=$1',[releaseId]));
  await assert.rejects(db.pool.query("UPDATE exercise_definitions SET prompt='tampered' WHERE unit_version_id=$1",[versions[2]]));
  await assert.rejects(db.pool.query("UPDATE learning_unit_versions SET publication_state='ready_for_review' WHERE id=$1",[versions[0]]));
  await db.pool.query("UPDATE days SET title='Changed draft day' WHERE id=$1",[day]);
  await db.pool.query("UPDATE chapters SET title='Changed draft chapter' WHERE id=$1",[chapter]);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json().days[0].title,'Day 1');
  await assert.rejects(db.pool.query("UPDATE enrollments SET state='invalid' WHERE id=$1",[aEnrollment]));
 });
 await t.test('video watch coverage, new login resume and independent unlocks',async()=>{
  const start=await post(`/api/v1/release-units/${units[0]}/video-sessions`,{},aCookie);assert.equal(start.statusCode,201,start.body);let sid=start.json().id;assert.equal(start.json().adapter,'test-video');
  const seek=await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:10,type:'seek'},aCookie);assert.equal(seek.statusCode,200);assert.equal(seek.json().watchedSeconds,0);
  assert.equal((await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:1,type:'heartbeat'},bCookie)).statusCode,404);
  assert.equal((await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:10,type:'end'},aCookie)).json().completed,false);
  await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:0,type:'seek'},aCookie);
  now+=2000;const p=await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:4,type:'heartbeat'},aCookie);assert.equal(p.statusCode,200,p.body);assert.equal(p.json().watchedSeconds,4);
  assert.equal((await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:4,type:'heartbeat'},aCookie)).json().watchedSeconds,4);
  const newLogin=await login(mailer.messages.find(x=>x.to.startsWith('a-'))!.to);const resume=await post(`/api/v1/release-units/${units[0]}/video-sessions`,{},newLogin);assert.equal(resume.statusCode,201,resume.body);assert.equal(resume.json().lastPositionSeconds,4);sid=resume.json().id;
  assert.equal((await post(`/api/v1/video-sessions/${start.json().id}/events`,{positionSeconds:6,type:'heartbeat'},aCookie)).statusCode,404);
  for(const position of [6,8,10]){now+=1000;const e=await post(`/api/v1/video-sessions/${sid}/events`,{positionSeconds:position,type:position===10?'end':'heartbeat'},newLogin);assert.equal(e.statusCode,200,e.body);if(position===10)assert.equal(e.json().completed,true);}
  const aRoad=(await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json(),bRoad=(await get(`/api/v1/enrollments/${bEnrollment}/roadmap`,bCookie)).json();assert.equal(aRoad.currentUnitId,units[1]);assert.equal(aRoad.percent,33);assert.equal(aRoad.days[0].percent,33);assert.equal(bRoad.currentUnitId,units[0]);assert.equal(bRoad.percent,0);
  assert.equal((await get(`/api/v1/release-units/${units[0]}`,aCookie)).statusCode,200);assert.equal((await get(`/api/v1/release-units/${units[1]}`,bCookie)).statusCode,404);
 });
 await t.test('exercise drafts, privacy, evidence reveal and instructor approval',async()=>{
  const second=await post(`/api/v1/release-units/${units[1]}/video-sessions`,{},aCookie);assert.equal(second.statusCode,201,second.body);for(const position of [2,4,6,8,10]){now+=1000;const e=await post(`/api/v1/video-sessions/${second.json().id}/events`,{positionSeconds:position,type:position===10?'end':'heartbeat'},aCookie);assert.equal(e.statusCode,200,e.body);}
  const draft=await put(`/api/v1/release-units/${units[2]}/exercise-draft`,{answer:'First draft',revision:0},aCookie);assert.equal(draft.statusCode,200,draft.body);assert.equal((await put(`/api/v1/release-units/${units[2]}/exercise-draft`,{answer:'Stale',revision:0},aCookie)).statusCode,409);
  const note=await put(`/api/v1/release-units/${units[2]}/note`,{body:'Private note',revision:0},aCookie);assert.equal(note.statusCode,200,note.body);assert.equal((await get(`/api/v1/release-units/${units[2]}`,aCookie)).json().draft,'First draft');assert.equal((await get(`/api/v1/release-units/${units[2]}`,bCookie)).statusCode,404);
  assert.equal((await put(`/api/v1/release-units/${units[2]}/exercise-draft`,{answer:'Intrusion',revision:1},bCookie)).statusCode,404);
  assert.equal((await put(`/api/v1/release-units/${units[2]}/note`,{body:'Intrusion',revision:1},bCookie)).statusCode,404);
  assert.equal((await post(`/api/v1/release-units/${units[2]}/attempts`,{answer:'Intrusion'},bCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/release-units/${units[3]}`,aCookie)).statusCode,404);
  const submitted=await post(`/api/v1/release-units/${units[2]}/attempts`,{answer:'Original answer'},aCookie);assert.equal(submitted.statusCode,201,submitted.body);assert.equal(submitted.json().state,'awaiting_review');assert.equal((await get(`/api/v1/release-units/${units[3]}`,aCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${units[2]}/attempts`,bCookie)).json().length,0);
  assert.equal((await post(`/api/v1/instructor/attempts/${submitted.json().id}/review`,{decision:'completed',message:'Good'},staffCookie)).statusCode,404);
  assert.equal((await post('/api/v1/admin/roles',{userId:staff,role:'instructor'},rootCookie)).statusCode,200);
  assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:staff,studentId:a,courseId},rootCookie)).statusCode,200);
  const review=await post(`/api/v1/instructor/attempts/${submitted.json().id}/review`,{decision:'needs_revision',message:'Add evidence'},staffCookie);assert.equal(review.statusCode,200,review.body);
  const revised=await post(`/api/v1/release-units/${units[2]}/attempts`,{answer:'Revised answer'},aCookie);assert.equal(revised.statusCode,201,revised.body);assert.equal(revised.json().attempt_number,2);
  const attempts=(await get(`/api/v1/release-units/${units[2]}/attempts`,aCookie)).json();assert.equal(attempts[0].answer,'Original answer');assert.equal(attempts[1].answer,'Revised answer');
  assert.equal((await post(`/api/v1/instructor/attempts/${revised.json().id}/review`,{decision:'completed',message:'Approved'},staffCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/instructor/attempts/${submitted.json().id}/review`,{decision:'completed',message:'Stale'},staffCookie)).statusCode,409);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json().percent,100);
  const artifact=await post('/api/v1/portfolio/artifacts',{courseId,title:'My work',body:'Private'},aCookie);assert.equal(artifact.statusCode,201,artifact.body);artifactId=artifact.json().id;assert.equal((await get(`/api/v1/portfolio/artifacts/${artifactId}`,bCookie)).statusCode,404);
  const history=(await get(`/api/v1/enrollments/${aEnrollment}/activity`,aCookie)).json();assert.ok(history.items.length>=5);
 });
 await t.test('new release preserves old enrollment and suspension blocks learning',async()=>{
  const old=(await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json();assert.equal(old.releaseId,releaseId);
  const source=await db.pool.query('SELECT unit_id FROM curriculum_release_units WHERE id=$1',[units[0]]);const version=(await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,2,'Updated Video 01','ready_for_review') RETURNING id",[source.rows[0].unit_id])).rows[0].id;
  const oldVersions=(await db.pool.query('SELECT unit_version_id,kind,duration_seconds,content,required FROM curriculum_release_units WHERE release_id=$1 ORDER BY position',[releaseId])).rows;
  const inputs=oldVersions.map((x,i)=>({unitVersionId:i===0?version:x.unit_version_id,required:x.required,content:i===0?'Updated Video 01':x.content,...(x.kind==='video'?{durationSeconds:x.duration_seconds}:{}),...(i===3?{conditions:[{prerequisiteIndex:2,type:'first_attempt_submitted'}]}:{})}));
  const next=await post(`/api/v1/admin/courses/${courseId}/releases`,{units:inputs},rootCookie);assert.equal(next.statusCode,201,next.body);assert.notEqual(next.json().id,releaseId);
  await assert.rejects(db.pool.query('INSERT INTO enrollment_release_units(enrollment_id,release_unit_id) VALUES($1,$2)',[aEnrollment,next.json().unitIds[0]]));
  await assert.rejects(db.pool.query("INSERT INTO student_unit_progress(enrollment_id,release_unit_id,state) VALUES($1,$2,'completed')",[bEnrollment,next.json().unitIds[0]]));
  await assert.rejects(db.pool.query("INSERT INTO release_conditions(release_unit_id,prerequisite_release_unit_id,condition_type) VALUES($1,$2,'completed')",[next.json().unitIds[1],units[0]]));
  await assert.rejects(db.pool.query('UPDATE learning_unit_versions SET title=$1 WHERE id=$2',['Tampered',oldVersions[0].unit_version_id]));
  c=await signup(`c-${crypto.randomUUID()}@example.test`);const ce=await post('/api/v1/admin/enrollments',{studentId:c,courseId},rootCookie);assert.equal(ce.statusCode,201,ce.body);assert.equal(ce.json().release_id,next.json().id);
  const pinned=(await get(`/api/v1/enrollments/${aEnrollment}/roadmap`,aCookie)).json();assert.equal(pinned.releaseId,releaseId);assert.equal(pinned.percent,old.percent);
  assert.equal((await get(`/api/v1/release-units/${units[0]}`,aCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${units[2]}`,aCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/admin/enrollments/${aEnrollment}/suspend`,{},rootCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${units[0]}`,aCookie)).statusCode,404);
  assert.equal((await put(`/api/v1/release-units/${units[2]}/note`,{body:'Blocked',revision:1},aCookie)).statusCode,404);
  assert.equal((await request('PATCH',`/api/v1/portfolio/artifacts/${artifactId}`,{title:'Blocked',body:'Cannot change',revision:1},aCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment}/activity`,aCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/admin/enrollments/${aEnrollment}/resume`,{},rootCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${units[0]}`,aCookie)).statusCode,200);
 });
 await t.test('feedback acknowledgement gates continuation',async()=>{
  const course=(await post('/api/v1/admin/courses',{title:'Feedback policy'},rootCookie)).json().id;
  const week=(await db.pool.query('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[course,'Week'])).rows[0].id;
  const day=(await db.pool.query('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[week,'Day'])).rows[0].id;
  const chapter=(await db.pool.query('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[day,'Chapter'])).rows[0].id;
  const versions:string[]=[];for(const [i,kind] of ['exercise','feedback','video'].entries()){const unit=(await db.pool.query('INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,$2,$3) RETURNING id',[chapter,i+1,kind])).rows[0].id;versions.push((await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,$2,'ready_for_review') RETURNING id",[unit,kind])).rows[0].id);}
  await db.pool.query("INSERT INTO exercise_definitions(unit_version_id,completion_policy) VALUES($1,'feedback_then_continue')",[versions[0]]);
  const release=await post(`/api/v1/admin/courses/${course}/releases`,{units:[{unitVersionId:versions[0]},{unitVersionId:versions[1],required:false,content:'Feedback text',conditions:[{prerequisiteIndex:0,type:'first_attempt_submitted'}]},{unitVersionId:versions[2],durationSeconds:10}]},rootCookie);assert.equal(release.statusCode,201,release.body);
  const [exercise,feedback,video]=release.json().unitIds;const e=await post('/api/v1/admin/enrollments',{studentId:b,courseId:course},rootCookie);assert.equal(e.statusCode,201,e.body);
  const submitted=await post(`/api/v1/release-units/${exercise}/attempts`,{answer:'My answer'},bCookie);assert.equal(submitted.statusCode,201,submitted.body);assert.equal(submitted.json().state,'submitted');
  assert.equal((await post(`/api/v1/release-units/${exercise}/attempts`,{answer:'Premature revision'},bCookie)).statusCode,409);
  assert.equal((await get(`/api/v1/release-units/${video}`,bCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/release-units/${feedback}`,bCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/enrollments/${e.json().id}/roadmap`,bCookie)).json().currentUnitId,feedback);
  assert.equal((await post(`/api/v1/release-units/${feedback}/complete`,{},bCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${video}`,bCookie)).statusCode,200);
 });
 await t.test('revision-required and submit-to-complete policies',async()=>{
  const course=(await post('/api/v1/admin/courses',{title:'Exercise policies'},rootCookie)).json().id;
  const week=(await db.pool.query('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[course,'Week'])).rows[0].id;
  const day=(await db.pool.query('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[week,'Day'])).rows[0].id;
  const chapter=(await db.pool.query('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[day,'Chapter'])).rows[0].id;
  const versions:string[]=[];for(let i=0;i<2;i++){const unit=(await db.pool.query("INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,$2,'exercise') RETURNING id",[chapter,i+1])).rows[0].id;versions.push((await db.pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,$2,'ready_for_review') RETURNING id",[unit,`Exercise ${i+1}`])).rows[0].id);}
  await db.pool.query("INSERT INTO exercise_definitions(unit_version_id,completion_policy) VALUES($1,'revision_required'),($2,'submit_to_complete')",versions);
  const release=await post(`/api/v1/admin/courses/${course}/releases`,{units:versions.map(unitVersionId=>({unitVersionId}))},rootCookie);assert.equal(release.statusCode,201,release.body);const [first,second]=release.json().unitIds;
  const enrolled=await post('/api/v1/admin/enrollments',{studentId:b,courseId:course},rootCookie);assert.equal(enrolled.statusCode,201,enrolled.body);
  const original=await post(`/api/v1/release-units/${first}/attempts`,{answer:'Original'},bCookie);assert.equal(original.statusCode,201,original.body);
  assert.equal((await post(`/api/v1/instructor/attempts/${original.json().id}/review`,{decision:'needs_revision',message:'Wrong assignment'},staffCookie)).statusCode,404);
  assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:staff,studentId:b,courseId:course},rootCookie)).statusCode,200);
  assert.equal((await post(`/api/v1/instructor/attempts/${original.json().id}/review`,{decision:'completed',message:'Too early'},staffCookie)).statusCode,409);
  assert.equal((await post(`/api/v1/instructor/attempts/${original.json().id}/review`,{decision:'needs_revision',message:'Please revise'},staffCookie)).statusCode,200);
  const revised=await post(`/api/v1/release-units/${first}/attempts`,{answer:'Revised'},bCookie);assert.equal(revised.statusCode,201,revised.body);
  assert.equal((await post(`/api/v1/instructor/attempts/${revised.json().id}/review`,{decision:'completed',message:'Approved'},staffCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/release-units/${second}`,bCookie)).statusCode,200);
  const final=await post(`/api/v1/release-units/${second}/attempts`,{answer:'Final answer'},bCookie);assert.equal(final.statusCode,201,final.body);assert.equal(final.json().state,'completed');
  assert.equal((await get(`/api/v1/enrollments/${enrolled.json().id}/roadmap`,bCookie)).json().percent,100);
 });
 await t.test('publication rejects impossible and duplicate prerequisites',async()=>{
  const {course,versions}=await fixture(['video','exercise','exercise','feedback'],{1:'instructor_approval',2:'submit_to_complete'});
  const unitsFor=(conditions:Record<number,Array<{prerequisiteIndex:number;type:string}>>={})=>versions.map((unitVersionId,i)=>({unitVersionId,...(i===0?{durationSeconds:10}:{}),...(conditions[i]?{conditions:conditions[i]}:{})}));
  const publish=(conditions:Record<number,Array<{prerequisiteIndex:number;type:string}>>)=>post(`/api/v1/admin/courses/${course}/releases`,{units:unitsFor(conditions)},rootCookie);
  assert.equal((await publish({1:[{prerequisiteIndex:0,type:'first_attempt_submitted'}]})).statusCode,422);
  assert.equal((await publish({1:[{prerequisiteIndex:0,type:'review_approved'}]})).statusCode,422);
  assert.equal((await publish({2:[{prerequisiteIndex:2,type:'completed'}]})).statusCode,422);
  assert.equal((await publish({3:[{prerequisiteIndex:2,type:'review_approved'}]})).statusCode,422);
  assert.equal((await publish({2:[{prerequisiteIndex:1,type:'completed'},{prerequisiteIndex:1,type:'completed'}]})).statusCode,422);
  assert.equal((await post(`/api/v1/admin/courses/${course}/releases`,{units:[]},rootCookie)).statusCode,422);
  assert.equal((await post(`/api/v1/admin/courses/${course}/releases`,{units:[unitsFor()[0],unitsFor()[0]]},rootCookie)).statusCode,422);
  const valid=await publish({1:[{prerequisiteIndex:0,type:'completed'}],2:[{prerequisiteIndex:1,type:'review_approved'}],3:[{prerequisiteIndex:1,type:'first_attempt_submitted'}]});assert.equal(valid.statusCode,201,valid.body);
  assert.equal(valid.json().release_number,1);
  const feedbackFixture=await fixture(['exercise','video','feedback'],{0:'feedback_then_continue'});
  const impossible=await post(`/api/v1/admin/courses/${feedbackFixture.course}/releases`,{units:[{unitVersionId:feedbackFixture.versions[0]},{unitVersionId:feedbackFixture.versions[1],durationSeconds:10},{unitVersionId:feedbackFixture.versions[2],conditions:[{prerequisiteIndex:0,type:'first_attempt_submitted'}]}]},rootCookie);assert.equal(impossible.statusCode,422);
 });
 await t.test('simultaneous submissions, reviews, suspension and completion remain single',async()=>{
  const submitFixture=await fixture(['exercise']);const submitRelease=await post(`/api/v1/admin/courses/${submitFixture.course}/releases`,{units:[{unitVersionId:submitFixture.versions[0]}]},rootCookie);assert.equal(submitRelease.statusCode,201,submitRelease.body);
  const submitUnit=submitRelease.json().unitIds[0];const se=await post('/api/v1/admin/enrollments',{studentId:b,courseId:submitFixture.course},rootCookie);assert.equal(se.statusCode,201);
  const simultaneous=await Promise.all([post(`/api/v1/release-units/${submitUnit}/attempts`,{answer:'One'},bCookie),post(`/api/v1/release-units/${submitUnit}/attempts`,{answer:'Two'},bCookie)]);assert.deepEqual(simultaneous.map(x=>x.statusCode).sort(),[201,409]);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM exercise_attempts WHERE enrollment_id=$1',[se.json().id])).rows[0].n,1);
  const approvalFixture=await fixture(['exercise'],{0:'instructor_approval'});const approvalRelease=await post(`/api/v1/admin/courses/${approvalFixture.course}/releases`,{units:[{unitVersionId:approvalFixture.versions[0]}]},rootCookie);assert.equal(approvalRelease.statusCode,201);
  const approvalUnit=approvalRelease.json().unitIds[0];const ae=await post('/api/v1/admin/enrollments',{studentId:a,courseId:approvalFixture.course},rootCookie);assert.equal(ae.statusCode,201);assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:staff,studentId:a,courseId:approvalFixture.course},rootCookie)).statusCode,200);
  const pending=await Promise.all([post(`/api/v1/release-units/${approvalUnit}/attempts`,{answer:'One'},aCookie),post(`/api/v1/release-units/${approvalUnit}/attempts`,{answer:'Two'},aCookie)]);assert.deepEqual(pending.map(x=>x.statusCode).sort(),[201,409]);const attempt=pending.find(x=>x.statusCode===201)!.json().id;
  const decisions=await Promise.all([post(`/api/v1/instructor/attempts/${attempt}/review`,{decision:'completed',message:'Approved'},staffCookie),post(`/api/v1/instructor/attempts/${attempt}/review`,{decision:'needs_revision',message:'Too late'},staffCookie)]);assert.deepEqual(decisions.map(x=>x.statusCode).sort(),[200,409]);
  const finalState=(await get(`/api/v1/enrollments/${ae.json().id}/roadmap`,aCookie)).json().units[0].state;assert.ok(['completed','needs_revision'].includes(finalState));
  if(finalState==='completed')assert.equal((await post(`/api/v1/release-units/${approvalUnit}/attempts`,{answer:'Late revision'},aCookie)).statusCode,409);
  assert.equal((await db.pool.query('SELECT count(*)::int n FROM exercise_reviews WHERE attempt_id=$1',[attempt])).rows[0].n,1);
  const suspensionFixture=await fixture(['exercise']);const suspensionRelease=await post(`/api/v1/admin/courses/${suspensionFixture.course}/releases`,{units:[{unitVersionId:suspensionFixture.versions[0]}]},rootCookie);const su=suspensionRelease.json().unitIds[0];const enrollmentToSuspend=await post('/api/v1/admin/enrollments',{studentId:b,courseId:suspensionFixture.course},rootCookie);const eid=enrollmentToSuspend.json().id;
  const raced=await Promise.all([post(`/api/v1/release-units/${su}/attempts`,{answer:'Racing'},bCookie),post(`/api/v1/admin/enrollments/${eid}/suspend`,{},rootCookie)]);assert.equal(raced[1].statusCode,200);assert.ok([201,404].includes(raced[0].statusCode));assert.equal((await post(`/api/v1/release-units/${su}/attempts`,{answer:'After suspension'},bCookie)).statusCode,404);
  const count=(await db.pool.query("SELECT count(*)::int n FROM student_learning_activity WHERE enrollment_id=$1 AND event='completed'",[aEnrollment])).rows[0].n;
  const repeated=await Promise.all([post(`/api/v1/release-units/${units[3]}/complete`,{},aCookie),post(`/api/v1/release-units/${units[3]}/complete`,{},aCookie)]);assert.deepEqual(repeated.map(x=>x.statusCode),[200,200]);assert.equal((await db.pool.query("SELECT count(*)::int n FROM student_learning_activity WHERE enrollment_id=$1 AND event='completed'",[aEnrollment])).rows[0].n,count+1);
  const videoSession=(await db.pool.query('SELECT id FROM video_watch_sessions WHERE enrollment_id=$1 AND release_unit_id=$2 ORDER BY last_event_at DESC LIMIT 1',[aEnrollment,units[1]])).rows[0].id;
  const videoCount=(await db.pool.query("SELECT count(*)::int n FROM student_learning_activity WHERE enrollment_id=$1 AND release_unit_id=$2 AND event='video_completed'",[aEnrollment,units[1]])).rows[0].n;
  const ends=await Promise.all([post(`/api/v1/video-sessions/${videoSession}/events`,{positionSeconds:10,type:'end'},aCookie),post(`/api/v1/video-sessions/${videoSession}/events`,{positionSeconds:10,type:'end'},aCookie)]);assert.deepEqual(ends.map(x=>x.statusCode),[200,200]);assert.equal((await db.pool.query("SELECT count(*)::int n FROM student_learning_activity WHERE enrollment_id=$1 AND release_unit_id=$2 AND event='video_completed'",[aEnrollment,units[1]])).rows[0].n,videoCount);
 });
 await t.test('activity pages are chronological and cursors stay within one enrollment',async()=>{
  await db.pool.query("INSERT INTO student_learning_activity(enrollment_id,event,created_at) SELECT $1,'pagination_probe',now()+g*interval '1 second' FROM generate_series(1,55) g",[aEnrollment]);
  const first=await get(`/api/v1/enrollments/${aEnrollment}/activity`,aCookie);assert.equal(first.statusCode,200,first.body);
  const page1=first.json();assert.equal(page1.items.length,50);assert.ok(page1.nextCursor);
  assert.equal(page1.items[0].event,'pagination_probe');
  for(let i=1;i<page1.items.length;i++)assert.ok(new Date(page1.items[i-1].created_at).getTime()>=new Date(page1.items[i].created_at).getTime());
  const second=await get(`/api/v1/enrollments/${aEnrollment}/activity?cursor=${page1.nextCursor}`,aCookie);assert.equal(second.statusCode,200,second.body);
  const page2=second.json();assert.ok(page2.items.length>=5);assert.equal(new Set([...page1.items,...page2.items].map((x:{id:string})=>x.id)).size,page1.items.length+page2.items.length);
  assert.equal((await get(`/api/v1/enrollments/${bEnrollment}/activity?cursor=${page1.nextCursor}`,bCookie)).statusCode,422);
 });
});
