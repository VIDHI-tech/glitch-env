import { pgTable, uuid, text, integer, bigint, boolean, timestamp, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { user } from './auth-schema.js';
// M1 GLITCH tables. Better Auth's core schema is generated from its adapter config
// before these tables are migrated to a shared production database.
export const courses = pgTable('courses',{
  id:uuid('id').primaryKey().defaultRandom(),
  title:text('title').notNull(),description:text('description').notNull().default(''),
  state:text('state',{enum:['draft','published','archived']}).notNull().default('draft'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
});
export const weeks=pgTable('weeks',{
  id:uuid('id').primaryKey().defaultRandom(),courseId:uuid('course_id').notNull().references(()=>courses.id),
  position:integer('position').notNull(),title:text('title').notNull()
},t=>[uniqueIndex('weeks_course_position').on(t.courseId,t.position)]);
export const days=pgTable('days',{
  id:uuid('id').primaryKey().defaultRandom(),weekId:uuid('week_id').notNull().references(()=>weeks.id),
  position:integer('position').notNull(),title:text('title').notNull(),activeMinutes:integer('active_minutes')
},t=>[uniqueIndex('days_week_position').on(t.weekId,t.position)]);
export const chapters=pgTable('chapters',{
  id:uuid('id').primaryKey().defaultRandom(),dayId:uuid('day_id').notNull().references(()=>days.id),
  position:integer('position').notNull(),title:text('title').notNull()
},t=>[uniqueIndex('chapters_day_position').on(t.dayId,t.position)]);
export const learningUnits=pgTable('learning_units',{
  id:uuid('id').primaryKey().defaultRandom(),chapterId:uuid('chapter_id').notNull().references(()=>chapters.id),
  position:integer('position').notNull(),kind:text('kind',{enum:['video','exercise','feedback','reflection','handover']}).notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[uniqueIndex('units_chapter_position').on(t.chapterId,t.position)]);
export const learningUnitVersions=pgTable('learning_unit_versions',{
  id:uuid('id').primaryKey().defaultRandom(),unitId:uuid('unit_id').notNull().references(()=>learningUnits.id),
  version:integer('version').notNull(),title:text('title').notNull(),description:text('description').notNull().default(''),
  content:text('content').notNull().default(''),
  learningObjective:text('learning_objective').notNull().default(''),required:boolean('required').notNull().default(true),
  publicationState:text('publication_state',{enum:['draft','ready_for_review','published','unpublished','archived']}).notNull().default('draft'),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[uniqueIndex('unit_versions_unit_version').on(t.unitId,t.version)]);

export const userRoleAssignments=pgTable('user_role_assignments',{
 userId:uuid('user_id').notNull().references(()=>user.id),
 role:text('role',{enum:['super_admin','content_admin','instructor','student']}).notNull(),
 grantedBy:uuid('granted_by').references(()=>user.id),
 grantedAt:timestamp('granted_at',{withTimezone:true}).notNull().defaultNow()
},t=>[uniqueIndex('user_role_unique').on(t.userId,t.role)]);
export const staffStudentAssignments=pgTable('staff_student_assignments',{
 staffId:uuid('staff_id').notNull().references(()=>user.id),
 studentId:uuid('student_id').notNull().references(()=>user.id),
 courseId:uuid('course_id').notNull().references(()=>courses.id),
 assignedBy:uuid('assigned_by').notNull().references(()=>user.id),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[uniqueIndex('staff_student_course_unique').on(t.staffId,t.studentId,t.courseId)]);
export const courseAuthorAssignments=pgTable('course_author_assignments',{
 userId:uuid('user_id').notNull().references(()=>user.id),
 courseId:uuid('course_id').notNull().references(()=>courses.id),
 assignedBy:uuid('assigned_by').notNull().references(()=>user.id),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
},t=>[primaryKey({columns:[t.userId,t.courseId]})]);
export const portfolioArtifacts=pgTable('portfolio_artifacts',{
 id:uuid('id').primaryKey().defaultRandom(),
 studentId:uuid('student_id').notNull().references(()=>user.id),
 courseId:uuid('course_id').notNull().references(()=>courses.id),
 enrollmentId:uuid('enrollment_id').references(()=>enrollments.id),
 title:text('title').notNull(),body:text('body').notNull().default(''),
 revision:integer('revision').notNull().default(1),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
 updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()
},t=>[uniqueIndex('portfolio_student_course_id').on(t.studentId,t.courseId,t.id)]);
export const auditEvents=pgTable('audit_events',{
 id:uuid('id').primaryKey().defaultRandom(),
 actorId:uuid('actor_id').notNull().references(()=>user.id),
 action:text('action').notNull(),targetId:uuid('target_id').notNull(),
 detail:text('detail').notNull().default(''),
 createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()
});

// M2: immutable releases and enrollment-keyed student state.
export const curriculumReleases=pgTable('curriculum_releases',{id:uuid('id').primaryKey().defaultRandom(),courseId:uuid('course_id').notNull().references(()=>courses.id),releaseNumber:integer('release_number').notNull(),state:text('state',{enum:['building','published']}).notNull().default('published'),publishedBy:uuid('published_by').notNull().references(()=>user.id),publishedAt:timestamp('published_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('release_course_number').on(t.courseId,t.releaseNumber)]);
export const curriculumReleaseUnits=pgTable('curriculum_release_units',{id:uuid('id').primaryKey().defaultRandom(),releaseId:uuid('release_id').notNull().references(()=>curriculumReleases.id),unitId:uuid('unit_id').notNull().references(()=>learningUnits.id),unitVersionId:uuid('unit_version_id').notNull().references(()=>learningUnitVersions.id),position:integer('position').notNull(),required:boolean('required').notNull(),kind:text('kind').notNull(),completionPolicy:text('completion_policy').notNull(),content:text('content').notNull().default(''),durationSeconds:integer('duration_seconds'),weekId:uuid('week_id').notNull(),weekTitle:text('week_title').notNull(),weekPosition:integer('week_position').notNull(),dayId:uuid('day_id').notNull(),dayTitle:text('day_title').notNull(),dayPosition:integer('day_position').notNull(),chapterId:uuid('chapter_id').notNull(),chapterTitle:text('chapter_title').notNull(),chapterPosition:integer('chapter_position').notNull()},t=>[uniqueIndex('release_unit_position').on(t.releaseId,t.position),uniqueIndex('release_unit_once').on(t.releaseId,t.unitId)]);
export const curriculumReleaseEvents=pgTable('curriculum_release_events',{id:uuid('id').primaryKey().defaultRandom(),releaseId:uuid('release_id').notNull().references(()=>curriculumReleases.id),actorId:uuid('actor_id').notNull().references(()=>user.id),event:text('event').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
export const releaseConditions=pgTable('release_conditions',{id:uuid('id').primaryKey().defaultRandom(),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),prerequisiteReleaseUnitId:uuid('prerequisite_release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),conditionType:text('condition_type').notNull()},t=>[uniqueIndex('release_condition_once').on(t.releaseUnitId,t.prerequisiteReleaseUnitId,t.conditionType)]);
export const enrollments=pgTable('enrollments',{id:uuid('id').primaryKey().defaultRandom(),studentId:uuid('student_id').notNull().references(()=>user.id),courseId:uuid('course_id').notNull().references(()=>courses.id),releaseId:uuid('release_id').notNull().references(()=>curriculumReleases.id),state:text('state',{enum:['active','suspended']}).notNull().default('active'),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('enrollment_student_course').on(t.studentId,t.courseId)]);
export const enrollmentReleaseUnits=pgTable('enrollment_release_units',{enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),assignedAt:timestamp('assigned_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('enrollment_unit_once').on(t.enrollmentId,t.releaseUnitId)]);
export const studentUnitProgress=pgTable('student_unit_progress',{enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),state:text('state').notNull(),completedAt:timestamp('completed_at',{withTimezone:true}),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('student_unit_progress_once').on(t.enrollmentId,t.releaseUnitId)]);
export const videoWatchSessions=pgTable('video_watch_sessions',{id:uuid('id').primaryKey().defaultRandom(),enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),lastPositionSeconds:integer('last_position_seconds').notNull().default(0),lastEventAt:timestamp('last_event_at',{withTimezone:true}).notNull().defaultNow(),expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),playbackAuthorizedUntil:timestamp('playback_authorized_until',{withTimezone:true})});
export const videoWatchIntervals=pgTable('video_watch_intervals',{id:uuid('id').primaryKey().defaultRandom(),enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),startSeconds:integer('start_seconds').notNull(),endSeconds:integer('end_seconds').notNull()});
export const studentLearningActivity=pgTable('student_learning_activity',{id:uuid('id').primaryKey().defaultRandom(),enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').references(()=>curriculumReleaseUnits.id),event:text('event').notNull(),detail:text('detail').notNull().default(''),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
export const exerciseDefinitions=pgTable('exercise_definitions',{id:uuid('id').primaryKey().defaultRandom(),unitVersionId:uuid('unit_version_id').notNull().references(()=>learningUnitVersions.id),completionPolicy:text('completion_policy').notNull(),prompt:text('prompt').notNull().default('')},t=>[uniqueIndex('exercise_definition_version').on(t.unitVersionId)]);
export const exerciseDrafts=pgTable('exercise_drafts',{enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),answer:text('answer').notNull(),revision:integer('revision').notNull().default(1),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('exercise_draft_once').on(t.enrollmentId,t.releaseUnitId)]);
export const exerciseAttempts=pgTable('exercise_attempts',{id:uuid('id').primaryKey().defaultRandom(),enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),attemptNumber:integer('attempt_number').notNull(),answer:text('answer').notNull(),state:text('state').notNull(),submittedAt:timestamp('submitted_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('exercise_attempt_once').on(t.enrollmentId,t.releaseUnitId,t.attemptNumber)]);
export const exerciseFeedback=pgTable('exercise_feedback',{id:uuid('id').primaryKey().defaultRandom(),attemptId:uuid('attempt_id').notNull().references(()=>exerciseAttempts.id),reviewerId:uuid('reviewer_id').notNull().references(()=>user.id),message:text('message').notNull(),decision:text('decision').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow()});
export const exerciseReviews=pgTable('exercise_reviews',{id:uuid('id').primaryKey().defaultRandom(),attemptId:uuid('attempt_id').notNull().references(()=>exerciseAttempts.id),reviewerId:uuid('reviewer_id').notNull().references(()=>user.id),decision:text('decision').notNull(),reviewedAt:timestamp('reviewed_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('exercise_review_once').on(t.attemptId)]);
export const studentNotes=pgTable('student_notes',{enrollmentId:uuid('enrollment_id').notNull().references(()=>enrollments.id),releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),body:text('body').notNull(),revision:integer('revision').notNull().default(1),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('student_note_once').on(t.enrollmentId,t.releaseUnitId)]);

// M3 media metadata; object bytes and provider secrets remain outside PostgreSQL.
export const mediaAssets=pgTable('media_assets',{id:uuid('id').primaryKey().defaultRandom(),kind:text('kind',{enum:['stream_video','r2_resource','r2_student']}).notNull(),state:text('state',{enum:['pending_upload','processing','ready','failed','revoked']}).notNull(),unitVersionId:uuid('unit_version_id').references(()=>learningUnitVersions.id),enrollmentId:uuid('enrollment_id').references(()=>enrollments.id),createdBy:uuid('created_by').notNull().references(()=>user.id),providerId:text('provider_id').unique(),videoProvider:text('video_provider',{enum:['cloudflare-stream','r2-hls']}),objectKey:text('object_key').unique(),uploadUrl:text('upload_url'),uploadExpiresAt:timestamp('upload_expires_at',{withTimezone:true}),mimeType:text('mime_type'),sizeBytes:bigint('size_bytes',{mode:'number'}),durationSeconds:integer('duration_seconds'),maxDurationSeconds:integer('max_duration_seconds'),failureReason:text('failure_reason'),uploadAttempt:integer('upload_attempt').notNull().default(1),idempotencyKey:uuid('idempotency_key').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{withTimezone:true}).notNull().defaultNow()},t=>[uniqueIndex('media_creator_idempotency').on(t.createdBy,t.idempotencyKey)]);
export const releaseUnitMedia=pgTable('release_unit_media',{releaseUnitId:uuid('release_unit_id').notNull().references(()=>curriculumReleaseUnits.id),assetId:uuid('asset_id').notNull().references(()=>mediaAssets.id)},t=>[primaryKey({columns:[t.releaseUnitId,t.assetId]})]);
export const streamWebhookEvents=pgTable('stream_webhook_events',{digest:text('digest').primaryKey(),providerId:text('provider_id').notNull(),receivedAt:timestamp('received_at',{withTimezone:true}).notNull().defaultNow()});
