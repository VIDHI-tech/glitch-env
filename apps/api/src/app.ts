import Fastify from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { createDatabase } from '@glitch/db';
import { healthSchema } from '@glitch/shared';
import { createAuth } from './auth.js';
import { developmentMailer, productionMailer, type Mailer } from './mail.js';
import { registerWorkspaceRoutes } from './workspace.js';
import { registerLearningRoutes } from './learning.js';
import {registerMediaRoutes} from './media.js';
import {registerAdminBuilderRoutes} from './admin-builder.js';
import type {MediaProvider} from './media-provider.js';
import {configuredMediaServices,singleMediaServices,type MediaServices} from './media-services.js';
export function buildApp(options:{databaseUrl?:string;secret?:string;origin?:string;mailer?:Mailer;clock?:()=>number;mediaProvider?:MediaProvider;mediaServices?:MediaServices;webhookSecret?:string}={}) {
  const app = Fastify({logger:{redact:['req.url','req.headers.authorization','req.headers.cookie','req.body.password','res.headers.set-cookie']}});
  const databaseUrl=options.databaseUrl||process.env.DATABASE_URL;
  const origin=options.origin||process.env.APP_ORIGIN;
  const secret=options.secret||process.env.BETTER_AUTH_SECRET;
  const database=databaseUrl?createDatabase(databaseUrl):null;
  // Auth routes remain unavailable until a database, migration and secret exist.
  const devCapture=!options.mailer&&database&&origin&&secret&&process.env.MAIL_CAPTURE==='1'?developmentMailer():null;
  const auth=database&&origin&&secret?createAuth(database.db,origin,secret,options.mailer??devCapture??productionMailer()):null;
  if(devCapture)app.get('/__dev/mail',async(request,reply)=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.ip)?devCapture.messages:reply.code(403).send({code:'FORBIDDEN',message:'Local access only'}));
  app.addHook('onRequest',async(request,reply)=>{
    if(request.url.startsWith('/api/v1/')&&!['GET','HEAD','OPTIONS'].includes(request.method)){
      if(!origin||request.headers.origin!==origin||request.headers['sec-fetch-site']==='cross-site')
        return reply.code(403).send({code:'BAD_ORIGIN',message:'Request origin is not allowed'});
    }
  });
  app.get('/health/live', async () => healthSchema.parse({status:'ok',service:'glitch-api'}));
  app.get('/health/ready', async (_request,reply) => {
    if(!database||!auth)return reply.code(503).send({code:'NOT_CONFIGURED',message:'PostgreSQL and authentication are not configured'});
    try {await database.pool.query('SELECT 1 FROM "user" LIMIT 0');await database.pool.query('SELECT 1 FROM courses LIMIT 0');return {status:'ok'};}
    catch {return reply.code(503).send({code:'DATABASE_UNAVAILABLE',message:'PostgreSQL is unavailable'});}
  });
  app.get('/api/v1/health', async () => healthSchema.parse({status:'ok',service:'glitch-api'}));
  app.route({method:['GET','POST'],url:'/api/auth/*',async handler(request,reply){
    if(!auth)return reply.code(503).send({code:'AUTH_NOT_CONFIGURED',message:'Authentication is unavailable'});
    const url=new URL(request.url,origin);
    const response=await auth.handler(new Request(url,{method:request.method,headers:fromNodeHeaders(request.headers),...(request.body?{body:JSON.stringify(request.body)}:{})}));
    reply.code(response.status);response.headers.forEach((value,key)=>reply.header(key,value));
    return reply.send(response.body?await response.text():null);
  }});
  app.get('/api/v1/me',async(request,reply)=>{
    if(!auth)return reply.code(503).send({code:'AUTH_NOT_CONFIGURED',message:'Authentication is unavailable'});
    const session=await auth.api.getSession({headers:fromNodeHeaders(request.headers)});
    if(!session)return reply.code(401).send({code:'UNAUTHENTICATED',message:'Sign in to continue'});
    return {id:session.user.id,name:session.user.name,email:session.user.email};
  });
  if(database&&auth){const mediaServices=options.mediaServices??(options.mediaProvider?singleMediaServices(options.mediaProvider):configuredMediaServices());registerWorkspaceRoutes(app,database,auth);registerAdminBuilderRoutes(app,database,auth);registerLearningRoutes(app,database,auth,options.clock,mediaServices);registerMediaRoutes(app,database,auth,mediaServices,options.webhookSecret??process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET,options.clock);}
  app.addHook('onClose',async()=>{await database?.pool.end();});
  return app;
}
