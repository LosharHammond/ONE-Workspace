import {json,failure,sameOrigin,readBody,HttpError,first,stmt,batch,uid,now} from '../../../server/core';
import {derive,equal,ITERATIONS} from '../../../server/passwords';
import {rateLimit,pickMembership,createSession,clientIp} from '../../../server/auth';
export async function POST(req:Request){try{
 sameOrigin(req);const b=await readBody(req);
 if(typeof b.login!=='string'||typeof b.password!=='string'||b.password.length>256||b.login.length>200)throw new HttpError(400,'Enter your email or username and password.');
 const login=b.login.trim().toLowerCase();
 const key=await rateLimit('login',login);await rateLimit('login-ip',clientIp(req)||'unknown',30);
 const id=await first<{id:string,email:string,salt:string|null,password_hash:string|null,iterations:number|null,must_change:number|null,last_member_id:string|null}>('SELECT i.id,i.email,i.last_member_id,c.salt,c.password_hash,c.iterations,c.must_change FROM identities i LEFT JOIN credentials c ON c.identity_id=i.id WHERE i.email=? OR lower(i.username)=? LIMIT 1',login,login);
 // Always derive, even for unknown or not-yet-activated accounts, so timing does not reveal which logins exist.
 const candidate=await derive(b.password,id?.salt||'00'.repeat(32),id?.iterations||ITERATIONS);
 if(!id||!id.password_hash||!equal(candidate,id.password_hash))throw new HttpError(401,'Incorrect credentials or inactive account.');
 const m=await pickMembership(id.id,id.email,id.last_member_id);
 if(!m)throw new HttpError(403,'Your account has no active workspace. Contact your company administrator.');
 const cookie=await createSession(id.id,m.id);
 await batch([stmt('DELETE FROM login_attempts WHERE key=?',key),stmt('UPDATE members SET last_seen_at=? WHERE id=?',now(),m.id),stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',uid(),'Signed in',m.id,m.id,'',now(),m.tenant_id)]);
 const res=json({ok:true,mustChange:!!id.must_change});res.headers.set('Set-Cookie',cookie);return res;
}catch(e){return failure(e)}}
