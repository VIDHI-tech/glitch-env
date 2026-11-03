import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../../src/app.js';
import {CaptureMailer} from '../../src/mail.js';
import {bootstrapFirstSuperAdmin} from '../../src/bootstrap.js';
import {createDatabase,migrateDatabase} from '@glitch/db';

test('M4 builder scopes authors, edits drafts, preserves published versions and isolates student progress',async()=>{
 if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required');
 const base=new URL(process.env.TEST_DATABASE_URL),name=`glitch_m4_it_${process.pid}_${Math.floor(Math.random()*100000)}`;
 const adminUrl=new URL(base);adminUrl.pathname='/postgres';const dbUrl=new URL(base);dbUrl.pathname=`/${name}`;
 const admin=new Pool({connectionString:adminUrl.toString()});await admin.query(`CREATE DATABASE ${name}`);
 const db=createDatabase(dbUrl.toString()),mailer=new CaptureMailer(),origin='http://127.0.0.1:5173';
 let app:ReturnType<typeof buildApp>|undefined;
 try{
  await migrateDatabase(db,resolve(process.cwd(),'../../packages/db/migrations'));
  app=buildApp({databaseUrl:dbUrl.toString(),origin,secret:'m4-integration-secret-at-least-32-characters',mailer});
  async function req(method:string,url:string,payload?:object,cookie?:string){return app!.inject({method,url,headers:{host:'127.0.0.1:5173',...(method!=='GET'?{origin}:{}),...(cookie?{cookie}:{})},...(payload?{payload}:{})});}
  async function signup(name:string){const email=`${name}-${randomUUID()}@example.test`,r=await req('POST','/api/auth/sign-up/email',{name,email,password:'test-password-123456789'});assert.equal(r.statusCode,200,r.body);const message=mailer.messages.findLast(x=>x.to===email&&x.subject.startsWith('Verify'));assert.ok(message);const link=new URL(message.text.split(' ').at(-1)!);await req('GET',link.pathname+link.search);return {id:r.json().user.id as string,email};}
  async function login(email:string){const r=await req('POST','/api/auth/sign-in/email',{email,password:'test-password-123456789'});assert.equal(r.statusCode,200,r.body);return String(r.headers['set-cookie']).split(';')[0];}
  const root=await signup('root'),author=await signup('author'),instructor=await signup('instructor'),student=await signup('student');
  await bootstrapFirstSuperAdmin(db.pool,root.email);
  const rootCookie=await login(root.email),authorCookie=await login(author.email),instructorCookie=await login(instructor.email),studentCookie=await login(student.email);
  const post=(path:string,body:object,cookie=rootCookie)=>req('POST',path,body,cookie),get=(path:string,cookie=rootCookie)=>req('GET',path,undefined,cookie);
  assert.equal((await post('/api/v1/admin/roles',{userId:author.id,role:'content_admin'})).statusCode,200);
  assert.equal((await post('/api/v1/admin/roles',{userId:instructor.id,role:'instructor'})).statusCode,200);
  const a=(await post('/api/v1/admin/courses',{title:'M4 Course A'})).json().id,b=(await post('/api/v1/admin/courses',{title:'M4 Course B'})).json().id;
  assert.equal((await post(`/api/v1/admin/builder/courses/${a}/authors`,{userId:author.id})).statusCode,200);
  const authorList=(await get('/api/v1/admin/builder/courses',authorCookie)).json();assert.deepEqual(authorList.map((x:{id:string})=>x.id),[a]);
  assert.equal((await get(`/api/v1/admin/builder/courses/${b}`,authorCookie)).statusCode,404);
  const week=(await post('/api/v1/admin/builder/hierarchy/weeks',{parentId:a,title:'Week 1'},authorCookie)).json().id;
  const day=(await post('/api/v1/admin/builder/hierarchy/days',{parentId:week,title:'Day 1'},authorCookie)).json().id;
  const chapter=(await post('/api/v1/admin/builder/hierarchy/chapters',{parentId:day,title:'Chapter 1'},authorCookie)).json().id;
  const next=(await post('/api/v1/admin/builder/hierarchy/chapters',{parentId:day,title:'Chapter 2'},authorCookie)).json().id;
  assert.equal((await post(`/api/v1/admin/builder/hierarchy/chapters/${next}/move`,{direction:'up'},authorCookie)).statusCode,200);
  const order=(await get(`/api/v1/admin/builder/courses/${a}`,authorCookie)).json().chapters.map((x:{id:string})=>x.id);assert.deepEqual(order,[next,chapter]);
  assert.equal((await req('DELETE',`/api/v1/admin/builder/hierarchy/chapters/${next}`,undefined,authorCookie)).statusCode,200);
  assert.equal((await req('DELETE',`/api/v1/admin/builder/hierarchy/days/${day}`,undefined,authorCookie)).statusCode,409);
  assert.equal((await req('DELETE',`/api/v1/admin/builder/hierarchy/chapters/${chapter}`,undefined,studentCookie)).statusCode,404);
  const disposable=(await post('/api/v1/admin/builder/units',{chapterId:chapter,kind:'reflection',title:'Disposable QA draft',description:'',learningObjective:'',content:'',required:true},authorCookie)).json();
  assert.equal((await req('DELETE',`/api/v1/admin/builder/units/${disposable.unit.id}`,undefined,authorCookie)).statusCode,200);
  const unit=(await post('/api/v1/admin/builder/units',{chapterId:chapter,kind:'exercise',title:'QA exercise',description:'Draft',learningObjective:'Observe',content:'QA fixture',required:true,completionPolicy:'submit_to_complete',prompt:'Describe an observation'},authorCookie)).json();
  const versionId=unit.version.id;
  const edit=await req('PATCH',`/api/v1/admin/builder/unit-versions/${versionId}`,{title:'QA exercise edited',description:'Draft',learningObjective:'Observe',content:'QA fixture revised',required:true,completionPolicy:'submit_to_complete',prompt:'Separate observation from interpretation'},authorCookie);assert.equal(edit.statusCode,200,edit.body);
  assert.equal((await post(`/api/v1/admin/builder/unit-versions/${versionId}/ready`,{},authorCookie)).statusCode,200);
  const selection={units:[{unitVersionId:versionId,required:true,content:'QA fixture revised',mediaAssetIds:[],conditions:[]}]};
  assert.equal((await post(`/api/v1/admin/builder/courses/${a}/preflight`,selection,authorCookie)).json().valid,true);
  const released=await post(`/api/v1/admin/courses/${a}/releases`,selection);assert.equal(released.statusCode,201,released.body);
  assert.equal((await req('DELETE',`/api/v1/admin/builder/units/${unit.unit.id}`,undefined,authorCookie)).statusCode,409);
  assert.equal((await req('PATCH',`/api/v1/admin/builder/unit-versions/${versionId}`,{title:'Tamper',description:'',learningObjective:'',content:'tamper',required:true,completionPolicy:'submit_to_complete',prompt:''},authorCookie)).statusCode,409);
  await assert.rejects(db.pool.query('UPDATE learning_unit_versions SET content=$1 WHERE id=$2',['tamper',versionId]));
  const fork=(await post(`/api/v1/admin/builder/units/${unit.unit.id}/versions`,{},authorCookie)).json();assert.equal(fork.version,2);assert.equal(fork.content,'QA fixture revised');
  const enrollment=await post('/api/v1/admin/enrollments',{studentId:student.id,courseId:a});assert.equal(enrollment.statusCode,201,enrollment.body);
  const e=enrollment.json().id;assert.equal((await get(`/api/v1/admin/builder/enrollments/${e}/progress`,authorCookie)).json().percent,0);
  assert.equal((await get(`/api/v1/admin/builder/enrollments/${e}/progress`,instructorCookie)).statusCode,404);
  assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:instructor.id,studentId:student.id,courseId:a})).statusCode,200);
  assert.equal((await get(`/api/v1/admin/builder/enrollments/${e}/progress`,instructorCookie)).statusCode,200);
  assert.equal((await get(`/api/v1/admin/builder/enrollments/${e}/progress`,studentCookie)).statusCode,404);
  assert.equal((await post('/api/v1/admin/builder/units',{chapterId:chapter,kind:'exercise',title:'Unauthorized',description:'',learningObjective:'',content:'',required:true,completionPolicy:'submit_to_complete'},studentCookie)).statusCode,404);
 }finally{await app?.close();await db.pool.end();await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();}
});
