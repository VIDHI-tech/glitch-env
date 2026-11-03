-- Environments that already applied the pre-review 0009 on an empty database
-- skip the edited 0009. Replace its function forward so draft edits work there too.
CREATE OR REPLACE FUNCTION glitch_guard_published_definition() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM curriculum_release_units WHERE unit_version_id=OLD.unit_version_id) THEN
  RAISE EXCEPTION 'published exercise definitions are immutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
