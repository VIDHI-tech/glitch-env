import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
export const portfolioArtifacts=pgTable('portfolio_artifacts',{
 id:uuid('id').primaryKey().defaultRandom(),
 studentId:uuid('student_id').notNull().references(()=>user.id),
 courseId:uuid('course_id').notNull().references(()=>courses.id),
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
