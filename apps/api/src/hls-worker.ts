import {createDatabase} from '@glitch/db';
import {R2HlsProvider} from './hls-provider.js';
const database=createDatabase(process.env.DATABASE_URL??'');const provider=new R2HlsProvider();
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function recoverStale(){await database.pool.query("UPDATE media_assets SET state='pending_upload',updated_at=now() WHERE kind='stream_video' AND video_provider='r2-hls' AND state='processing' AND updated_at<now()-interval '15 minutes' AND NOT EXISTS (SELECT 1 FROM release_unit_media WHERE asset_id=media_assets.id)");}
async function cleanOrphans(){const rows=await database.pool.query("SELECT provider_id FROM media_assets WHERE video_provider='r2-hls' AND provider_id IS NOT NULL");await provider.cleanupOrphans(new Set(rows.rows.map(row=>row.provider_id)));}
async function next(){
 const c=await database.pool.connect();try{await c.query('BEGIN');let cursor:string|null=null;
  for(;;){
   const rows:{id:string;provider_id:string;max_duration_seconds:number;size_bytes:string|null}[]=(await c.query("SELECT id,provider_id,max_duration_seconds,size_bytes FROM media_assets WHERE kind='stream_video' AND video_provider='r2-hls' AND state='pending_upload' AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 25",[cursor])).rows;
   if(!rows.length)break;
   for(const row of rows){if(!row.size_bytes||!await provider.sourceExists(row.provider_id,Number(row.size_bytes)))continue;
    await c.query("UPDATE media_assets SET state='processing',upload_url=NULL,updated_at=now() WHERE id=$1",[row.id]);await c.query('COMMIT');return row;}
   cursor=rows.at(-1)!.id;
  }
  await c.query('COMMIT');return null;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
let lastCleanup=0;const cleanupInterval=process.env.NODE_ENV==='test'?Number(process.env.HLS_CLEANUP_INTERVAL_MS??5000):60_000;
while(!stopping){try{await recoverStale();if(Date.now()-lastCleanup>cleanupInterval){await cleanOrphans();lastCleanup=Date.now();}const row=await next();if(row){try{const duration=await provider.processVideo(row.provider_id,row.max_duration_seconds);await database.pool.query("UPDATE media_assets SET state='ready',duration_seconds=$1,failure_reason=NULL,updated_at=now() WHERE id=$2 AND state='processing' AND provider_id=$3",[duration,row.id,row.provider_id]);}catch(error){await database.pool.query("UPDATE media_assets SET state='failed',failure_reason=$1,updated_at=now() WHERE id=$2 AND state='processing' AND provider_id=$3",[String(error).slice(0,500),row.id,row.provider_id]);console.error('HLS processing failed',row.id,String(error));}continue;}}catch(error){console.error('HLS worker poll failed',String(error));}await new Promise(resolve=>setTimeout(resolve,5000));}
await database.pool.end();
