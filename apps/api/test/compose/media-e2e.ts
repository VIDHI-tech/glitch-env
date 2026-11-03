import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {Pool} from 'pg';
import {S3Client,HeadObjectCommand} from '@aws-sdk/client-s3';
import {bootstrapFirstSuperAdmin} from '../../src/bootstrap.js';

const run=promisify(execFile),origin='http://127.0.0.1:3002',pool=new Pool({connectionString:'postgresql://glitch:local_dev_only@127.0.0.1:55433/glitch'});
const s3=new S3Client({region:'auto',endpoint:'http://127.0.0.1:9000',forcePathStyle:true,credentials:{accessKeyId:'glitch_dev',secretAccessKey:'local_dev_only_change_me'}});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until<T>(label:string,action:()=>Promise<T|false>,timeout=120000):Promise<T>{const end=Date.now()+timeout;let last:unknown;while(Date.now()<end){try{const value=await action();if(value!==false)return value;}catch(error){last=error;}await sleep(500);}throw new Error(`Timed out waiting for ${label}: ${String(last)}`);}
async function api(method:string,path:string,body?:object,cookie?:string){const response=await fetch(`${origin}${path}`,{method,headers:{...(method!=='GET'?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{data=text;}return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function ok(method:string,path:string,body?:object,cookie?:string,status=200){const r=await api(method,path,body,cookie);assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(r.data)}`);return r.data;}
async function account(email:string){const signup=await ok('POST','/api/auth/sign-up/email',{name:email,email,password:'media-e2e-password-12345'});await pool.query('UPDATE "user" SET email_verified=true WHERE id=$1',[signup.user.id]);const login=await api('POST','/api/auth/sign-in/email',{email,password:'media-e2e-password-12345'});assert.equal(login.status,200,JSON.stringify(login.data));assert.ok(login.cookie);return {id:signup.user.id as string,cookie:login.cookie!};}
async function fixture(seconds:number){const directory=await mkdtemp(join(tmpdir(),'glitch-media-e2e-')),file=join(directory,'source.mp4');await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=640x360:rate=25','-f','lavfi','-i','sine=frequency=440','-t',String(seconds),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',file],{timeout:120000});return {bytes:await readFile(file),directory};}
async function put(url:string,bytes:Buffer){return fetch(url,{method:'PUT',headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length),'If-None-Match':'*'},body:bytes});}
async function version(course:string,title:string){const week=(await pool.query('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[course,'Week'])).rows[0].id;const day=(await pool.query('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[week,'Day'])).rows[0].id;const chapter=(await pool.query('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[day,'Chapter'])).rows[0].id;const unit=(await pool.query("INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,1,'video') RETURNING id",[chapter])).rows[0].id;const id=(await pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,$2,'ready_for_review') RETURNING id",[unit,title])).rows[0].id;return {unit,id};}
async function upload(versionId:string,bytes:Buffer,maxDurationSeconds:number){const r=await ok('POST','/api/v1/admin/media/videos/uploads',{unitVersionId:versionId,idempotencyKey:randomUUID(),maxDurationSeconds,sizeBytes:bytes.length},root.cookie,201);const row=(await pool.query('SELECT provider_id FROM media_assets WHERE id=$1',[r.id])).rows[0];assert.equal((await put(r.uploadUrl,bytes)).status,200);return {id:r.id as string,uid:row.provider_id as string,url:r.uploadUrl as string};}
async function state(assetId:string,expected:string){return until(`${assetId} ${expected}`,async()=>{const row=(await pool.query('SELECT state,duration_seconds,failure_reason FROM media_assets WHERE id=$1',[assetId])).rows[0];if(row?.state===expected)return row;if(row?.state==='failed'&&expected!=='failed')throw new Error(`Processing failed: ${row.failure_reason}`);return false;},180000);}
async function compose(...args:string[]){return run('docker',['compose','-f','compose.media-dev.yml','-f','compose.media-ci.yml',...args],{cwd:join(import.meta.dirname,'../../../..'),timeout:60000});}
let root:{id:string;cookie:string};
try{
 await until('API health',async()=>{const r=await fetch(`${origin}/health/ready`);return r.ok?true:false;});
 const suffix=randomUUID(),admin=await account(`media-admin-${suffix}@example.test`),student=await account(`media-a-${suffix}@example.test`),other=await account(`media-b-${suffix}@example.test`);root=admin;await bootstrapFirstSuperAdmin(pool,`media-admin-${suffix}@example.test`);
 const course=(await ok('POST','/api/v1/admin/courses',{title:'Real HLS container verification'},root.cookie,201)).id as string;
 const first=await version(course,'Real MP4');const sample=await fixture(5);
 try{
  const asset=await upload(first.id,sample.bytes,10);const replacement=Buffer.alloc(sample.bytes.length,65);assert.equal((await put(asset.url,replacement)).status,412,'write-once staging PUT must reject replacement');
  const ready=await state(asset.id,'ready');assert.ok(ready.duration_seconds>=5&&ready.duration_seconds<=10,JSON.stringify(ready));
  const release=await ok('POST',`/api/v1/admin/courses/${course}/releases`,{units:[{unitVersionId:first.id,mediaAssetIds:[asset.id]}]},root.cookie,201);const releaseUnit=release.unitIds[0] as string;
  const enrollment=(await ok('POST','/api/v1/admin/enrollments',{studentId:student.id,courseId:course},root.cookie,201)).id as string;
  await ok('POST','/api/v1/admin/enrollments',{studentId:other.id,courseId:course},root.cookie,201);
  const session=await ok('POST',`/api/v1/release-units/${releaseUnit}/video-sessions`,{},student.cookie,201);assert.equal(session.adapter,'r2-hls');
  const playback=await ok('POST',`/api/v1/video-sessions/${session.id}/playback`,{},student.cookie);const manifest=await api('GET',playback.url,undefined,student.cookie);assert.equal(manifest.status,200);assert.match(manifest.data,/^#EXTM3U/);const segment=manifest.data.match(/segment_\d{5}\.ts/)?.[0];assert.ok(segment);const segmentUrl=playback.url.replace('index.m3u8',segment);
  const segmentResponse=await fetch(`${origin}${segmentUrl}`,{headers:{Cookie:student.cookie}});assert.equal(segmentResponse.status,200);assert.ok((await segmentResponse.arrayBuffer()).byteLength>1000);
  assert.equal((await api('GET',segmentUrl,undefined,other.cookie)).status,404);
  const latencies:number[]=[];for(let i=0;i<10;i++){const start=performance.now();const r=await api('GET',segmentUrl,undefined,student.cookie);assert.equal(r.status,200);latencies.push(performance.now()-start);}const concurrentStart=performance.now();const concurrent=await Promise.all(Array.from({length:10},()=>api('GET',segmentUrl,undefined,student.cookie)));assert.ok(concurrent.every(r=>r.status===200));console.log('HLS segment latency ms',JSON.stringify({sequential:latencies,concurrent10:performance.now()-concurrentStart}));
  for(let pos=1;pos<=ready.duration_seconds;pos++){await sleep(1100);const result=await api('POST',`/api/v1/video-sessions/${session.id}/events`,{positionSeconds:pos,type:pos===ready.duration_seconds?'end':'heartbeat'},student.cookie);assert.equal(result.status,200,JSON.stringify(result.data));if(pos===ready.duration_seconds)assert.equal(result.data.completed,true);}
  const roadmap=await ok('GET',`/api/v1/enrollments/${enrollment}/roadmap`,undefined,student.cookie);assert.equal(roadmap.completedRequired,1);
  await pool.query("UPDATE video_watch_sessions SET playback_authorized_until=now()-interval '1 second' WHERE id=$1",[session.id]);assert.equal((await api('GET',segmentUrl,undefined,student.cookie)).status,404);
  await ok('POST',`/api/v1/video-sessions/${session.id}/playback`,{},student.cookie);await ok('POST',`/api/v1/admin/enrollments/${enrollment}/suspend`,{},root.cookie);assert.equal((await api('GET',segmentUrl,undefined,student.cookie)).status,404);
  await ok('POST',`/api/v1/admin/enrollments/${enrollment}/resume`,{},root.cookie);
  assert.equal((await api('POST',`/api/v1/admin/media/${asset.id}/retry`,{},root.cookie)).status,409);
  await ok('POST',`/api/v1/admin/media/${asset.id}/revoke`,{},root.cookie);assert.equal((await api('GET',segmentUrl,undefined,student.cookie)).status,404);
  const alternate=(await pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,2,'Retry video','ready_for_review') RETURNING id",[first.unit])).rows[0].id;
  const failed=await upload(alternate,Buffer.alloc(sample.bytes.length,65),10);await state(failed.id,'failed');const retry=await ok('POST',`/api/v1/admin/media/${failed.id}/retry`,{},root.cookie);assert.notEqual(retry.uploadUrl,failed.url);assert.equal((await put(retry.uploadUrl,sample.bytes)).status,200);await state(failed.id,'ready');
  await until('orphan source cleanup',async()=>{try{await s3.send(new HeadObjectCommand({Bucket:'glitch-private',Key:`hls/source/${failed.uid.slice(4)}.mp4`}));return false;}catch(error){return (error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404?true:false;}},90000);
  const pending=await ok('POST','/api/v1/admin/media/videos/uploads',{unitVersionId:alternate,idempotencyKey:randomUUID(),maxDurationSeconds:10,sizeBytes:sample.bytes.length},root.cookie,201);await pool.query("UPDATE media_assets SET upload_expires_at=now()-interval '1 second' WHERE id=$1",[pending.id]);const renewed=await ok('POST',`/api/v1/admin/media/${pending.id}/retry`,{},root.cookie);assert.notEqual(renewed.uploadUrl,pending.uploadUrl);
  const long=await fixture(20);
  try{
   const third=(await pool.query("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,3,'Interrupted encoding','ready_for_review') RETURNING id",[first.unit])).rows[0].id;
   const interrupted=await upload(third,long.bytes,30);
   await until('actual FFmpeg encoding start',async()=>{const logs=(await compose('logs','--no-color','hls-worker')).stdout;return logs.includes(`HLS encoding started ${interrupted.uid}`)?true:false;},90000);
   const lock=await pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT id FROM media_assets WHERE id=$1 FOR UPDATE NOWAIT',[interrupted.id]);await lock.query('ROLLBACK');}finally{lock.release();}
   assert.equal((await pool.query('SELECT state FROM media_assets WHERE id=$1',[interrupted.id])).rows[0].state,'processing');
   await sleep(500);await compose('kill','-s','SIGKILL','hls-worker');
   assert.equal((await pool.query('SELECT state FROM media_assets WHERE id=$1',[interrupted.id])).rows[0].state,'processing');
   await pool.query("UPDATE media_assets SET updated_at=now()-interval '16 minutes' WHERE id=$1",[interrupted.id]);
   await compose('up','-d','--no-deps','--scale','hls-worker=2','hls-worker');
   const recovered=await state(interrupted.id,'ready');assert.ok(recovered.duration_seconds>=20&&recovered.duration_seconds<=30);
   console.log('WORKER_RESTART_PASS',JSON.stringify({asset:interrupted.id,durationSeconds:recovered.duration_seconds}));
  }finally{await rm(long.directory,{recursive:true,force:true});}
  console.log('REAL_MP4_HLS_PASS',JSON.stringify({asset:asset.id,durationSeconds:ready.duration_seconds,segment,failedRetry:failed.id}));
 }finally{await rm(sample.directory,{recursive:true,force:true});}
}finally{await pool.end();s3.destroy();}
