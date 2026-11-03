import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {createDatabase,migrateDatabase} from '@glitch/db';

if(!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required');
const base=new URL(process.env.TEST_DATABASE_URL);
const adminUrl=new URL(base);adminUrl.pathname='/postgres';
const name=`glitch_m2_upgrade_${process.pid}_${Math.floor(Math.random()*100000)}`;
const dbUrl=new URL(base);dbUrl.pathname=`/${name}`;
const full=resolve(process.cwd(),'../../packages/db/migrations');

test('populated 0008 database upgrades through 0010 without changing published work',async t=>{
 const admin=new Pool({connectionString:adminUrl.toString()});
 const subset=await mkdtemp(join(tmpdir(),'glitch-m2-migrations-'));
 let db:ReturnType<typeof createDatabase>|undefined;
 try{
  await admin.query(`CREATE DATABASE ${name}`);
  db=createDatabase(dbUrl.toString());
  const journal=JSON.parse(await readFile(join(full,'meta/_journal.json'),'utf8'));
  const entries=journal.entries.filter((entry:{idx:number})=>entry.idx<=8);
  await mkdir(join(subset,'meta'));
  await writeFile(join(subset,'meta/_journal.json'),JSON.stringify({...journal,entries}));
  for(const entry of entries)await copyFile(join(full,`${entry.tag}.sql`),join(subset,`${entry.tag}.sql`));
  await migrateDatabase(db,subset);
  const q=db.pool.query.bind(db.pool);
  const adminId=(await q('INSERT INTO "user"(name,email,email_verified) VALUES($1,$2,true) RETURNING id',['Upgrade admin','upgrade-admin@example.test'])).rows[0].id;
  const studentId=(await q('INSERT INTO "user"(name,email,email_verified) VALUES($1,$2,true) RETURNING id',['Upgrade student','upgrade-student@example.test'])).rows[0].id;
  const courseId=(await q('INSERT INTO courses(title,state) VALUES($1,$2) RETURNING id',['Old release','published'])).rows[0].id;
  const weekId=(await q('INSERT INTO weeks(course_id,position,title) VALUES($1,1,$2) RETURNING id',[courseId,'Old week'])).rows[0].id;
  const dayId=(await q('INSERT INTO days(week_id,position,title) VALUES($1,1,$2) RETURNING id',[weekId,'Old day'])).rows[0].id;
  const chapterId=(await q('INSERT INTO chapters(day_id,position,title) VALUES($1,1,$2) RETURNING id',[dayId,'Old chapter'])).rows[0].id;
  async function unit(position:number,kind:string,title:string){const unitId=(await q('INSERT INTO learning_units(chapter_id,position,kind) VALUES($1,$2,$3) RETURNING id',[chapterId,position,kind])).rows[0].id;const versionId=(await q("INSERT INTO learning_unit_versions(unit_id,version,title,publication_state) VALUES($1,1,$2,'ready_for_review') RETURNING id",[unitId,title])).rows[0].id;return {unitId,versionId};}
  const exercise=await unit(1,'exercise','Original exercise');
  const feedback=await unit(2,'feedback','Original feedback');
  const draft=await unit(3,'exercise','Draft exercise');
  const publishedDefinition=(await q("INSERT INTO exercise_definitions(unit_version_id,completion_policy,prompt) VALUES($1,'instructor_approval','Original prompt') RETURNING id",[exercise.versionId])).rows[0].id;
  const draftDefinition=(await q("INSERT INTO exercise_definitions(unit_version_id,completion_policy,prompt) VALUES($1,'submit_to_complete','Draft prompt') RETURNING id",[draft.versionId])).rows[0].id;
  const releaseId=(await q('INSERT INTO curriculum_releases(course_id,release_number,published_by) VALUES($1,1,$2) RETURNING id',[courseId,adminId])).rows[0].id;
  const exerciseReleaseId=(await q("INSERT INTO curriculum_release_units(release_id,unit_id,unit_version_id,position,required,kind,completion_policy,content) VALUES($1,$2,$3,1,true,'exercise','instructor_approval','Original content') RETURNING id",[releaseId,exercise.unitId,exercise.versionId])).rows[0].id;
  const feedbackReleaseId=(await q("INSERT INTO curriculum_release_units(release_id,unit_id,unit_version_id,position,required,kind,completion_policy,content) VALUES($1,$2,$3,2,false,'feedback','acknowledge','Original feedback') RETURNING id",[releaseId,feedback.unitId,feedback.versionId])).rows[0].id;
  await q("INSERT INTO release_conditions(release_unit_id,prerequisite_release_unit_id,condition_type) VALUES($1,$2,'first_attempt_submitted')",[feedbackReleaseId,exerciseReleaseId]);
  const enrollmentId=(await q('INSERT INTO enrollments(student_id,course_id,release_id) VALUES($1,$2,$3) RETURNING id',[studentId,courseId,releaseId])).rows[0].id;
  await q('INSERT INTO enrollment_release_units(enrollment_id,release_unit_id) VALUES($1,$2),($1,$3)',[enrollmentId,exerciseReleaseId,feedbackReleaseId]);
  await q("INSERT INTO student_unit_progress(enrollment_id,release_unit_id,state) VALUES($1,$2,'awaiting_review')",[enrollmentId,exerciseReleaseId]);
  await q("INSERT INTO exercise_attempts(enrollment_id,release_unit_id,attempt_number,answer,state) VALUES($1,$2,1,'Original answer','awaiting_review')",[enrollmentId,exerciseReleaseId]);
  await q("INSERT INTO exercise_drafts(enrollment_id,release_unit_id,answer) VALUES($1,$2,'Saved draft')",[enrollmentId,exerciseReleaseId]);
  await q("INSERT INTO student_notes(enrollment_id,release_unit_id,body) VALUES($1,$2,'Saved note')",[enrollmentId,exerciseReleaseId]);
  assert.equal((await q('SELECT count(*)::int n FROM curriculum_release_units WHERE release_id=$1',[releaseId])).rows[0].n,2);
  const through0010=journal.entries.filter((entry:{idx:number})=>entry.idx<=10);
  await writeFile(join(subset,'meta/_journal.json'),JSON.stringify({...journal,entries:through0010}));
  for(const entry of through0010.filter((entry:{idx:number})=>entry.idx>8))await copyFile(join(full,`${entry.tag}.sql`),join(subset,`${entry.tag}.sql`));
  await migrateDatabase(db,subset);
  const released=(await q('SELECT state,release_number FROM curriculum_releases WHERE id=$1',[releaseId])).rows[0];assert.deepEqual(released,{state:'published',release_number:1});
  const snapshot=(await q('SELECT week_title,day_title,chapter_title,content FROM curriculum_release_units WHERE id=$1',[exerciseReleaseId])).rows[0];assert.deepEqual(snapshot,{week_title:'Old week',day_title:'Old day',chapter_title:'Old chapter',content:'Original content'});
  await q("UPDATE days SET title='Changed draft day' WHERE id=$1",[dayId]);
  assert.equal((await q('SELECT day_title FROM curriculum_release_units WHERE id=$1',[exerciseReleaseId])).rows[0].day_title,'Old day');
  assert.equal((await q('SELECT state FROM student_unit_progress WHERE enrollment_id=$1 AND release_unit_id=$2',[enrollmentId,exerciseReleaseId])).rows[0].state,'awaiting_review');
  assert.equal((await q('SELECT answer FROM exercise_attempts WHERE enrollment_id=$1 AND release_unit_id=$2',[enrollmentId,exerciseReleaseId])).rows[0].answer,'Original answer');
  assert.equal((await q('SELECT answer FROM exercise_drafts WHERE enrollment_id=$1 AND release_unit_id=$2',[enrollmentId,exerciseReleaseId])).rows[0].answer,'Saved draft');
  assert.equal((await q('SELECT body FROM student_notes WHERE enrollment_id=$1 AND release_unit_id=$2',[enrollmentId,exerciseReleaseId])).rows[0].body,'Saved note');
  assert.equal((await q('SELECT count(*)::int n FROM release_conditions WHERE release_unit_id=$1',[feedbackReleaseId])).rows[0].n,1);
  await t.test('unpublished definition UPDATE stores the new value',async()=>{const result=await q("UPDATE exercise_definitions SET prompt='Updated draft prompt' WHERE id=$1 RETURNING prompt",[draftDefinition]);assert.equal(result.rows[0].prompt,'Updated draft prompt');});
  await t.test('unpublished definition DELETE removes the row',async()=>{const result=await q('DELETE FROM exercise_definitions WHERE id=$1 RETURNING id',[draftDefinition]);assert.equal(result.rows[0].id,draftDefinition);});
  await t.test('published definition UPDATE and DELETE remain forbidden',async()=>{await assert.rejects(q("UPDATE exercise_definitions SET prompt='Tampered' WHERE id=$1",[publishedDefinition]));await assert.rejects(q('DELETE FROM exercise_definitions WHERE id=$1',[publishedDefinition]));assert.equal((await q('SELECT prompt FROM exercise_definitions WHERE id=$1',[publishedDefinition])).rows[0].prompt,'Original prompt');});
  await q("CREATE OR REPLACE FUNCTION glitch_guard_published_definition() RETURNS trigger AS $$ BEGIN IF EXISTS(SELECT 1 FROM curriculum_release_units WHERE unit_version_id=OLD.unit_version_id) THEN RAISE EXCEPTION 'published exercise definitions are immutable'; END IF; RETURN OLD; END; $$ LANGUAGE plpgsql");
  await migrateDatabase(db,full);
  const repaired=(await q("INSERT INTO exercise_definitions(unit_version_id,completion_policy,prompt) VALUES($1,'submit_to_complete','Before repair') RETURNING id",[draft.versionId])).rows[0].id;
  assert.equal((await q("UPDATE exercise_definitions SET prompt='After repair' WHERE id=$1 RETURNING prompt",[repaired])).rows[0].prompt,'After repair');
 }finally{
  await db?.pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
  await rm(subset,{recursive:true,force:true});
 }
});
