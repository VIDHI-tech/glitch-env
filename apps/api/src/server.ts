import { buildApp } from './app.js';
const app=buildApp();
const port=Number(process.env.PORT||3002);
app.listen({port,host:process.env.HOST||'127.0.0.1'}).catch(error=>{app.log.error(error);process.exitCode=1;});
