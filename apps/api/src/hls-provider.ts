import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand,CopyObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {matchesMagic,type MediaProvider,type StreamStatus} from './media-provider.js';
const run=promisify(execFile);
function required(name:string){const v=process.env[name];if(!v)throw new Error(`${name} is required for R2/HLS`);return v;}
const safeUid=/^hls:[0-9a-f-]{36}$/i;
const safeFile=/^(index\.m3u8|segment_[0-9]{5}\.ts)$/;
export class R2HlsProvider implements MediaProvider{
 readonly videoKind='r2-hls' as const;
 private bucket:string;private internal:S3Client;private browser:S3Client;
 constructor(){
  this.bucket=required('CLOUDFLARE_R2_BUCKET');const account=process.env.CLOUDFLARE_ACCOUNT_ID;
  const endpoint=process.env.R2_ENDPOINT??(account?`https://${account}.r2.cloudflarestorage.com`:required('R2_ENDPOINT'));
  const credentials={accessKeyId:required('CLOUDFLARE_R2_ACCESS_KEY_ID'),secretAccessKey:required('CLOUDFLARE_R2_SECRET_ACCESS_KEY')};
  const shared={region:'auto',credentials,forcePathStyle:!!process.env.R2_ENDPOINT,requestChecksumCalculation:'WHEN_REQUIRED' as const,responseChecksumValidation:'WHEN_REQUIRED' as const};
  this.internal=new S3Client({...shared,endpoint});this.browser=new S3Client({...shared,endpoint:process.env.R2_PUBLIC_ENDPOINT??endpoint});
 }
 private key(uid:string,file:string){if(!safeUid.test(uid)||!safeFile.test(file))throw new Error('Invalid HLS object');return `hls/output/${uid.slice(4)}/${file}`;}
 private source(uid:string){if(!safeUid.test(uid))throw new Error('Invalid HLS video');return `hls/source/${uid.slice(4)}.mp4`;}
 async createStreamUpload(input:{maxDurationSeconds:number;assetId:string;expiresAt:Date;sizeBytes?:number}){
  if(!input.sizeBytes||input.sizeBytes>100*1024*1024)throw new Error('HLS pilot upload must be 1–100 MiB');
  const uid=`hls:${randomUUID()}`,key=this.source(uid);
  const uploadUrl=await getSignedUrl(this.browser,new PutObjectCommand({Bucket:this.bucket,Key:key,ContentType:'video/mp4',ContentLength:input.sizeBytes,IfNoneMatch:'*'}),{expiresIn:Math.max(1,Math.floor((input.expiresAt.getTime()-Date.now())/1000)),signableHeaders:new Set(['content-type','content-length','if-none-match'])});
  return {uid,uploadUrl};
 }
 async streamStatus(uid:string):Promise<StreamStatus>{
  try{const r=await this.internal.send(new GetObjectCommand({Bucket:this.bucket,Key:`hls/output/${uid.slice(4)}/meta.json`}));const meta=JSON.parse(Buffer.from(await r.Body!.transformToByteArray()).toString());return {uid,state:'ready',readyToStream:true,durationSeconds:meta.durationSeconds};}catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return {uid,state:'processing',readyToStream:false};throw error;}
 }
 async streamPlayback(uid:string,expiresAt:Date,sessionId?:string){if(!safeUid.test(uid)||!sessionId)throw new Error('HLS session required');return {url:`/api/v1/video-sessions/${sessionId}/hls/index.m3u8`,expiresAt:expiresAt.toISOString()};}
 async hlsRead(uid:string,file:string){if(!safeUid.test(uid)||!safeFile.test(file))return null;try{const r=await this.internal.send(new GetObjectCommand({Bucket:this.bucket,Key:this.key(uid,file)}));const bytes=await r.Body!.transformToByteArray();if(bytes.length>8*1024*1024)throw new Error('HLS segment too large');return {bytes,mimeType:file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t'};}catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return null;throw error;}}
 async r2Upload(key:string,mimeType:string,sizeBytes:number,expiresSeconds:number){return getSignedUrl(this.browser,new PutObjectCommand({Bucket:this.bucket,Key:key,ContentType:mimeType,ContentLength:sizeBytes,IfNoneMatch:'*'}),{expiresIn:expiresSeconds,signableHeaders:new Set(['content-type','content-length','if-none-match'])});}
 async r2Download(key:string,expiresSeconds:number){return getSignedUrl(this.browser,new GetObjectCommand({Bucket:this.bucket,Key:key}),{expiresIn:expiresSeconds});}
 async r2Head(key:string){try{const r=await this.internal.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));return {sizeBytes:Number(r.ContentLength),mimeType:r.ContentType??''};}catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return null;throw error;}}
 async r2Validate(key:string,mimeType:string){const r=await this.internal.send(new GetObjectCommand({Bucket:this.bucket,Key:key,Range:'bytes=0-511'}));return !!r.Body&&matchesMagic(await r.Body.transformToByteArray(),mimeType);}
 async r2Promote(tempKey:string,finalKey:string){const source=`${this.bucket}/${tempKey.split('/').map(encodeURIComponent).join('/')}`;await this.internal.send(new CopyObjectCommand({Bucket:this.bucket,Key:finalKey,CopySource:source}));}
 async r2Delete(key:string){await this.internal.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));}
 async sourceExists(uid:string,expectedBytes:number){const h=await this.r2Head(this.source(uid));return !!h&&h.sizeBytes===expectedBytes&&h.mimeType==='video/mp4';}
 async processVideo(uid:string,maxDurationSeconds:number){
  if(!safeUid.test(uid))throw new Error('Invalid HLS video');const directory=await mkdtemp(join(tmpdir(),'glitch-hls-'));
  try{
   const source=await this.internal.send(new GetObjectCommand({Bucket:this.bucket,Key:this.source(uid)}));const bytes=await source.Body!.transformToByteArray();if(bytes.length>100*1024*1024)throw new Error('HLS source too large');const input=join(directory,'source.mp4');await writeFile(input,bytes);
   const probe=await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',input],{timeout:30000});const durationSeconds=Math.ceil(Number(JSON.parse(probe.stdout).format.duration));if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>maxDurationSeconds)throw new Error('HLS duration invalid');
   await run('ffmpeg',['-nostdin','-y','-i',input,'-map','0:v:0','-map','0:a:0?','-vf','scale=-2:480','-c:v','libx264','-preset','veryfast','-crf','28','-c:a','aac','-b:a','96k','-f','hls','-hls_time','4','-hls_playlist_type','vod','-hls_flags','independent_segments','-hls_segment_filename',join(directory,'segment_%05d.ts'),join(directory,'index.m3u8')],{timeout:10*60_000,maxBuffer:1024*1024});
   const files=(await readdir(directory)).filter(f=>/^segment_[0-9]{5}\.ts$/.test(f));if(!files.length||files.length>200)throw new Error('HLS segment count invalid');
   for(const file of files){const data=await readFile(join(directory,file));if(data.length>8*1024*1024)throw new Error('HLS segment too large');await this.internal.send(new PutObjectCommand({Bucket:this.bucket,Key:this.key(uid,file),Body:data,ContentType:'video/mp2t'}));}
   const manifest=await readFile(join(directory,'index.m3u8'));await this.internal.send(new PutObjectCommand({Bucket:this.bucket,Key:this.key(uid,'index.m3u8'),Body:manifest,ContentType:'application/vnd.apple.mpegurl'}));
   await this.internal.send(new PutObjectCommand({Bucket:this.bucket,Key:`hls/output/${uid.slice(4)}/meta.json`,Body:JSON.stringify({durationSeconds}),ContentType:'application/json'}));return durationSeconds;
  }finally{await rm(directory,{recursive:true,force:true});}
 }
}
