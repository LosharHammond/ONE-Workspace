import {currentUser,sameOrigin,readBody,HttpError,json,failure,first,stmt,batch,uid,now} from '../../../server/core';
import {derive,equal,randomHex,ITERATIONS} from '../../../server/passwords';
import {createSession,rateLimit} from '../../../server/auth';
// Change your own password (also used to replace a legacy temporary password).
export async function POST(req:Request){try{
 sameOrigin(req);const u=await currentUser(req);if(!u)throw new HttpError(401,'Sign in first.');
 await rateLimit('password-change',u.identityId,10);
 const b=await readBody(req);
 if(typeof b.current!=='string'||b.current.length>256||typeof b.password!=='string'||b.password.length<12||b.password.length>128||b.current===b.password)throw new HttpError(400,'Choose a different password of 12–128 characters.');
 const c=await first<{salt:string,password_hash:string,iterations:number}>('SELECT salt,password_hash,iterations FROM credentials WHERE identity_id=?',u.identityId);
 if(!c||!equal(await derive(b.current,c.salt,c.iterations),c.password_hash))throw new HttpError(401,'Current password is incorrect.');
 const salt=randomHex();
 await batch([stmt('UPDATE credentials SET salt=?,password_hash=?,iterations=?,must_change=0,updated_at=? WHERE identity_id=?',salt,await derive(b.password,salt),ITERATIONS,now(),u.identityId),stmt('DELETE FROM sessions WHERE identity_id=?',u.identityId),stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',uid(),'Password changed',u.id,u.id,u.department,now(),u.homeTenantId||u.tenantId)]);
 const res=json({ok:true});res.headers.set('Set-Cookie',await createSession(u.identityId,u.id));return res;
}catch(e){return failure(e)}}
