CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"active_minutes" integer
);
--> statement-breakpoint
CREATE TABLE "learning_unit_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"learning_objective" text DEFAULT '' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"publication_state" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_day_id_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "days" ADD CONSTRAINT "days_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_unit_versions" ADD CONSTRAINT "learning_unit_versions_unit_id_learning_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."learning_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_units" ADD CONSTRAINT "learning_units_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_day_position" ON "chapters" USING btree ("day_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "days_week_position" ON "days" USING btree ("week_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_versions_unit_version" ON "learning_unit_versions" USING btree ("unit_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "units_chapter_position" ON "learning_units" USING btree ("chapter_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "weeks_course_position" ON "weeks" USING btree ("course_id","position");