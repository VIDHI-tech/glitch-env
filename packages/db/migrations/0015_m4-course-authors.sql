CREATE TABLE course_author_assignments (
  user_id uuid NOT NULL REFERENCES "user"(id),
  course_id uuid NOT NULL REFERENCES courses(id),
  assigned_by uuid NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, course_id)
);
CREATE INDEX course_author_assignments_course_idx ON course_author_assignments(course_id);
ALTER TABLE learning_unit_versions ADD COLUMN content text NOT NULL DEFAULT '';
