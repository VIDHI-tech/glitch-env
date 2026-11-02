import type {FastifyInstance,FastifyReply,FastifyRequest} from 'fastify';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import type {createAuth} from './auth.js';
import type {createDatabase} from '@glitch/db';
type Database=ReturnType<typeof createDatabase>;
type Auth=ReturnType<typeof createAuth>;
const uuid=z.uuid();
const artifactInput=z.object({courseId:uuid,title:z.string().trim().min(1).max(200),body:z.string().max(100000).default('')});
const revisionInput=z.object({title:z.string().trim().min(1).max(200),body:z.string().max(100000),revision:z.int().positive()});
const grantInput=z.object({userId:uuid,role:z.enum(['super_admin','content_admin','instructor'])});
const assignmentInput=z.object({staffId:uuid,studentId:uuid,courseId:uuid});
const courseInput=z.object({title:z.string().trim().min(1).max(200)});
const invalid=(reply:FastifyReply)=>reply.code(422).send({code:'INVALID_INPUT',message:'Check the request fields'});
export function registerWorkspaceRoutes(app:FastifyInstance,database:Database,auth:Auth){
 const {pool}=database;
 async function identity(request:FastifyRequest,reply:FastifyReply){
  const session=await auth.api.getSession({headers:fromNodeHeaders(request.headers)});
  if(!session){reply.code(401).send({code:'UNAUTHENTICATED',message:'Sign in to continue'});return null;}
  return session.user.id;
 }
 async function superAdmin(userId:string){const result=await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role='super_admin'",[userId]);return result.rowCount===1;}
 async function assigned(staffId:string,studentId:string,courseId:string){const result=await pool.query("SELECT 1 FROM staff_student_assignments a JOIN user_role_assignments r ON r.user_id=a.staff_id AND r.role IN ('instructor','content_admin','super_admin') WHERE a.staff_id=$1 AND a.student_id=$2 AND a.course_id=$3",[staffId,studentId,courseId]);return result.rowCount===1;}
 app.post('/api/v1/admin/courses',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  if(!await superAdmin(actor))return reply.code(403).send({code:'FORBIDDEN',message:'Administrator permission required'});
  const parsed=courseInput.safeParse(request.body);if(!parsed.success)return invalid(reply);
  const client=await pool.connect();try{
   await client.query('BEGIN');
   const course=await client.query("INSERT INTO courses(title) VALUES($1) RETURNING id,title,state",[parsed.data.title]);
   await client.query('INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES($1,$2,$3,$4)',[actor,'create_course',course.rows[0].id,parsed.data.title]);
   await client.query('COMMIT');return course.rows[0];
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 app.post('/api/v1/admin/roles',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  if(!await superAdmin(actor))return reply.code(403).send({code:'FORBIDDEN',message:'Administrator permission required'});
  const parsed=grantInput.safeParse(request.body);if(!parsed.success)return invalid(reply);
  const client=await pool.connect();try{
   await client.query('BEGIN');
   const target=await client.query('SELECT 1 FROM "user" WHERE id=$1 AND email_verified=true',[parsed.data.userId]);
   if(target.rowCount!==1){await client.query('ROLLBACK');return reply.code(404).send({code:'NOT_FOUND',message:'Verified user not found'});}
   await client.query('INSERT INTO user_role_assignments(user_id,role,granted_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[parsed.data.userId,parsed.data.role,actor]);
   await client.query('INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES($1,$2,$3,$4)',[actor,'grant_role',parsed.data.userId,parsed.data.role]);
   await client.query('COMMIT');return {ok:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 app.post('/api/v1/admin/staff-assignments',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  if(!await superAdmin(actor))return reply.code(403).send({code:'FORBIDDEN',message:'Administrator permission required'});
  const parsed=assignmentInput.safeParse(request.body);if(!parsed.success)return invalid(reply);
  const {staffId,studentId,courseId}=parsed.data;
  const client=await pool.connect();try{
   await client.query('BEGIN');
   const staff=await client.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role IN ('instructor','content_admin','super_admin')",[staffId]);
   const student=await client.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role='student'",[studentId]);
   const course=await client.query('SELECT 1 FROM courses WHERE id=$1',[courseId]);
   if(!staff.rowCount||!student.rowCount||!course.rowCount){await client.query('ROLLBACK');return reply.code(404).send({code:'NOT_FOUND',message:'Staff, student or course not found'});}
   await client.query('INSERT INTO staff_student_assignments(staff_id,student_id,course_id,assigned_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[staffId,studentId,courseId,actor]);
   await client.query('INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES($1,$2,$3,$4)',[actor,'assign_staff',studentId,courseId]);
   await client.query('COMMIT');return {ok:true};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 });
 app.post('/api/v1/portfolio/artifacts',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  const parsed=artifactInput.safeParse(request.body);if(!parsed.success)return invalid(reply);
  const role=await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role='student'",[actor]);
  if(!role.rowCount)return reply.code(403).send({code:'FORBIDDEN',message:'Student role required'});
  const course=await pool.query("SELECT 1 FROM courses WHERE id=$1 AND state='published'",[parsed.data.courseId]);
  if(!course.rowCount)return reply.code(404).send({code:'NOT_FOUND',message:'Published course not found'});
  const result=await pool.query('INSERT INTO portfolio_artifacts(student_id,course_id,title,body) VALUES($1,$2,$3,$4) RETURNING id,course_id,title,body,revision',[actor,parsed.data.courseId,parsed.data.title,parsed.data.body]);
  return reply.code(201).send(result.rows[0]);
 });
 app.get<{Params:{id:string}}>('/api/v1/portfolio/artifacts/:id',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  if(!uuid.safeParse(request.params.id).success)return reply.code(404).send({code:'NOT_FOUND',message:'Artifact not found'});
  const result=await pool.query('SELECT id,student_id,course_id,title,body,revision FROM portfolio_artifacts WHERE id=$1 AND student_id=$2',[request.params.id,actor]);
  if(!result.rowCount)return reply.code(404).send({code:'NOT_FOUND',message:'Artifact not found'});
  return result.rows[0];
 });
 app.patch<{Params:{id:string}}>('/api/v1/portfolio/artifacts/:id',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  if(!uuid.safeParse(request.params.id).success)return reply.code(404).send({code:'NOT_FOUND',message:'Artifact not found'});
  const parsed=revisionInput.safeParse(request.body);if(!parsed.success)return invalid(reply);
  const result=await pool.query('UPDATE portfolio_artifacts SET title=$1,body=$2,revision=revision+1,updated_at=now() WHERE id=$3 AND student_id=$4 AND revision=$5 RETURNING id,title,body,revision',[parsed.data.title,parsed.data.body,request.params.id,actor,parsed.data.revision]);
  if(result.rowCount)return result.rows[0];
  const exists=await pool.query('SELECT 1 FROM portfolio_artifacts WHERE id=$1 AND student_id=$2',[request.params.id,actor]);
  return reply.code(exists.rowCount?409:404).send({code:exists.rowCount?'REVISION_CONFLICT':'NOT_FOUND',message:exists.rowCount?'Reload before saving':'Artifact not found'});
 });
 app.get<{Params:{studentId:string;courseId:string;artifactId:string}}>('/api/v1/staff/students/:studentId/courses/:courseId/artifacts/:artifactId',async(request,reply)=>{
  const actor=await identity(request,reply);if(!actor)return;
  const {studentId,courseId,artifactId}=request.params;
  if(![studentId,courseId,artifactId].every(x=>uuid.safeParse(x).success))return reply.code(404).send({code:'NOT_FOUND',message:'Artifact not found'});
  if(!await assigned(actor,studentId,courseId))return reply.code(404).send({code:'NOT_FOUND',message:'Artifact not found'});
  const result=await pool.query('SELECT id,student_id,course_id,title,body,revision FROM portfolio_artifacts WHERE id=$1 AND student_id=$2 AND course_id=$3',[artifactId,studentId,courseId]);
  if(!result.rowCount)return reply.code(404).send({code:'NOT_FOUND',message:'Artifact not found'});
  return result.rows[0];
 });
}
