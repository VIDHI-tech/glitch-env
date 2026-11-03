import {resolve} from 'node:path';
import {createDatabase,migrateDatabase} from '@glitch/db';
const database=createDatabase(process.env.DATABASE_URL??'');
try{await migrateDatabase(database,resolve(import.meta.dirname,'../../../packages/db/migrations'));}finally{await database.pool.end();}
