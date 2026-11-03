# Source only for the disposable M4 QA workspace.
export DATABASE_URL=postgresql://glitch:local_dev_only@127.0.0.1:55433/glitch_m4_qa
export BETTER_AUTH_SECRET=local_dev_only_secret_at_least_32_characters
export APP_ORIGIN=http://127.0.0.1:5173
export HOST=127.0.0.1
export PORT=3002
export MAIL_CAPTURE=1
export VIDEO_PROVIDER=r2-hls
export CLOUDFLARE_R2_BUCKET=glitch-private
export CLOUDFLARE_R2_ACCESS_KEY_ID=glitch_dev
export CLOUDFLARE_R2_SECRET_ACCESS_KEY=local_dev_only_change_me
export R2_ENDPOINT=http://127.0.0.1:9000
export R2_PUBLIC_ENDPOINT=http://127.0.0.1:5173
export M4_QA_SEED=1
