CREATE OR REPLACE FUNCTION glitch_immutable_published_version() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM curriculum_release_units WHERE unit_version_id=OLD.id) AND
    (OLD.title,OLD.description,OLD.learning_objective,OLD.required,OLD.unit_id,OLD.publication_state) IS DISTINCT FROM
    (NEW.title,NEW.description,NEW.learning_objective,NEW.required,NEW.unit_id,NEW.publication_state) THEN
   RAISE EXCEPTION 'published unit versions are immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
