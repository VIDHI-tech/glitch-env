import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
test('M1 health and unconfigured authentication fail closed',async()=>{
 const app=buildApp();
 try{
  assert.equal((await app.inject('/health/live')).statusCode,200);
  assert.equal((await app.inject('/api/v1/health')).json().status,'ok');
  assert.equal((await app.inject('/health/ready')).statusCode,503);
  assert.equal((await app.inject('/api/v1/me')).statusCode,503);
  assert.equal((await app.inject('/api/auth/get-session')).statusCode,503);
 }finally{await app.close();}
});
