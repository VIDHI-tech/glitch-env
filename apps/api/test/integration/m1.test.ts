import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {resolve} from 'node:path';
import {buildApp} from '../../src/app.js';
import {bootstrapFirstSuperAdmin} from '../../src/bootstrap.js';
import {CaptureMailer} from '../../src/mail.js';
import {createDatabase,migrateDatabase} from '@glitch/db';
if(!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
const base=new URL(process.env.TEST_DATABASE_URL),name=`glitch_m1_it_${process.pid}_${Math.floor(Math.random()*100000)}`;
const adminUrl=new URL(base);adminUrl.pathname='/postgres';
const dbUrl=new URL(base);dbUrl.pathname=`/${name}`;
let admin:Pool,db:ReturnType<typeof createDatabase>,app:ReturnType<typeof buildApp>;
const mailer=new CaptureMailer();
const origin='http://127.0.0.1:3002';
const migrationsFolder=resolve(process.cwd(),'../../packages/db/migrations');
async function post(path:string,payload:object,cookie?:string){return app.inject({method:'POST',url:path,headers:{host:'127.0.0.1:3002',origin,...(cookie?{cookie}:{})},payload});}
async function get(path:string,cookie?:string){return app.inject({method:'GET',url:path,headers:{host:'127.0.0.1:3002',...(cookie?{cookie}:{})}});}
const cookie=(reply:{headers:Record<string,unknown>})=>String(reply.headers['set-cookie']).split(';')[0];
async function signup(email:string,role?:string){const reply=await post('/api/auth/sign-up/email',{name:email.split('@')[0],email,password:'initial-password-12345',role});assert.equal(reply.statusCode,200,reply.body);return reply.json().user.id as string;}
async function verify(email:string){const message=mailer.messages.findLast(m=>m.to===email&&m.subject.startsWith('Verify'));assert.ok(message,`missing verification email for ${email}`);const url=new URL(message.text.split(' ').at(-1));const reply=await get(url.pathname+url.search);assert.ok([200,302].includes(reply.statusCode),reply.body);}
async function login(email:string,password='initial-password-12345'){const r=await post('/api/auth/sign-in/email',{email,password});assert.equal(r.statusCode,200,r.body);return cookie(r);}
before(async()=>{
 admin=new Pool({connectionString:adminUrl.toString()});await admin.query(`CREATE DATABASE ${name}`);
 db=createDatabase(dbUrl.toString());await migrateDatabase(db,migrationsFolder);
 app=buildApp({databaseUrl:dbUrl.toString(),origin,secret:'test-only-better-auth-secret-minimum-32-characters',mailer});
});
after(async()=>{await app?.close();await db?.pool.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();}});
test('Migrations create required constraints and reapply without changing table count',async()=>{
 const tables=await db.pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user','session','account','verification','courses','user_role_assignments','staff_student_assignments','portfolio_artifacts','audit_events')");assert.equal(tables.rows[0].n,9);
 const beforeCount=await db.pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'");await migrateDatabase(db,migrationsFolder);const afterCount=await db.pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'");assert.equal(afterCount.rows[0].n,beforeCount.rows[0].n);
 const fk=await db.pool.query("SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND conrelid='portfolio_artifacts'::regclass");assert.ok(fk.rows[0].n>=2);
 const unique=await db.pool.query("SELECT count(*)::int n FROM pg_indexes WHERE tablename='staff_student_assignments' AND indexdef LIKE '%UNIQUE%'");assert.ok(unique.rows[0].n>=1);
 await assert.rejects(db.pool.query('BEGIN; CREATE TABLE migration_failure_probe(id int); SELECT 1/0; COMMIT'));
 const probe=await db.pool.query("SELECT to_regclass('public.migration_failure_probe') name");assert.equal(probe.rows[0].name,null);
});
test('Registration is student-only; verification, login, session, logout and reset work',async()=>{
 const email=`auth-${crypto.randomUUID()}@example.test`,id=await signup(email,'super_admin');
 const roles=await db.pool.query('SELECT role FROM user_role_assignments WHERE user_id=$1',[id]);assert.deepEqual(roles.rows.map(r=>r.role),['student']);
 const early=await post('/api/auth/sign-in/email',{email,password:'initial-password-12345'});assert.notEqual(early.statusCode,200);
 await verify(email);const signed=await login(email);assert.equal((await get('/api/v1/me',signed)).json().email,email);
 assert.equal((await get('/api/v1/me',signed)).statusCode,200);
 const logout=await post('/api/auth/sign-out',{},signed);assert.equal(logout.statusCode,200,logout.body);assert.equal((await get('/api/v1/me',signed)).statusCode,401);
 const cookie2=await login(email);const reset=await post('/api/auth/request-password-reset',{email,redirectTo:`${origin}/reset-password`});assert.equal(reset.statusCode,200,reset.body);
 const message=mailer.messages.findLast(m=>m.to===email&&m.subject.startsWith('Reset'));assert.ok(message);const resetUrl=new URL(message.text.split(' ').at(-1));const token=resetUrl.searchParams.get('token')||resetUrl.pathname.split('/').at(-1);assert.ok(token);
 const changed=await post('/api/auth/reset-password',{newPassword:'changed-password-12345',token});assert.equal(changed.statusCode,200,changed.body);
 assert.equal((await get('/api/v1/me',cookie2)).statusCode,401);const cookie3=await login(email,'changed-password-12345');assert.equal((await get('/api/v1/me',cookie3)).statusCode,200);
 const tokenRow=await db.pool.query('SELECT token FROM session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[id]);const revoke=await post('/api/auth/revoke-session',{token:tokenRow.rows[0].token},cookie3);assert.equal(revoke.statusCode,200,revoke.body);assert.equal((await get('/api/v1/me',cookie3)).statusCode,401);
 const cookie4=await login(email,'changed-password-12345');await db.pool.query("UPDATE session SET expires_at='2000-01-01 00:00:00' WHERE user_id=$1",[id]);assert.equal((await get('/api/v1/me',cookie4)).statusCode,401);
});
test('Registration rolls back when its mandatory student grant fails',async()=>{
 const email=`rollback-${crypto.randomUUID()}@example.test`;
 await db.pool.query(`CREATE FUNCTION glitch_test_reject_student_role() RETURNS trigger AS $$
 BEGIN
   IF EXISTS (SELECT 1 FROM "user" WHERE id=NEW.user_id AND email LIKE 'rollback-%') THEN
     RAISE EXCEPTION 'intentional student grant failure';
   END IF;
   RETURN NEW;
 END;
 $$ LANGUAGE plpgsql`);
 await db.pool.query('CREATE TRIGGER glitch_test_reject_student_role BEFORE INSERT ON user_role_assignments FOR EACH ROW EXECUTE FUNCTION glitch_test_reject_student_role()');
 try {
  const reply=await post('/api/auth/sign-up/email',{name:'Rollback',email,password:'initial-password-12345',role:'super_admin'});
  assert.notEqual(reply.statusCode,200);
  const users=await db.pool.query('SELECT id FROM "user" WHERE email=$1',[email]);
  assert.equal(users.rowCount,0);
 } finally {
  await db.pool.query('DROP TRIGGER glitch_test_reject_student_role ON user_role_assignments');
  await db.pool.query('DROP FUNCTION glitch_test_reject_student_role()');
 }
});
test('Ownership and assigned staff access are enforced by PostgreSQL routes',async()=>{
 const aEmail=`a-${crypto.randomUUID()}@example.test`,bEmail=`b-${crypto.randomUUID()}@example.test`,iEmail=`i-${crypto.randomUUID()}@example.test`,adminEmail=`admin-${crypto.randomUUID()}@example.test`;
 const a=await signup(aEmail),b=await signup(bEmail),i=await signup(iEmail),root=await signup(adminEmail);for(const email of [aEmail,bEmail,iEmail,adminEmail])await verify(email);
 const aCookie=await login(aEmail),bCookie=await login(bEmail),iCookie=await login(iEmail),rootCookie=await login(adminEmail);
 const unauthorized=await post('/api/v1/admin/roles',{userId:i,role:'instructor'},aCookie);assert.equal(unauthorized.statusCode,403);
 // The test operator bootstraps exactly one verified super-admin in the isolated fixture.
 assert.equal(await bootstrapFirstSuperAdmin(db.pool,adminEmail),root);
 await assert.rejects(bootstrapFirstSuperAdmin(db.pool,adminEmail));
 assert.equal((await post('/api/v1/admin/roles',{userId:i,role:'instructor'},rootCookie)).statusCode,200);
 const course=await post('/api/v1/admin/courses',{title:'M1 Ownership Test'},rootCookie);assert.equal(course.statusCode,200,course.body);const courseId=course.json().id;
 await db.pool.query("UPDATE courses SET state='published' WHERE id=$1",[courseId]);
 const create=await post('/api/v1/portfolio/artifacts',{courseId,title:'Private work',body:'Student A evidence'},aCookie);assert.equal(create.statusCode,201,create.body);const artifact=create.json();
 assert.equal((await get(`/api/v1/portfolio/artifacts/${artifact.id}`,aCookie)).statusCode,200);
 assert.equal((await post('/api/v1/portfolio/artifacts',{courseId,title:'Blocked',body:'x'},aCookie)).statusCode,201);
 const hostile=await app.inject({method:'POST',url:'/api/v1/portfolio/artifacts',headers:{cookie:aCookie,origin:'https://attacker.example'},payload:{courseId,title:'Cross-site',body:'x'}});assert.equal(hostile.statusCode,403);
 assert.equal((await get(`/api/v1/portfolio/artifacts/${artifact.id}`,bCookie)).statusCode,404);
 assert.equal((await app.inject({method:'PATCH',url:`/api/v1/portfolio/artifacts/${artifact.id}`,headers:{cookie:bCookie,origin},payload:{title:'Steal',body:'x',revision:1}})).statusCode,404);
 assert.equal((await get(`/api/v1/portfolio/artifacts/${artifact.id}`)).statusCode,401);
 const staffPath=`/api/v1/staff/students/${a}/courses/${courseId}/artifacts/${artifact.id}`;
 assert.equal((await get(staffPath,iCookie)).statusCode,404);
 assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:i,studentId:a,courseId},aCookie)).statusCode,403);
 assert.equal((await post('/api/v1/admin/staff-assignments',{staffId:i,studentId:a,courseId},rootCookie)).statusCode,200);
 assert.equal((await get(staffPath,iCookie)).statusCode,200);
 await db.pool.query("DELETE FROM user_role_assignments WHERE user_id=$1 AND role='instructor'",[i]);
 assert.equal((await get(staffPath,iCookie)).statusCode,404);
 assert.equal((await post('/api/v1/admin/roles',{userId:i,role:'instructor'},rootCookie)).statusCode,200);
 const other=await post('/api/v1/portfolio/artifacts',{courseId,title:'B work',body:'Student B answer'},bCookie);assert.equal(other.statusCode,201);
 assert.equal((await get(`/api/v1/staff/students/${b}/courses/${courseId}/artifacts/${other.json().id}`,iCookie)).statusCode,404);
 const updated=await app.inject({method:'PATCH',url:`/api/v1/portfolio/artifacts/${artifact.id}`,headers:{cookie:aCookie,origin},payload:{title:'Revised',body:'Evidence revised',revision:1}});assert.equal(updated.statusCode,200,updated.body);
 assert.equal((await app.inject({method:'PATCH',url:`/api/v1/portfolio/artifacts/${artifact.id}`,headers:{cookie:aCookie,origin},payload:{title:'Stale',body:'x',revision:1}})).statusCode,409);
});
