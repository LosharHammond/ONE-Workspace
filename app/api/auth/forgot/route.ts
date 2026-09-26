import {json,failure,sameOrigin,readBody,first} from '../../../server/core';
import {issueToken,rateLimit,clientIp} from '../../../server/auth';
import {emailReady} from '../../../server/notify';
// Self-service reset. Always answers the same way so it cannot be used to discover accounts.
export async function POST(req:Request){try{
 sameOrigin(req);
 await rateLimit('forgot',clientIp(req)||'unknown',10);
 const b=await readBody(req);
 const email=typeof b.email==='string'?b.email.trim().toLowerCase().slice(0,200):'';
 if(email&&emailReady()){
  await rateLimit('forgot-email',email,3,3600000);
  const i=await first<{id:string,name:string,email:string}>('SELECT i.id,i.name,i.email FROM identities i JOIN credentials c ON c.identity_id=i.id WHERE i.email=?',email);
  if(i)await issueToken({identityId:i.id,purpose:'reset',req,recipient:i});
 }
 return json({ok:true,message:emailReady()?'If that email has an account, a reset link is on its way.':'Email is not configured for this installation. Ask your administrator to send you a reset link.'});
}catch(e){return failure(e)}}
