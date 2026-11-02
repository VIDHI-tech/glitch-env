-- The default role is created inside Better Auth's user INSERT transaction.
-- A failed grant aborts registration; request fields cannot choose a role.
CREATE FUNCTION glitch_assign_student_role() RETURNS trigger AS $$
BEGIN
  INSERT INTO user_role_assignments(user_id, role, granted_by)
  VALUES (NEW.id, 'student', NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER glitch_user_default_role
AFTER INSERT ON "user"
FOR EACH ROW EXECUTE FUNCTION glitch_assign_student_role();
INSERT INTO user_role_assignments(user_id,role,granted_by)
SELECT id,'student',NULL FROM "user" ON CONFLICT DO NOTHING;
