import type {Pool} from 'pg';
/** One-time local operator action. Never exposed as a public HTTP route. */
export async function bootstrapFirstSuperAdmin(pool:Pool,email:string){
 const client=await pool.connect();try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(614381)');
  const existing=await client.query("SELECT 1 FROM user_role_assignments WHERE role='super_admin' LIMIT 1");
  if(existing.rowCount){await client.query('ROLLBACK');throw new Error('A super administrator already exists');}
  const user=await client.query('SELECT id FROM "user" WHERE email=$1 AND email_verified=true',[email.toLowerCase()]);
  if(user.rowCount!==1){await client.query('ROLLBACK');throw new Error('Verified account not found');}
  const id=user.rows[0].id;
  await client.query("INSERT INTO user_role_assignments(user_id,role,granted_by) VALUES($1,'super_admin',NULL)",[id]);
  await client.query('INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES($1,$2,$3,$4)',[id,'bootstrap_super_admin',id,email.toLowerCase()]);
  await client.query('COMMIT');return id as string;
 }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
}
