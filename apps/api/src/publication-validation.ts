import {z} from 'zod';
const id=z.uuid();
export const publicationInput=z.object({units:z.array(z.object({unitVersionId:id,required:z.boolean().default(true),content:z.string().max(100000).default(''),durationSeconds:z.int().positive().max(36000).optional(),mediaAssetIds:z.array(id).max(20).default([]),conditions:z.array(z.object({prerequisiteIndex:z.int().nonnegative(),type:z.enum(['completed','first_attempt_submitted','review_approved'])})).default([])})).min(1).max(500)});
type Queryer={query:(sql:string,values?:any[])=>Promise<{rows:any[];rowCount:number|null}>};
export async function validatePublication(db:Queryer,courseId:string,selection:z.infer<typeof publicationInput>,requiresVideoAsset:boolean){
 const issues:string[]=[];const ids=selection.units.map(u=>u.unitVersionId);
 if(new Set(ids).size!==ids.length)issues.push('Duplicate unit version');
 const rows=await db.query('SELECT v.id,v.unit_id,v.publication_state,u.kind,x.completion_policy FROM learning_unit_versions v JOIN learning_units u ON u.id=v.unit_id JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id LEFT JOIN exercise_definitions x ON x.unit_version_id=v.id WHERE v.id=ANY($1::uuid[]) AND w.course_id=$2',[ids,courseId]);
 const versions=new Map(rows.rows.map(v=>[v.id,v]));const logical=new Set<string>();const capabilities:Array<{kind:string;policy:string}|null>=[];
 for(let i=0;i<selection.units.length;i++){
  const unit=selection.units[i],v=versions.get(unit.unitVersionId);
  if(!v){issues.push(`Unit ${i+1}: version must belong to course and be ready`);capabilities.push(null);continue;}
  if(!['ready_for_review','published'].includes(v.publication_state))issues.push(`Unit ${i+1}: version is not ready`);
  if(logical.has(v.unit_id))issues.push(`Unit ${i+1}: duplicate learning unit`);logical.add(v.unit_id);
  const assets=unit.mediaAssetIds;if(new Set(assets).size!==assets.length)issues.push(`Unit ${i+1}: duplicate media asset`);
  const media=assets.length?await db.query('SELECT id,kind,state,unit_version_id,duration_seconds FROM media_assets WHERE id=ANY($1::uuid[])',[assets]):{rows:[],rowCount:0};
  if(media.rowCount!==assets.length||media.rows.some(a=>a.state!=='ready'||a.unit_version_id!==unit.unitVersionId||a.kind==='stream_video'&&v.kind!=='video')||media.rows.filter(a=>a.kind==='stream_video').length>1)issues.push(`Unit ${i+1}: media must be ready and assigned to this version`);
  const stream=media.rows.find(a=>a.kind==='stream_video');if(stream&&unit.durationSeconds!==undefined&&unit.durationSeconds!==stream.duration_seconds)issues.push(`Unit ${i+1}: video duration differs from media metadata`);
  const policy=v.kind==='exercise'?v.completion_policy:v.kind==='video'?'video_90_end':'acknowledge';
  if(!policy||v.kind==='video'&&(!(stream?.duration_seconds??unit.durationSeconds)||requiresVideoAsset&&!stream))issues.push(`Unit ${i+1}: completion configuration missing`);
  capabilities.push({kind:v.kind,policy});
  const conditions=unit.conditions.map(c=>`${c.prerequisiteIndex}:${c.type}`);if(new Set(conditions).size!==conditions.length)issues.push(`Unit ${i+1}: duplicate release condition`);
  for(const condition of unit.conditions){const pre=capabilities[condition.prerequisiteIndex];if(condition.prerequisiteIndex>=i)issues.push(`Unit ${i+1}: prerequisite must come earlier`);else if(!pre||condition.type==='first_attempt_submitted'&&pre.kind!=='exercise'||condition.type==='review_approved'&&!(pre.kind==='exercise'&&['instructor_approval','revision_required'].includes(pre.policy)))issues.push(`Unit ${i+1}: prerequisite cannot satisfy condition`);}
 }
 for(let i=0;i<selection.units.length;i++)if(capabilities[i]?.policy==='feedback_then_continue'){
  const next=selection.units[i+1];if(!next||capabilities[i+1]?.kind!=='feedback'||!next.conditions.some(c=>c.prerequisiteIndex===i&&c.type==='first_attempt_submitted')||next.conditions.some(c=>c.prerequisiteIndex!==i||c.type!=='first_attempt_submitted'))issues.push(`Unit ${i+1}: feedback policy requires a gated feedback unit immediately afterward`);
 }
 return issues;
}
