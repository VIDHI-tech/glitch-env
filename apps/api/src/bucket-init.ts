import {S3Client,CreateBucketCommand,HeadBucketCommand} from '@aws-sdk/client-s3';
const bucket=process.env.CLOUDFLARE_R2_BUCKET;
if(!bucket||!process.env.R2_ENDPOINT||!process.env.CLOUDFLARE_R2_ACCESS_KEY_ID||!process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY)throw new Error('Local object store configuration missing');
const client=new S3Client({region:'us-east-1',endpoint:process.env.R2_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,secretAccessKey:process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY}});
try{for(let attempt=0;attempt<30;attempt++){try{await client.send(new CreateBucketCommand({Bucket:bucket}));break;}catch(error){if((error as {name?:string}).name==='BucketAlreadyOwnedByYou')break;if(attempt===29)throw error;await new Promise(resolve=>setTimeout(resolve,2000));}}await client.send(new HeadBucketCommand({Bucket:bucket}));console.log('Private local bucket ready',bucket);}finally{client.destroy();}
