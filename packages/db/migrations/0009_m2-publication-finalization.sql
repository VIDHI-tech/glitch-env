ALTER TABLE curriculum_releases DROP CONSTRAINT release_state_valid;--> statement-breakpoint
ALTER TABLE curriculum_releases ADD CONSTRAINT release_state_valid CHECK (state IN ('building','published'));--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN week_id uuid;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN week_title text;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN week_position integer;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN day_id uuid;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN day_title text;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN day_position integer;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN chapter_id uuid;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN chapter_title text;--> statement-breakpoint
ALTER TABLE curriculum_release_units ADD COLUMN chapter_position integer;--> statement-breakpoint
-- Drizzle applies this migration in one transaction. Remove the old unconditional
-- UPDATE guard before backfilling existing published rows; the table DDL lock is
-- held until the new publication-aware guard is installed and committed.
DROP TRIGGER immutable_release_unit ON curriculum_release_units;--> statement-breakpoint
UPDATE curriculum_release_units ru SET week_id=w.id,week_title=w.title,week_position=w.position,day_id=d.id,day_title=d.title,day_position=d.position,chapter_id=c.id,chapter_title=c.title,chapter_position=c.position FROM learning_units u JOIN chapters c ON c.id=u.chapter_id JOIN days d ON d.id=c.day_id JOIN weeks w ON w.id=d.week_id WHERE ru.unit_id=u.id;--> statement-breakpoint
ALTER TABLE curriculum_release_units ALTER COLUMN week_id SET NOT NULL,ALTER COLUMN week_title SET NOT NULL,ALTER COLUMN week_position SET NOT NULL,ALTER COLUMN day_id SET NOT NULL,ALTER COLUMN day_title SET NOT NULL,ALTER COLUMN day_position SET NOT NULL,ALTER COLUMN chapter_id SET NOT NULL,ALTER COLUMN chapter_title SET NOT NULL,ALTER COLUMN chapter_position SET NOT NULL;--> statement-breakpoint
CREATE FUNCTION glitch_guard_release_child() RETURNS trigger AS $$
DECLARE target_release uuid;
BEGIN
 target_release := CASE WHEN TG_OP='DELETE' THEN OLD.release_id ELSE NEW.release_id END;
 IF TG_OP='UPDATE' AND OLD.release_id IS DISTINCT FROM NEW.release_id AND (SELECT state FROM curriculum_releases WHERE id=OLD.release_id FOR UPDATE) <> 'building' THEN
  RAISE EXCEPTION 'published curriculum releases are immutable';
 END IF;
 IF (SELECT state FROM curriculum_releases WHERE id=target_release FOR UPDATE) <> 'building' THEN
  RAISE EXCEPTION 'published curriculum releases are immutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER guarded_release_unit BEFORE INSERT OR UPDATE OR DELETE ON curriculum_release_units FOR EACH ROW EXECUTE FUNCTION glitch_guard_release_child();--> statement-breakpoint
CREATE FUNCTION glitch_guard_release_condition() RETURNS trigger AS $$
DECLARE target_release uuid;
BEGIN
 target_release := (SELECT release_id FROM curriculum_release_units WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.release_unit_id ELSE NEW.release_unit_id END);
 IF TG_OP='UPDATE' AND OLD.release_unit_id IS DISTINCT FROM NEW.release_unit_id AND (SELECT state FROM curriculum_releases WHERE id=(SELECT release_id FROM curriculum_release_units WHERE id=OLD.release_unit_id) FOR UPDATE) <> 'building' THEN
  RAISE EXCEPTION 'published curriculum releases are immutable';
 END IF;
 IF (SELECT state FROM curriculum_releases WHERE id=target_release FOR UPDATE) <> 'building' THEN
  RAISE EXCEPTION 'published curriculum releases are immutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER immutable_release_condition ON release_conditions;--> statement-breakpoint
CREATE TRIGGER guarded_release_condition BEFORE INSERT OR UPDATE OR DELETE ON release_conditions FOR EACH ROW EXECUTE FUNCTION glitch_guard_release_condition();--> statement-breakpoint
DROP TRIGGER immutable_release ON curriculum_releases;--> statement-breakpoint
CREATE FUNCTION glitch_guard_release() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state <> 'building' OR NEW.state <> 'published' OR (OLD.id,OLD.course_id,OLD.release_number,OLD.published_by) IS DISTINCT FROM (NEW.id,NEW.course_id,NEW.release_number,NEW.published_by) THEN
  RAISE EXCEPTION 'published curriculum releases are immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER guarded_release BEFORE UPDATE OR DELETE ON curriculum_releases FOR EACH ROW EXECUTE FUNCTION glitch_guard_release();--> statement-breakpoint
CREATE FUNCTION glitch_guard_published_definition() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM curriculum_release_units WHERE unit_version_id=OLD.unit_version_id) THEN RAISE EXCEPTION 'published exercise definitions are immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER immutable_published_definition BEFORE UPDATE OR DELETE ON exercise_definitions FOR EACH ROW EXECUTE FUNCTION glitch_guard_published_definition();
