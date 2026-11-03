CREATE TABLE course_author_assignments (
  user_id uuid NOT NULL REFERENCES "user"(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  assigned_by uuid NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, course_id)
);
CREATE INDEX course_author_assignments_course_idx ON course_author_assignments(course_id);
ALTER TABLE learning_unit_versions ADD COLUMN content text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION glitch_immutable_published_version() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM curriculum_release_units WHERE unit_version_id=OLD.id) AND
    (OLD.title,OLD.description,OLD.content,OLD.learning_objective,OLD.required,OLD.unit_id,OLD.publication_state) IS DISTINCT FROM
    (NEW.title,NEW.description,NEW.content,NEW.learning_objective,NEW.required,NEW.unit_id,NEW.publication_state) THEN
   RAISE EXCEPTION 'published unit versions are immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
