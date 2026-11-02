import {createDatabase} from '@glitch/db';
import {bootstrapFirstSuperAdmin} from '../src/bootstrap.js';
const url=process.env.DATABASE_URL,email=process.env.ADMIN_BOOTSTRAP_EMAIL;
if(!url||!email)throw new Error('DATABASE_URL and ADMIN_BOOTSTRAP_EMAIL are required');
const {pool}=createDatabase(url);
try{await bootstrapFirstSuperAdmin(pool,email);process.stdout.write('First super administrator role granted.\n');}
finally{await pool.end();}
