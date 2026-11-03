import {createHmac,createSign,timingSafeEqual} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand,CopyObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';

export type StreamStatus={uid:string;state:'pending_upload'|'processing'|'ready'|'failed';readyToStream:boolean;durationSeconds?:number;error?:string};
export interface VideoMediaProvider{
 videoKind?:'cloudflare-stream'|'r2-hls';
 createStreamUpload(input:{maxDurationSeconds:number;assetId:string;expiresAt:Date;sizeBytes?:number}):Promise<{uid:string;uploadUrl:string}>;
 streamStatus(uid:string):Promise<StreamStatus>;
 streamPlayback(uid:string,expiresAt:Date,sessionId?:string):Promise<{url:string;expiresAt:string}>;
 hlsRead?(uid:string,file:string):Promise<{bytes:Uint8Array;mimeType:string}|null>;
}
export interface ObjectMediaProvider{
 r2Upload(key:string,mimeType:string,sizeBytes:number,expiresSeconds:number):Promise<string>;
 r2Download(key:string,expiresSeconds:number):Promise<string>;
 r2Head(key:string):Promise<{sizeBytes:number;mimeType:string}|null>;
 r2Validate(key:string,mimeType:string):Promise<boolean>;
 r2Promote(tempKey:string,finalKey:string):Promise<void>;
 r2Delete(key:string):Promise<void>;
}
export interface MediaProvider extends VideoMediaProvider,ObjectMediaProvider{}

export function verifyStreamWebhook(body:Buffer,header:string|undefined,secret:string,now=Date.now()):boolean{
 if(!header||!secret)return false;
 const fields=Object.fromEntries(header.split(',').map(part=>part.trim().split('=')));
 if(!/^\d{10}$/.test(fields.time??'')||!(/^[a-f0-9]{64}$/i).test(fields.sig1??''))return false;
 if(Math.abs(now-Number(fields.time)*1000)>300000)return false;
 const expected=createHmac('sha256',secret).update(fields.time).update('.').update(body).digest();
 const actual=Buffer.from(fields.sig1,'hex');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}

function env(name:string){const value=process.env[name];if(!value)throw new Error(`${name} is required for M3 media`);return value;}
function normalizeStreamStatus(result:Record<string,any>):StreamStatus{
 const state=result.status?.state;
 return {uid:String(result.uid),state:state==='error'?'failed':result.readyToStream===true&&state==='ready'?'ready':state==='inprogress'||state==='processing'?'processing':'pending_upload',readyToStream:result.readyToStream===true,durationSeconds:Number(result.duration)>0?Math.ceil(Number(result.duration)):undefined,error:result.status?.errReasonCode??undefined};
}

export class CloudflareMediaProvider implements MediaProvider{
 readonly videoKind='cloudflare-stream' as const;
 private readonly accountId:string;private readonly token:string;private readonly customerCode:string;private readonly keyId:string;private readonly privateKey:string;private readonly bucket:string;private readonly r2:S3Client;
 constructor(){
  this.accountId=env('CLOUDFLARE_ACCOUNT_ID');this.token=env('CLOUDFLARE_STREAM_API_TOKEN');this.customerCode=env('CLOUDFLARE_STREAM_CUSTOMER_CODE');this.keyId=env('CLOUDFLARE_STREAM_SIGNING_KEY_ID');this.privateKey=Buffer.from(env('CLOUDFLARE_STREAM_SIGNING_KEY_PEM_BASE64'),'base64').toString('utf8');this.bucket=env('CLOUDFLARE_R2_BUCKET');
  if(!/^[a-zA-Z0-9-]+$/.test(this.customerCode)||!this.privateKey.includes('PRIVATE KEY'))throw new Error('Invalid Stream signing configuration');
  this.r2=new S3Client({region:'auto',endpoint:`https://${this.accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env('CLOUDFLARE_R2_ACCESS_KEY_ID'),secretAccessKey:env('CLOUDFLARE_R2_SECRET_ACCESS_KEY')},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 }
 private async stream(path:string,method:'GET'|'POST',body?:unknown){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream${path}`,{method,headers:{Authorization:`Bearer ${this.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new Error(`Stream API HTTP ${response.status}`);
  const payload=await response.json() as {success:boolean;result?:Record<string,any>};
  if(!payload.success||!payload.result)throw new Error('Stream API rejected request');
  return payload.result;
 }
 async createStreamUpload(input:{maxDurationSeconds:number;assetId:string;expiresAt:Date;sizeBytes?:number}){
  const result=await this.stream('/direct_upload','POST',{maxDurationSeconds:input.maxDurationSeconds,requireSignedURLs:true,expiry:input.expiresAt.toISOString(),meta:{glitchAssetId:input.assetId}});
  if(typeof result.uid!=='string'||typeof result.uploadURL!=='string')throw new Error('Stream upload response incomplete');
  return {uid:result.uid,uploadUrl:result.uploadURL};
 }
 async streamStatus(uid:string){return normalizeStreamStatus(await this.stream(`/${encodeURIComponent(uid)}`,'GET'));}
 async streamPlayback(uid:string,expiresAt:Date){
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:this.keyId})).toString('base64url');
  const claims=Buffer.from(JSON.stringify({sub:uid,kid:this.keyId,exp:Math.floor(expiresAt.getTime()/1000),nbf:Math.floor(Date.now()/1000)-5,downloadable:false})).toString('base64url');
  const data=`${header}.${claims}`;const signature=createSign('RSA-SHA256').update(data).end().sign(this.privateKey).toString('base64url');
  return {url:`https://customer-${this.customerCode}.cloudflarestream.com/${data}.${signature}/iframe`,expiresAt:expiresAt.toISOString()};
 }
 async r2Upload(key:string,mimeType:string,sizeBytes:number,expiresSeconds:number){return getSignedUrl(this.r2,new PutObjectCommand({Bucket:this.bucket,Key:key,ContentType:mimeType,ContentLength:sizeBytes,IfNoneMatch:'*'}),{expiresIn:expiresSeconds,signableHeaders:new Set(['content-type','content-length','if-none-match'])});}
 async r2Download(key:string,expiresSeconds:number){return getSignedUrl(this.r2,new GetObjectCommand({Bucket:this.bucket,Key:key}),{expiresIn:expiresSeconds});}
 async r2Head(key:string){try{const item=await this.r2.send(new HeadObjectCommand({Bucket:this.bucket,Key:key}));return {sizeBytes:Number(item.ContentLength),mimeType:item.ContentType??''};}catch(error){if((error as {name?:string}).name==='NotFound'||(error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return null;throw error;}}
 async r2Validate(key:string,mimeType:string){const item=await this.r2.send(new GetObjectCommand({Bucket:this.bucket,Key:key,Range:'bytes=0-511'}));if(!item.Body)return false;return matchesMagic(await item.Body.transformToByteArray(),mimeType);}
 async r2Promote(tempKey:string,finalKey:string){const source=`${this.bucket}/${tempKey.split('/').map(encodeURIComponent).join('/')}`;await this.r2.send(new CopyObjectCommand({Bucket:this.bucket,Key:finalKey,CopySource:source}));}
 async r2Delete(key:string){await this.r2.send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));}
}

export function configuredMediaProvider(){return process.env.CLOUDFLARE_ACCOUNT_ID?new CloudflareMediaProvider():null;}

export function matchesMagic(data:Uint8Array,mimeType:string){
 const starts=(bytes:number[])=>bytes.every((byte,index)=>data[index]===byte);
 switch(mimeType){
  case 'application/pdf':return starts([37,80,68,70,45]);
  case 'image/png':return starts([137,80,78,71,13,10,26,10]);
  case 'image/jpeg':return starts([255,216,255]);
  case 'image/webp':return starts([82,73,70,70])&&[87,69,66,80].every((byte,index)=>data[index+8]===byte);
  case 'application/zip':return starts([80,75,3,4])||starts([80,75,5,6]);
  case 'text/plain':try{return data.length>0&&!data.includes(0)&&Boolean(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{return false;}
  default:return false;
 }
}
