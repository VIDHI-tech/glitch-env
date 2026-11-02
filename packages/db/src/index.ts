import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';
import * as authSchema from './auth-schema.js';
export * from './schema.js';
export function createDatabase(connectionString: string) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({connectionString, max:10, idleTimeoutMillis:30000, connectionTimeoutMillis:5000});
  return {pool, db:drizzle(pool,{schema:{...schema,...authSchema}})};
}
export async function migrateDatabase(database: ReturnType<typeof createDatabase>, migrationsFolder: string) {
  await migrate(database.db, { migrationsFolder });
}
