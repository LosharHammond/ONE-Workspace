import {env} from 'cloudflare:workers';
import {json,failure,sameOrigin,readBody,HttpError,hash,first,stmt,batch,uid,now,PLATFORM_OWNER_EMAIL,OWNER_HOME_TENANT} from '../../../server/core';
import {derive,equal,randomHex,ITERATIONS} from '../../../server/passwords';
import {rateLimit,clientIp} from '../../../server/auth';
// First-time setup for the Platform Owner (created by migration 0007).
// PLATFORM_SETUP_TOKEN is read only from server secrets; it is never stored, logged or returned.
// Runs only while the owner has no password. Errors are generic on purpose.
export async function POST(req:Request){try{
 sameOrigin(req);
 await rateLimit('platform-claim',clientIp(req)||'unknown',5);
 const b=await readBody(req);
 const secret=env.PLATFORM_SETUP_TOKEN;
 if(!secret||secret.length<24||typeof b.token!=='string'||!equal(await hash(b.token),await hash(secret)))throw new HttpError(401,'Platform setup is not available.');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new HttpError(400,'Choose a password of 12–128 characters.');
 const owner=await first<{id:string}>('SELECT id FROM identities WHERE email=?',PLATFORM_OWNER_EMAIL);
 const member=owner?await first<{id:string,tenant_id:string}>('SELECT id,tenant_id FROM members WHERE identity_id=? AND active=1 ORDER BY tenant_id=? DESC',owner.id,OWNER_HOME_TENANT):null;
 if(!owner||!member)throw new HttpError(401,'Platform setup is not available.');
 if(await first('SELECT identity_id FROM credentials WHERE identity_id=?',owner.id))throw new HttpError(409,'The Platform Owner is already set up. Sign in instead.');
 const salt=randomHex();
 await batch([
  stmt('INSERT INTO credentials(identity_id,salt,password_hash,iterations,must_change,updated_at) VALUES(?,?,?,?,0,?)',owner.id,salt,await derive(b.password,salt),ITERATIONS,now()),
  stmt('INSERT INTO platform_audit(id,actor_identity_id,tenant_id,action,method,path,ip,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),owner.id,member.tenant_id,'platform.owner-setup','POST','/api/platform/claim',clientIp(req),now()),
 ]);
 return json({ok:true});
}catch(e){return failure(e)}}
