ALTER TABLE curriculum_releases ADD CONSTRAINT release_state_valid CHECK (state='published');--> statement-breakpoint
ALTER TABLE enrollments ADD CONSTRAINT enrollment_state_valid CHECK (state IN ('active','suspended'));--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD CONSTRAINT release_unit_kind_valid CHECK (kind IN ('video','exercise','feedback','reflection','handover'));--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD CONSTRAINT release_completion_policy_valid CHECK (completion_policy IN ('video_90_end','acknowledge','submit_to_complete','feedback_then_continue','instructor_approval','revision_required'));--> statement-breakpoint
ALTER TABLE release_conditions ADD CONSTRAINT release_condition_valid CHECK (condition_type IN ('completed','first_attempt_submitted','review_approved'));--> statement-breakpoint
ALTER TABLE student_unit_progress ADD CONSTRAINT unit_progress_state_valid CHECK (state IN ('in_progress','submitted','awaiting_review','needs_revision','completed'));--> statement-breakpoint
ALTER TABLE exercise_attempts ADD CONSTRAINT exercise_attempt_state_valid CHECK (state IN ('submitted','awaiting_review','needs_revision','completed'));--> statement-breakpoint
ALTER TABLE exercise_reviews ADD CONSTRAINT exercise_review_decision_valid CHECK (decision IN ('completed','needs_revision'));--> statement-breakpoint
ALTER TABLE exercise_feedback ADD CONSTRAINT exercise_feedback_decision_valid CHECK (decision IN ('completed','needs_revision'));--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD CONSTRAINT release_unit_position_positive CHECK (position>0);--> statement-breakpoint
ALTER TABLE video_watch_sessions ADD CONSTRAINT video_last_position_nonnegative CHECK (last_position_seconds>=0);--> statement-breakpoint
ALTER TABLE exercise_drafts ADD CONSTRAINT draft_revision_positive CHECK (revision>0);--> statement-breakpoint
ALTER TABLE student_notes ADD CONSTRAINT note_revision_positive CHECK (revision>0);--> statement-breakpoint
ALTER TABLE exercise_attempts ADD CONSTRAINT attempt_number_positive CHECK (attempt_number>0);
