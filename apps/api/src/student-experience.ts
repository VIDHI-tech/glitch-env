import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {fromNodeHeaders} from 'better-auth/node';
import {z} from 'zod';
import type {createAuth} from './auth.js';
import type {createDatabase} from '@glitch/db';

type DB=ReturnType<typeof createDatabase>;
type Auth=ReturnType<typeof createAuth>;
const uuid=z.uuid();
const denied=(reply:FastifyReply)=>reply.code(404).send({code:'NOT_FOUND',message:'Learning record unavailable'});

export function registerStudentExperienceRoutes(app:FastifyInstance,database:DB,auth:Auth){
 const {pool}=database;
 async function actor(request:FastifyRequest,reply:FastifyReply){const session=await auth.api.getSession({headers:fromNodeHeaders(request.headers)});if(!session){reply.code(401).send({code:'UNAUTHENTICATED',message:'Sign in to continue'});return null;}return session.user.id;}
 app.get('/api/v1/student/work',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;
  const [drafts,notes,attempts,artifacts,files]=await Promise.all([
   pool.query('SELECT d.release_unit_id,d.answer,d.revision,d.updated_at,v.title,e.course_id,c.title course_title FROM exercise_drafts d JOIN enrollments e ON e.id=d.enrollment_id JOIN courses c ON c.id=e.course_id JOIN curriculum_release_units u ON u.id=d.release_unit_id JOIN learning_unit_versions v ON v.id=u.unit_version_id WHERE e.student_id=$1 ORDER BY d.updated_at DESC',[who]),
   pool.query('SELECT n.release_unit_id,n.body,n.revision,n.updated_at,v.title,e.course_id,c.title course_title FROM student_notes n JOIN enrollments e ON e.id=n.enrollment_id JOIN courses c ON c.id=e.course_id JOIN curriculum_release_units u ON u.id=n.release_unit_id JOIN learning_unit_versions v ON v.id=u.unit_version_id WHERE e.student_id=$1 ORDER BY n.updated_at DESC',[who]),
   pool.query('SELECT a.id,a.release_unit_id,a.answer,a.attempt_number,a.state,a.submitted_at,v.title,e.course_id,c.title course_title,f.message feedback_message,f.decision feedback_decision FROM exercise_attempts a JOIN enrollments e ON e.id=a.enrollment_id JOIN courses c ON c.id=e.course_id JOIN curriculum_release_units u ON u.id=a.release_unit_id JOIN learning_unit_versions v ON v.id=u.unit_version_id LEFT JOIN exercise_feedback f ON f.attempt_id=a.id WHERE e.student_id=$1 ORDER BY a.submitted_at DESC,a.attempt_number DESC',[who]),
   pool.query('SELECT p.id,p.course_id,p.title,p.body,p.revision,p.updated_at,c.title course_title FROM portfolio_artifacts p JOIN courses c ON c.id=p.course_id WHERE p.student_id=$1 ORDER BY p.updated_at DESC',[who]),
   pool.query("SELECT a.id,a.enrollment_id,a.mime_type,a.size_bytes,a.created_at,c.title course_title FROM media_assets a JOIN enrollments e ON e.id=a.enrollment_id JOIN courses c ON c.id=e.course_id WHERE e.student_id=$1 AND a.kind='r2_student' AND a.state='ready' ORDER BY a.created_at DESC",[who])
  ]);
  return {drafts:drafts.rows,notes:notes.rows,attempts:attempts.rows,artifacts:artifacts.rows,files:files.rows};
 });
 app.get<{Params:{id:string}}>('/api/v1/release-units/:id/video-progress',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;if(!uuid.safeParse(request.params.id).success)return denied(reply);
  const own=await pool.query("SELECT e.id enrollment_id,u.duration_seconds,COALESCE(p.state,'not_started') state FROM enrollment_release_units eu JOIN enrollments e ON e.id=eu.enrollment_id JOIN curriculum_release_units u ON u.id=eu.release_unit_id LEFT JOIN student_unit_progress p ON p.enrollment_id=e.id AND p.release_unit_id=u.id WHERE eu.release_unit_id=$1 AND e.student_id=$2 AND e.state='active' AND u.kind='video'",[request.params.id,who]);
  if(!own.rowCount)return denied(reply);const row=own.rows[0];
  const [intervals,last]=await Promise.all([
   pool.query('SELECT start_seconds,end_seconds FROM video_watch_intervals WHERE enrollment_id=$1 AND release_unit_id=$2 ORDER BY start_seconds,end_seconds',[row.enrollment_id,request.params.id]),
   pool.query('SELECT last_position_seconds FROM video_watch_sessions WHERE enrollment_id=$1 AND release_unit_id=$2 ORDER BY last_event_at DESC LIMIT 1',[row.enrollment_id,request.params.id])
  ]);
  let covered=0,start=-1,end=-1;for(const interval of intervals.rows){if(start<0){start=interval.start_seconds;end=interval.end_seconds;}else if(interval.start_seconds<=end)end=Math.max(end,interval.end_seconds);else{covered+=end-start;start=interval.start_seconds;end=interval.end_seconds;}}if(start>=0)covered+=end-start;
  return {lastPositionSeconds:last.rows[0]?.last_position_seconds??0,watchedSeconds:covered,percent:row.duration_seconds?Math.min(100,Math.round(covered/row.duration_seconds*100)):0,completed:row.state==='completed',durationSeconds:row.duration_seconds};
 });
 app.get('/api/v1/instructor/work',async(request,reply)=>{
  const who=await actor(request,reply);if(!who)return;
  const staff=await pool.query("SELECT 1 FROM user_role_assignments WHERE user_id=$1 AND role IN ('instructor','content_admin','super_admin')",[who]);if(!staff.rowCount)return reply.code(403).send({code:'FORBIDDEN',message:'Instructor permission required'});
  const [students,reviews]=await Promise.all([
   pool.query('SELECT e.id enrollment_id,e.student_id,e.course_id,e.state,u.name,u.email,c.title course_title FROM staff_student_assignments s JOIN enrollments e ON e.student_id=s.student_id AND e.course_id=s.course_id JOIN "user" u ON u.id=e.student_id JOIN courses c ON c.id=e.course_id WHERE s.staff_id=$1 ORDER BY c.title,u.name',[who]),
   pool.query("SELECT a.id attempt_id,a.release_unit_id,a.answer,a.attempt_number,a.submitted_at,e.id enrollment_id,e.student_id,e.course_id,u.name student_name,c.title course_title,v.title unit_title FROM exercise_attempts a JOIN enrollments e ON e.id=a.enrollment_id AND e.state='active' JOIN staff_student_assignments s ON s.student_id=e.student_id AND s.course_id=e.course_id JOIN \"user\" u ON u.id=e.student_id JOIN courses c ON c.id=e.course_id JOIN curriculum_release_units ru ON ru.id=a.release_unit_id JOIN learning_unit_versions v ON v.id=ru.unit_version_id WHERE s.staff_id=$1 AND a.state='awaiting_review' AND NOT EXISTS(SELECT 1 FROM exercise_attempts later WHERE later.enrollment_id=a.enrollment_id AND later.release_unit_id=a.release_unit_id AND later.attempt_number>a.attempt_number) ORDER BY a.submitted_at",[who])
  ]);
  return {students:students.rows,reviews:reviews.rows};
 });
}
