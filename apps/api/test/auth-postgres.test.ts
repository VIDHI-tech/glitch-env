import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../src/app.js';
import {Pool} from 'pg';
const url=process.env.TEST_DATABASE_URL;
test('Better Auth stores a new student identity in PostgreSQL', {skip:!url}, async()=>{
 const app=buildApp({databaseUrl:url,origin:'http://127.0.0.1:3002',secret:'temporary-local-test-secret-at-least-32-characters'});
 try{
  const email=`m1-${crypto.randomUUID()}@example.test`;
  const reply=await app.inject({method:'POST',url:'/api/auth/sign-up/email',headers:{host:'127.0.0.1:3002',origin:'http://127.0.0.1:3002'},payload:{name:'M1 Student',email,password:'local-test-password-123456',role:'super_admin'}});
  assert.equal(reply.statusCode,200,reply.body);
  const user=reply.json().user;
  assert.equal(user.email,email);
  const pool=new Pool({connectionString:url});
  try {assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_role_assignments WHERE user_id=$1',[user.id])).rows[0].n,0);} finally {await pool.end();}
  assert.equal((await app.inject('/health/ready')).statusCode,200);
  const unauthenticated=await app.inject('/api/v1/me');
  assert.equal(unauthenticated.statusCode,401);
 }finally{await app.close();}
});
