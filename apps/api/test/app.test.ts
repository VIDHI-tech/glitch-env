import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import {developmentMailer,productionMailer} from '../src/mail.js';
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
test('development mail capture is loopback only and production email fails closed',async()=>{
 assert.throws(()=>developmentMailer({NODE_ENV:'production',APP_ORIGIN:'http://127.0.0.1:3002'}));
 assert.throws(()=>developmentMailer({NODE_ENV:'development',APP_ORIGIN:'https://example.com'}));
 assert.throws(()=>developmentMailer({NODE_ENV:'development',APP_ORIGIN:'http://127.0.0.1:3002',HOST:'0.0.0.0'}));
 assert.doesNotThrow(()=>developmentMailer({NODE_ENV:'development',APP_ORIGIN:'http://127.0.0.1:3002',HOST:'0.0.0.0',MAIL_CAPTURE_DOCKER:'1'}));
 assert.throws(()=>developmentMailer({NODE_ENV:'production',APP_ORIGIN:'http://127.0.0.1:3002',HOST:'0.0.0.0',MAIL_CAPTURE_DOCKER:'1'}));
 assert.throws(()=>productionMailer({}));
 const capture=developmentMailer({NODE_ENV:'development',APP_ORIGIN:'http://127.0.0.1:3002',HOST:'127.0.0.1'});
 await capture.send({to:'student@example.test',subject:'Verify',text:'Local link'});
 assert.equal(capture.messages.length,1);
});
