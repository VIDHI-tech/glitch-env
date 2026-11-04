import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../../src/app.js';
import {CaptureMailer} from '../../src/mail.js';
import {bootstrapFirstSuperAdmin} from '../../src/bootstrap.js';
import {createDatabase,migrateDatabase} from '@glitch/db';

test('M5 student work, notes, progress and review queue are isolated by account',async()=>{
 if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required');
 const base=new URL(process.env.TEST_DATABASE_URL),name=`glitch_m5_it_${process.pid}_${Math.floor(Math.random()*100000)}`,adminUrl=new URL(base),dbUrl=new URL(base);adminUrl.pathname='/postgres';dbUrl.pathname=`/${name}`;
 const admin=new Pool({connectionString:adminUrl.toString()});await admin.query(`CREATE DATABASE ${name}`);const db=createDatabase(dbUrl.toString()),mailer=new CaptureMailer(),origin='http://127.0.0.1:5173';let app:ReturnType<typeof buildApp>|undefined;
 try{
  await migrateDatabase(db,resolve(process.cwd(),'../../packages/db/migrations'));app=buildApp({databaseUrl:dbUrl.toString(),origin,secret:'m5-integration-secret-at-least-32-characters',mailer});
  async function req(method:string,url:string,payload?:object,cookie?:string){return app!.inject({method,url,headers:{host:'127.0.0.1:5173',...(method!=='GET'?{origin}:{}),...(cookie?{cookie}:{})},...(payload?{payload}:{})});}
  async function account(name:string){const email=`${name.toLowerCase()}-${randomUUID()}@example.test`,r=await req('POST','/api/auth/sign-up/email',{name,email,password:'test-password-123456789'});assert.equal(r.statusCode,200,r.body);const mail=mailer.messages.findLast(x=>x.to===email&&x.subject.startsWith('Verify'));assert.ok(mail,`Verification mail missing for ${email}: ${r.body}`);const link=new URL(mail.text.split(' ').at(-1)!);await req('GET',link.pathname+link.search);return {id:r.json().user.id as string,email};}
  async function login(email:string){const r=await req('POST','/api/auth/sign-in/email',{email,password:'test-password-123456789'});assert.equal(r.statusCode,200,r.body);return String(r.headers['set-cookie']).split(';')[0];}
  const root=await account('root'),instructor=await account('instructor'),a=await account('studentA'),b=await account('studentB');await bootstrapFirstSuperAdmin(db.pool,root.email);
  const rootCookie=await login(root.email),instructorCookie=await login(instructor.email),aCookie=await login(a.email),bCookie=await login(b.email);
  const post=(path:string,body:object,cookie=rootCookie)=>req('POST',path,body,cookie),get=(path:string,cookie=rootCookie)=>req('GET',path,undefined,cookie);
  assert.equal((await post('/api/v1/admin/roles',{userId:instructor.id,role:'instructor'})).statusCode,200);
  const course=(await post('/api/v1/admin/courses',{title:'M5 QA fixture'})).json();const week=(await post('/api/v1/admin/builder/hierarchy/weeks',{parentId:course.id,title:'Week 1'})).json();const day=(await post('/api/v1/admin/builder/hierarchy/days',{parentId:week.id,title:'Day 1'})).json();const chapter=(await post('/api/v1/admin/builder/hierarchy/chapters',{parentId:day.id,title:'Chapter 1'})).json();
  const exercise=(await post('/api/v1/admin/builder/units',{chapterId:chapter.id,kind:'exercise',title:'QA exercise',description:'TEST ONLY',learningObjective:'Practice',content:'QA fixture',required:true,completionPolicy:'instructor_approval',prompt:'Explain'})).json();assert.equal((await post(`/api/v1/admin/builder/unit-versions/${exercise.version.id}/ready`,{revision:0})).statusCode,200);
  const release=(await post(`/api/v1/admin/courses/${course.id}/releases`,{units:[{unitVersionId:exercise.version.id,content:'QA fixture',required:true}]})).json();const unitId=release.unitIds[0];
  for(const student of [a,b])assert.equal((await post('/api/v1/admin/enrollments',{studentId:student.id,courseId:course.id})).statusCode,201);
  assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:instructor.id,studentId:a.id,courseId:course.id})).statusCode,200);
  assert.equal((await req('PUT',`/api/v1/release-units/${unitId}/note`,{body:'A private observation',revision:0},aCookie)).statusCode,200);
  assert.equal((await req('PUT',`/api/v1/release-units/${unitId}/exercise-draft`,{answer:'A first draft',revision:0},aCookie)).statusCode,200);
  const workA=(await get('/api/v1/student/work',aCookie)).json(),workB=(await get('/api/v1/student/work',bCookie)).json();assert.equal(workA.notes[0].body,'A private observation');assert.equal(workA.drafts[0].answer,'A first draft');assert.equal(workB.notes.length,0);assert.equal(workB.drafts.length,0);
  const detailB=(await get(`/api/v1/release-units/${unitId}`,bCookie)).json();assert.equal(detailB.note,null);assert.equal(detailB.draft,null);
  const submission=await post(`/api/v1/release-units/${unitId}/attempts`,{answer:'A submitted answer'},aCookie);assert.equal(submission.statusCode,201,submission.body);
  const queue=(await get('/api/v1/instructor/work',instructorCookie)).json();assert.equal(queue.reviews.length,1);assert.equal(queue.reviews[0].student_id,a.id);
  assert.equal((await get('/api/v1/instructor/work',bCookie)).statusCode,403);
  assert.equal((await get(`/api/v1/release-units/${unitId}/attempts`,bCookie)).json().length,0);
  const aEnrollment=(await get('/api/v1/enrollments',aCookie)).json()[0],bEnrollment=(await get('/api/v1/enrollments',bCookie)).json()[0];assert.equal((await get(`/api/v1/enrollments/${aEnrollment.id}/roadmap`,bCookie)).statusCode,404);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment.id}/roadmap`,aCookie)).json().percent,0);assert.equal((await get(`/api/v1/enrollments/${bEnrollment.id}/roadmap`,bCookie)).json().percent,0);
  assert.equal((await post(`/api/v1/instructor/attempts/${submission.json().id}/review`,{decision:'completed',message:'Approved'},instructorCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/enrollments/${aEnrollment.id}/roadmap`,aCookie)).json().percent,100);assert.equal((await get(`/api/v1/enrollments/${bEnrollment.id}/roadmap`,bCookie)).json().percent,0);
 }finally{await app?.close();await db.pool.end();await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();}
});
