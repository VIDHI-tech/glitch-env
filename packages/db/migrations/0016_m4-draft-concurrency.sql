ALTER TABLE learning_unit_versions ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE TABLE course_draft_prerequisites (
  course_id uuid NOT NULL REFERENCES courses(id),
  unit_id uuid NOT NULL REFERENCES learning_units(id) ON DELETE CASCADE,
  prerequisite_unit_id uuid NOT NULL REFERENCES learning_units(id) ON DELETE CASCADE,
  condition_type text NOT NULL CHECK (condition_type IN ('completed','first_attempt_submitted','review_approved')),
  PRIMARY KEY(course_id, unit_id),
  CHECK(unit_id <> prerequisite_unit_id)
);
