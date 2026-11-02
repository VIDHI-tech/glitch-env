export type MailMessage={to:string;subject:string;text:string};
export interface Mailer { send(message:MailMessage):Promise<void> }
export class CaptureMailer implements Mailer {
  readonly messages:MailMessage[]=[];
  async send(message:MailMessage){this.messages.push(message);}
}
export function productionMailer(env=process.env):Mailer {
  const key=env.RESEND_API_KEY,from=env.EMAIL_FROM;
  if(!key||!from)throw new Error('RESEND_API_KEY and EMAIL_FROM are required for production email');
  return {async send({to,subject,text}){
    const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject,text})});
    if(!response.ok)throw new Error(`Email provider rejected request (${response.status})`);
  }};
}
