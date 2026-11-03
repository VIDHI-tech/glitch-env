import {resolve} from 'node:path';
import {createDatabase,migrateDatabase} from '@glitch/db';
import {buildApp} from '../src/app.js';
import {CaptureMailer} from '../src/mail.js';
import {bootstrapFirstSuperAdmin} from '../src/bootstrap.js';

const url=process.env.DATABASE_URL??'';
const parsed=new URL(url);
if(process.env.M4_QA_SEED!=='1'||parsed.pathname!=='/glitch_m4_qa'||!['127.0.0.1','localhost'].includes(parsed.hostname))throw new Error('M4 QA seed requires M4_QA_SEED=1 and a local glitch_m4_qa database');
const origin='http://127.0.0.1:5173',secret=process.env.BETTER_AUTH_SECRET??'local_dev_only_secret_at_least_32_characters';
const password='GlitchQaOnly2026!';
const db=createDatabase(url),mailer=new CaptureMailer();
const app=buildApp({databaseUrl:url,origin,secret,mailer});
async function request(method:string,path:string,payload?:object,cookie?:string){
 const r=await app.inject({method,url:path,headers:{host:'127.0.0.1:5173',...(method!=='GET'?{origin}:{}),...(cookie?{cookie}:{})},...(payload?{payload}:{})});
 if(r.statusCode>=400)throw new Error(`${method} ${path}: ${r.statusCode} ${r.body}`);
 return r;
}
const post=(path:string,body:object,cookie?:string)=>request('POST',path,body,cookie);
async function account(name:string,email:string){
 const r=await post('/api/auth/sign-up/email',{name,email,password});
 const mail=mailer.messages.findLast(x=>x.to===email&&x.subject.startsWith('Verify'));
 if(!mail)throw new Error(`Verification email missing for ${email}`);
 const link=new URL(mail.text.split(' ').at(-1)!);await request('GET',link.pathname+link.search);
 return r.json().user.id as string;
}
async function session(email:string){const r=await post('/api/auth/sign-in/email',{email,password});return String(r.headers['set-cookie']).split(';')[0];}
try{
 await migrateDatabase(db,resolve(import.meta.dirname,'../../../packages/db/migrations'));
 if((await db.pool.query("SELECT 1 FROM courses WHERE title='GLITCH QA · Discovery & Sense-Making'")).rowCount){console.log('M4 QA fixture already exists; no changes made');process.exitCode=0;}
 else{
  const root=await account('QA Super Admin','admin@glitch.local');
  const content=await account('QA Content Admin','content@glitch.local');
  const instructor=await account('QA Instructor','instructor@glitch.local');
  const studentA=await account('QA Student A','student.a@glitch.local');
  const studentB=await account('QA Student B','student.b@glitch.local');
  await bootstrapFirstSuperAdmin(db.pool,'admin@glitch.local');const cookie=await session('admin@glitch.local');
  await post('/api/v1/admin/roles',{userId:content,role:'content_admin'},cookie);
  await post('/api/v1/admin/roles',{userId:instructor,role:'instructor'},cookie);
  const c=(await post('/api/v1/admin/courses',{title:'GLITCH QA · Discovery & Sense-Making'},cookie)).json();
  await request('PATCH',`/api/v1/admin/builder/courses/${c.id}`,{title:'GLITCH QA · Discovery & Sense-Making',description:'TEST-ONLY fixture using draft topic labels from the legacy GLITCH seed. Not reviewed teaching content.'},cookie);
  await post(`/api/v1/admin/builder/courses/${c.id}/authors`,{userId:content},cookie);
  const week=(await post('/api/v1/admin/builder/hierarchy/weeks',{parentId:c.id,title:'Week 1 · Discovery & sense-making'},cookie)).json();
  const day1=(await post('/api/v1/admin/builder/hierarchy/days',{parentId:week.id,title:'See First. Explain Later.',activeMinutes:225},cookie)).json();
  const day2=(await post('/api/v1/admin/builder/hierarchy/days',{parentId:week.id,title:'Stakeholders, Research & Sense-Making',activeMinutes:255},cookie)).json();
  const chapter1=(await post('/api/v1/admin/builder/hierarchy/chapters',{parentId:day1.id,title:'Observation versus interpretation'},cookie)).json();
  const chapter2=(await post('/api/v1/admin/builder/hierarchy/chapters',{parentId:day2.id,title:'Evidence quality and provenance'},cookie)).json();
  const exercise=(await post('/api/v1/admin/builder/units',{chapterId:chapter1.id,kind:'exercise',title:'QA practice · Observation versus interpretation',description:'TEST-ONLY fixture',learningObjective:'Distinguish an observation from an interpretation',content:'QA FIXTURE — use an observation and an interpretation from a test scenario. This is not finalized GLITCH teaching material.',required:true,completionPolicy:'submit_to_complete',prompt:'QA FIXTURE — write one observation and one interpretation.'},cookie)).json();
  const reflection=(await post('/api/v1/admin/builder/units',{chapterId:chapter2.id,kind:'reflection',title:'QA reflection · Evidence quality',description:'TEST-ONLY fixture',learningObjective:'Reflect on evidence quality',content:'QA FIXTURE — reflect on the evidence used in the test exercise.',required:true},cookie)).json();
  await post(`/api/v1/admin/builder/unit-versions/${exercise.version.id}/ready`,{},cookie);
  await post(`/api/v1/admin/builder/unit-versions/${reflection.version.id}/ready`,{},cookie);
  const release=(await post(`/api/v1/admin/courses/${c.id}/releases`,{units:[{unitVersionId:exercise.version.id,content:'QA FIXTURE — practice exercise',required:true},{unitVersionId:reflection.version.id,content:'QA FIXTURE — reflection',required:true,conditions:[{prerequisiteIndex:0,type:'completed'}]}]},cookie)).json();
  await post('/api/v1/admin/builder/units',{chapterId:chapter1.id,kind:'video',title:'QA draft · Observation versus interpretation',description:'TEST-ONLY video placeholder',learningObjective:'Observe before interpreting',content:'QA FIXTURE — upload a test MP4. No finalized video content is supplied.',required:true},cookie);
  await post('/api/v1/admin/staff-assignments',{staffId:instructor,studentId:studentA,courseId:c.id},cookie);
  await post('/api/v1/admin/enrollments',{studentId:studentA,courseId:c.id},cookie);
  await post('/api/v1/admin/enrollments',{studentId:studentB,courseId:c.id},cookie);
  const studentCookie=await session('student.a@glitch.local');
  await post(`/api/v1/release-units/${release.unitIds[0]}/attempts`,{answer:'QA FIXTURE answer: observation recorded; interpretation separated.'},studentCookie);
  console.log('M4 QA fixture created',JSON.stringify({courseId:c.id,releaseId:release.id,superAdmin:root,contentAdmin:content,studentA,studentB}));
  console.log('Local-only password for all QA accounts:',password);
 }
}finally{await app.close();await db.pool.end();}
