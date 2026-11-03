ALTER TABLE media_assets ADD COLUMN upload_expires_at timestamptz;
--> statement-breakpoint
UPDATE media_assets SET upload_expires_at=created_at+interval '15 minutes' WHERE kind='stream_video' AND state='pending_upload' AND upload_url IS NOT NULL;
