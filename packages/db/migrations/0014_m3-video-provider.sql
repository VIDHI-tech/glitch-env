ALTER TABLE media_assets ADD COLUMN video_provider text;
UPDATE media_assets SET video_provider=CASE WHEN provider_id LIKE 'hls:%' THEN 'r2-hls' ELSE 'cloudflare-stream' END WHERE kind='stream_video';
ALTER TABLE media_assets ADD CONSTRAINT media_video_provider_valid CHECK ((kind='stream_video' AND video_provider IN ('cloudflare-stream','r2-hls')) OR (kind<>'stream_video' AND video_provider IS NULL));
CREATE OR REPLACE FUNCTION glitch_guard_pinned_media() RETURNS trigger AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM release_unit_media WHERE asset_id=OLD.id) THEN
   IF (OLD.kind,OLD.unit_version_id,OLD.enrollment_id,OLD.provider_id,OLD.video_provider,OLD.object_key,OLD.mime_type,OLD.size_bytes,OLD.duration_seconds) IS DISTINCT FROM
      (NEW.kind,NEW.unit_version_id,NEW.enrollment_id,NEW.provider_id,NEW.video_provider,NEW.object_key,NEW.mime_type,NEW.size_bytes,NEW.duration_seconds)
      OR (OLD.state<>NEW.state AND NOT (OLD.state='ready' AND NEW.state='revoked')) THEN
     RAISE EXCEPTION 'published media identity and state are immutable except revocation';
   END IF;
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
