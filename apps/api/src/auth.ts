import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { ReturnTypeOfDatabase } from './types.js';
export function createAuth(db:ReturnTypeOfDatabase,origin:string,secret:string){
  return betterAuth({
    database:drizzleAdapter(db,{provider:'pg'}),
    baseURL:origin,
    secret,
    trustedOrigins:[origin],
    emailAndPassword:{enabled:true,requireEmailVerification:true},
    advanced:{database:{generateId:'uuid'}}
  });
}
