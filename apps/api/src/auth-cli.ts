import { createDatabase } from '@glitch/db';
import { createAuth } from './auth.js';
import { CaptureMailer } from './mail.js';
if(!process.env.DATABASE_URL||!process.env.APP_ORIGIN||!process.env.BETTER_AUTH_SECRET) throw new Error('DATABASE_URL, APP_ORIGIN and BETTER_AUTH_SECRET required');
export const auth=createAuth(createDatabase(process.env.DATABASE_URL).db,process.env.APP_ORIGIN,process.env.BETTER_AUTH_SECRET,new CaptureMailer());
