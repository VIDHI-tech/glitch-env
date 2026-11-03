CREATE TABLE "curriculum_release_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum_release_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"unit_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"required" boolean NOT NULL,
	"kind" text NOT NULL,
	"completion_policy" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"duration_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "curriculum_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"release_number" integer NOT NULL,
	"state" text DEFAULT 'published' NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_release_units" (
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"answer" text NOT NULL,
	"state" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_version_id" uuid NOT NULL,
	"completion_policy" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_drafts" (
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"message" text NOT NULL,
	"decision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercise_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"prerequisite_release_unit_id" uuid NOT NULL,
	"condition_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_learning_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid,
	"event" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_notes" (
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"body" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_unit_progress" (
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"state" text NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_watch_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"start_seconds" integer NOT NULL,
	"end_seconds" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_watch_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"release_unit_id" uuid NOT NULL,
	"last_position_seconds" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curriculum_release_events" ADD CONSTRAINT "curriculum_release_events_release_id_curriculum_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."curriculum_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_release_events" ADD CONSTRAINT "curriculum_release_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_release_units" ADD CONSTRAINT "curriculum_release_units_release_id_curriculum_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."curriculum_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_release_units" ADD CONSTRAINT "curriculum_release_units_unit_id_learning_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."learning_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_release_units" ADD CONSTRAINT "curriculum_release_units_unit_version_id_learning_unit_versions_id_fk" FOREIGN KEY ("unit_version_id") REFERENCES "public"."learning_unit_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_releases" ADD CONSTRAINT "curriculum_releases_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_releases" ADD CONSTRAINT "curriculum_releases_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_release_units" ADD CONSTRAINT "enrollment_release_units_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_release_units" ADD CONSTRAINT "enrollment_release_units_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_release_id_curriculum_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."curriculum_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_definitions" ADD CONSTRAINT "exercise_definitions_unit_version_id_learning_unit_versions_id_fk" FOREIGN KEY ("unit_version_id") REFERENCES "public"."learning_unit_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_drafts" ADD CONSTRAINT "exercise_drafts_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_drafts" ADD CONSTRAINT "exercise_drafts_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_feedback" ADD CONSTRAINT "exercise_feedback_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exercise_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_feedback" ADD CONSTRAINT "exercise_feedback_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_reviews" ADD CONSTRAINT "exercise_reviews_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."exercise_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_reviews" ADD CONSTRAINT "exercise_reviews_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_conditions" ADD CONSTRAINT "release_conditions_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_conditions" ADD CONSTRAINT "release_conditions_prerequisite_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("prerequisite_release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_learning_activity" ADD CONSTRAINT "student_learning_activity_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_learning_activity" ADD CONSTRAINT "student_learning_activity_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_unit_progress" ADD CONSTRAINT "student_unit_progress_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_unit_progress" ADD CONSTRAINT "student_unit_progress_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch_intervals" ADD CONSTRAINT "video_watch_intervals_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch_intervals" ADD CONSTRAINT "video_watch_intervals_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch_sessions" ADD CONSTRAINT "video_watch_sessions_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_watch_sessions" ADD CONSTRAINT "video_watch_sessions_release_unit_id_curriculum_release_units_id_fk" FOREIGN KEY ("release_unit_id") REFERENCES "public"."curriculum_release_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "release_unit_position" ON "curriculum_release_units" USING btree ("release_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "release_unit_once" ON "curriculum_release_units" USING btree ("release_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_course_number" ON "curriculum_releases" USING btree ("course_id","release_number");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_unit_once" ON "enrollment_release_units" USING btree ("enrollment_id","release_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrollment_student_course" ON "enrollments" USING btree ("student_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_attempt_once" ON "exercise_attempts" USING btree ("enrollment_id","release_unit_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_definition_version" ON "exercise_definitions" USING btree ("unit_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_draft_once" ON "exercise_drafts" USING btree ("enrollment_id","release_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_review_once" ON "exercise_reviews" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_condition_once" ON "release_conditions" USING btree ("release_unit_id","prerequisite_release_unit_id","condition_type");--> statement-breakpoint
CREATE UNIQUE INDEX "student_note_once" ON "student_notes" USING btree ("enrollment_id","release_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_unit_progress_once" ON "student_unit_progress" USING btree ("enrollment_id","release_unit_id");