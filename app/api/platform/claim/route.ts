import {env} from 'cloudflare:workers';
import {db,json,failure,sameOrigin,readBody,HttpError,hash,first,PLATFORM_OWNER_EMAIL} from '../../../server/core';
import {derive,equal,randomHex,ITERATIONS} from '../../../server/passwords';
// First-time setup for the platform owner account created by migration 0007.
// Requires the PLATFORM_SETUP_TOKEN secret and works only while the owner has no password.
export async function POST(req:Request){try{
 sameOrigin(req);
 const b=await readBody(req);
 if(!env.PLATFORM_SETUP_TOKEN||env.PLATFORM_SETUP_TOKEN.length<24)throw new HttpError(503,'Platform setup is not enabled. Add a PLATFORM_SETUP_TOKEN secret of at least 24 characters.');
 const now=Date.now(),key=await hash('platform-claim');
 await db().prepare('DELETE FROM login_attempts WHERE expires<?').bind(now).run();
 const attempt=await db().prepare('INSERT INTO login_attempts(key,attempts,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+900000).first<{attempts:number}>();
 if((attempt?.attempts||0)>5)throw new HttpError(429,'Too many attempts. Try again in 15 minutes.');
 if(typeof b.token!=='string'||!equal(await hash(b.token),await hash(env.PLATFORM_SETUP_TOKEN)))throw new HttpError(401,'The setup token is not correct.');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new HttpError(400,'Choose a password of 12–128 characters.');
 const owner=await first<{id:string,tenant_id:string}>('SELECT id,tenant_id FROM members WHERE lower(email)=? AND active=1',PLATFORM_OWNER_EMAIL);
 if(!owner)throw new HttpError(404,'The platform owner account does not exist. Apply the database migrations first.');
 if(await first('SELECT member_id FROM passwords WHERE member_id=?',owner.id))throw new HttpError(409,'The platform owner is already set up. Sign in instead.');
 const salt=randomHex();
 await db().batch([
  db().prepare('INSERT INTO passwords(member_id,username,salt,password_hash,iterations,must_change) VALUES(?,?,?,?,?,0)').bind(owner.id,PLATFORM_OWNER_EMAIL,salt,await derive(b.password,salt),ITERATIONS),
  db().prepare('DELETE FROM login_attempts WHERE key=?').bind(key),
  db().prepare('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),'Platform owner password set',owner.id,owner.id,'Administration',new Date().toISOString(),owner.tenant_id),
 ]);
 return json({ok:true});
}catch(e){return failure(e)}}
