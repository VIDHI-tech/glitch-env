import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createVerify,generateKeyPairSync} from 'node:crypto';
import {CloudflareMediaProvider,verifyStreamWebhook,matchesMagic} from '../src/media-provider.js';

test('Stream webhook HMAC binds timestamp and raw bytes',()=>{
 const now=Date.now(),body=Buffer.from('{"uid":"video-1"}'),time=Math.floor(now/1000),secret='test-secret';
 const sig=createHmac('sha256',secret).update(`${time}.`).update(body).digest('hex');
 assert.equal(verifyStreamWebhook(body,`time=${time},sig1=${sig}`,secret,now),true);
 assert.equal(verifyStreamWebhook(Buffer.from('{"uid":"video-2"}'),`time=${time},sig1=${sig}`,secret,now),false);
 assert.equal(verifyStreamWebhook(body,`time=${time},sig1=${sig}`,secret,now+300001),false);
 assert.equal(verifyStreamWebhook(body,`time=${time},sig1=${'0'.repeat(64)}`,secret,now),false);
});

test('R2 upload bytes match the allowed declared type',()=>{
 assert.equal(matchesMagic(Buffer.from('%PDF-1.7'),'application/pdf'),true);
 assert.equal(matchesMagic(Buffer.from('MZ executable'),'application/pdf'),false);
 assert.equal(matchesMagic(Buffer.from([137,80,78,71,13,10,26,10,1]),'image/png'),true);
 assert.equal(matchesMagic(Buffer.from([255,216,255,1]),'image/jpeg'),true);
 assert.equal(matchesMagic(Buffer.from('hello world'),'text/plain'),true);
 assert.equal(matchesMagic(Buffer.from([0,1,2]),'text/plain'),false);
});

test('Stream playback token is signed for one video and expires',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const values:Record<string,string>={CLOUDFLARE_ACCOUNT_ID:'test-account',CLOUDFLARE_STREAM_API_TOKEN:'test-token',CLOUDFLARE_STREAM_CUSTOMER_CODE:'test-code',CLOUDFLARE_STREAM_SIGNING_KEY_ID:'test-key',CLOUDFLARE_STREAM_SIGNING_KEY_PEM_BASE64:Buffer.from(keys.privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'),CLOUDFLARE_R2_BUCKET:'private-test',CLOUDFLARE_R2_ACCESS_KEY_ID:'test-access',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test-secret'};
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 try{Object.assign(process.env,values);const provider=new CloudflareMediaProvider(),expiry=new Date(Date.now()+120000);const playback=await provider.streamPlayback('video-123',expiry);const token=new URL(playback.url).pathname.split('/')[1],parts=token.split('.');assert.equal(parts.length,3);
  const header=JSON.parse(Buffer.from(parts[0],'base64url').toString());const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());assert.equal(header.alg,'RS256');assert.equal(header.kid,'test-key');assert.equal(claims.sub,'video-123');assert.equal(claims.exp,Math.floor(expiry.getTime()/1000));
  assert.equal(createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).end().verify(keys.publicKey,Buffer.from(parts[2],'base64url')),true);
  assert.equal(playback.expiresAt,expiry.toISOString());
  const put=new URL(await provider.r2Upload('staging/student/example','application/pdf',123,120));
  assert.equal(put.searchParams.get('X-Amz-Expires'),'120');
  assert.ok(put.searchParams.get('X-Amz-SignedHeaders')?.includes('content-length'));
  assert.ok(put.searchParams.get('X-Amz-SignedHeaders')?.includes('content-type'));
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
