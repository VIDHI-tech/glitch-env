import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { ReturnTypeOfDatabase } from './types.js';
import type { Mailer } from './mail.js';
export function createAuth(db:ReturnTypeOfDatabase,origin:string,secret:string,mailer:Mailer){
  return betterAuth({
    database:drizzleAdapter(db,{provider:'pg'}),
    baseURL:origin,
    secret,
    trustedOrigins:[origin],
    emailAndPassword:{enabled:true,requireEmailVerification:true,minPasswordLength:12,revokeSessionsOnPasswordReset:true,sendResetPassword:async({user,url})=>{await mailer.send({to:user.email,subject:'Reset your GLITCH password',text:`Reset your password: ${url}`});}},
    emailVerification:{sendOnSignUp:true,sendOnSignIn:true,sendVerificationEmail:async({user,url})=>{await mailer.send({to:user.email,subject:'Verify your GLITCH email',text:`Verify your email: ${url}`});}},
    advanced:{database:{generateId:'uuid'}}
  });
}
