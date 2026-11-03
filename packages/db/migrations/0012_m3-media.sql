CREATE TABLE media_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('stream_video','r2_resource','r2_student')),
 state text NOT NULL CHECK (state IN ('pending_upload','processing','ready','failed','revoked')),
 unit_version_id uuid REFERENCES learning_unit_versions(id),
 enrollment_id uuid REFERENCES enrollments(id),
 created_by uuid NOT NULL REFERENCES "user"(id),
 provider_id text UNIQUE,
 object_key text UNIQUE,
 upload_url text,
 mime_type text,
 size_bytes bigint,
 duration_seconds integer,
 max_duration_seconds integer,
 failure_reason text,
 upload_attempt integer NOT NULL DEFAULT 1 CHECK (upload_attempt>0),
 idempotency_key uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT media_scope_valid CHECK ((kind='r2_student' AND enrollment_id IS NOT NULL AND unit_version_id IS NULL) OR (kind IN ('stream_video','r2_resource') AND unit_version_id IS NOT NULL AND enrollment_id IS NULL)),
 CONSTRAINT media_provider_shape CHECK ((kind='stream_video' AND object_key IS NULL) OR (kind<>'stream_video' AND provider_id IS NULL)),
 CONSTRAINT media_ready_shape CHECK (state<>'ready' OR (kind='stream_video' AND provider_id IS NOT NULL AND duration_seconds IS NOT NULL) OR (kind<>'stream_video' AND object_key IS NOT NULL AND mime_type IS NOT NULL AND size_bytes IS NOT NULL)),
 CONSTRAINT media_duration_valid CHECK (duration_seconds IS NULL OR duration_seconds>0),
 CONSTRAINT media_max_duration_valid CHECK (max_duration_seconds IS NULL OR max_duration_seconds BETWEEN 1 AND 36000),
 CONSTRAINT media_stream_duration_limit CHECK ((kind='stream_video' AND max_duration_seconds IS NOT NULL) OR (kind<>'stream_video' AND max_duration_seconds IS NULL)),
 CONSTRAINT media_size_valid CHECK (size_bytes IS NULL OR size_bytes>0),
 CONSTRAINT media_creator_idempotency UNIQUE(created_by,idempotency_key)
);--> statement-breakpoint
CREATE TABLE release_unit_media (
 release_unit_id uuid NOT NULL REFERENCES curriculum_release_units(id),
 asset_id uuid NOT NULL REFERENCES media_assets(id),
 PRIMARY KEY(release_unit_id,asset_id)
);--> statement-breakpoint
CREATE INDEX release_unit_media_asset ON release_unit_media(asset_id);--> statement-breakpoint
CREATE TABLE stream_webhook_events (
 digest text PRIMARY KEY,
 provider_id text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE FUNCTION glitch_guard_release_media() RETURNS trigger AS $$
DECLARE release_status text;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'release media links are immutable'; END IF;
 SELECT r.state INTO release_status FROM curriculum_release_units u JOIN curriculum_releases r ON r.id=u.release_id WHERE u.id=CASE WHEN TG_OP='DELETE' THEN OLD.release_unit_id ELSE NEW.release_unit_id END FOR UPDATE OF r;
 IF release_status <> 'building' THEN RAISE EXCEPTION 'published release media are immutable'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS (
  SELECT 1 FROM curriculum_release_units u JOIN media_assets a ON a.id=NEW.asset_id
  WHERE u.id=NEW.release_unit_id AND a.unit_version_id=u.unit_version_id AND a.state='ready' AND a.kind IN ('stream_video','r2_resource')
 ) THEN RAISE EXCEPTION 'media asset is not ready for this unit version'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER guarded_release_media BEFORE INSERT OR UPDATE OR DELETE ON release_unit_media FOR EACH ROW EXECUTE FUNCTION glitch_guard_release_media();--> statement-breakpoint
CREATE FUNCTION glitch_guard_pinned_media() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM release_unit_media WHERE asset_id=OLD.id) THEN
   IF (OLD.kind,OLD.unit_version_id,OLD.enrollment_id,OLD.provider_id,OLD.object_key,OLD.mime_type,OLD.size_bytes,OLD.duration_seconds) IS DISTINCT FROM
      (NEW.kind,NEW.unit_version_id,NEW.enrollment_id,NEW.provider_id,NEW.object_key,NEW.mime_type,NEW.size_bytes,NEW.duration_seconds)
      OR (OLD.state<>NEW.state AND NOT (OLD.state='ready' AND NEW.state='revoked')) THEN
     RAISE EXCEPTION 'published media identity and state are immutable except revocation';
   END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER guarded_pinned_media BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION glitch_guard_pinned_media();--> statement-breakpoint
CREATE FUNCTION glitch_guard_media_scope() RETURNS trigger AS $$
BEGIN
 IF NEW.kind='r2_student' AND NOT EXISTS(SELECT 1 FROM enrollments e WHERE e.id=NEW.enrollment_id AND e.student_id=NEW.created_by) THEN
   RAISE EXCEPTION 'student media must belong to its enrollment';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER guarded_media_scope BEFORE INSERT OR UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION glitch_guard_media_scope();
--> statement-breakpoint
ALTER TABLE video_watch_sessions ADD COLUMN playback_authorized_until timestamptz;
