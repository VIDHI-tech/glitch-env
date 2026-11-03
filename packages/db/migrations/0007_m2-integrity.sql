-- Composite foreign keys make enrollment and release-unit identity inseparable.
CREATE UNIQUE INDEX release_id_course_unique ON curriculum_releases(id,course_id);--> statement-breakpoint
ALTER TABLE enrollments ADD CONSTRAINT enrollment_release_course_fk FOREIGN KEY (release_id,course_id) REFERENCES curriculum_releases(id,course_id);--> statement-breakpoint
CREATE UNIQUE INDEX unit_version_id_unit_unique ON learning_unit_versions(id,unit_id);--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD CONSTRAINT release_unit_version_matches_fk FOREIGN KEY (unit_version_id,unit_id) REFERENCES learning_unit_versions(id,unit_id);--> statement-breakpoint
CREATE UNIQUE INDEX enrollment_id_owner_course_unique ON enrollments(id,student_id,course_id);--> statement-breakpoint
ALTER TABLE portfolio_artifacts ADD CONSTRAINT portfolio_enrollment_owner_fk FOREIGN KEY (enrollment_id,student_id,course_id) REFERENCES enrollments(id,student_id,course_id);--> statement-breakpoint
ALTER TABLE student_unit_progress ADD CONSTRAINT progress_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
ALTER TABLE video_watch_sessions ADD CONSTRAINT video_session_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
ALTER TABLE video_watch_intervals ADD CONSTRAINT video_interval_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
ALTER TABLE exercise_drafts ADD CONSTRAINT draft_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
ALTER TABLE exercise_attempts ADD CONSTRAINT attempt_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
ALTER TABLE student_notes ADD CONSTRAINT note_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
ALTER TABLE student_learning_activity ADD CONSTRAINT activity_assignment_fk FOREIGN KEY (enrollment_id,release_unit_id) REFERENCES enrollment_release_units(enrollment_id,release_unit_id);--> statement-breakpoint
CREATE FUNCTION glitch_check_release_membership() RETURNS trigger AS $$
BEGIN
 IF (SELECT release_id FROM enrollments WHERE id=NEW.enrollment_id) IS DISTINCT FROM
    (SELECT release_id FROM curriculum_release_units WHERE id=NEW.release_unit_id) THEN
   RAISE EXCEPTION 'release unit does not belong to enrollment release';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER enrollment_release_membership BEFORE INSERT OR UPDATE ON enrollment_release_units FOR EACH ROW EXECUTE FUNCTION glitch_check_release_membership();--> statement-breakpoint
CREATE FUNCTION glitch_check_condition_release() RETURNS trigger AS $$
BEGIN
 IF (SELECT release_id FROM curriculum_release_units WHERE id=NEW.release_unit_id) IS DISTINCT FROM
    (SELECT release_id FROM curriculum_release_units WHERE id=NEW.prerequisite_release_unit_id) THEN
   RAISE EXCEPTION 'condition references another release';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER release_condition_membership BEFORE INSERT OR UPDATE ON release_conditions FOR EACH ROW EXECUTE FUNCTION glitch_check_condition_release();--> statement-breakpoint
CREATE FUNCTION glitch_immutable_release() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'published curriculum releases are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER immutable_release BEFORE UPDATE OR DELETE ON curriculum_releases FOR EACH ROW EXECUTE FUNCTION glitch_immutable_release();--> statement-breakpoint
CREATE TRIGGER immutable_release_unit BEFORE UPDATE OR DELETE ON curriculum_release_units FOR EACH ROW EXECUTE FUNCTION glitch_immutable_release();--> statement-breakpoint
CREATE TRIGGER immutable_release_condition BEFORE UPDATE OR DELETE ON release_conditions FOR EACH ROW EXECUTE FUNCTION glitch_immutable_release();--> statement-breakpoint
CREATE FUNCTION glitch_immutable_published_version() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM curriculum_release_units WHERE unit_version_id=OLD.id) AND
    (OLD.title,OLD.description,OLD.learning_objective,OLD.required,OLD.unit_id) IS DISTINCT FROM
    (NEW.title,NEW.description,NEW.learning_objective,NEW.required,NEW.unit_id) THEN
   RAISE EXCEPTION 'published unit versions are immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER immutable_published_version BEFORE UPDATE ON learning_unit_versions FOR EACH ROW EXECUTE FUNCTION glitch_immutable_published_version();--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD CONSTRAINT release_video_duration_positive CHECK (kind <> 'video' OR duration_seconds > 0);--> statement-breakpoint
ALTER TABLE video_watch_intervals ADD CONSTRAINT watch_interval_positive CHECK (start_seconds >= 0 AND end_seconds > start_seconds);--> statement-breakpoint
CREATE INDEX activity_enrollment_time ON student_learning_activity(enrollment_id,created_at DESC);--> statement-breakpoint
CREATE INDEX watch_intervals_enrollment_unit ON video_watch_intervals(enrollment_id,release_unit_id);--> statement-breakpoint
CREATE INDEX review_queue_state ON exercise_attempts(state,submitted_at);
