import {json,failure,sameOrigin,readBody,HttpError,first,stmt,batch,uid,now} from '../../../server/core';
import {derive,randomHex,ITERATIONS} from '../../../server/passwords';
import {findToken,rateLimit,clientIp} from '../../../server/auth';
// Completes an invitation or password reset. {check:true} only describes the link.
export async function POST(req:Request){try{
 sameOrigin(req);
 await rateLimit('activate',clientIp(req)||'unknown',20);
 const b=await readBody(req);
 const t=typeof b.token==='string'?await findToken(b.token):null;
 // One generic message for unknown, used and expired links.
 if(!t||t.used_at||t.expires<Date.now())throw new HttpError(400,'This link is invalid or has expired. Ask your administrator for a new one.');
 const who=await first<{name:string,email:string}>('SELECT name,email FROM identities WHERE id=?',t.identity_id);
 const ws=t.tenant_id?await first<{name:string,status:string}>('SELECT name,status FROM tenants WHERE id=?',t.tenant_id):null;
 if(b.check)return json({purpose:t.purpose,name:who?.name,email:who?.email,workspace:ws?.name||null});
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new HttpError(400,'Choose a password of 12–128 characters.');
 const salt=randomHex(),hashValue=await derive(b.password,salt);
 const res=await batch([
  stmt('UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL',now(),t.token_hash),
  stmt('INSERT INTO credentials(identity_id,salt,password_hash,iterations,must_change,updated_at) SELECT ?,?,?,?,0,? WHERE changes()=1 ON CONFLICT(identity_id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash,iterations=excluded.iterations,must_change=0,updated_at=excluded.updated_at',t.identity_id,salt,hashValue,ITERATIONS,now()),
  // Existing sessions end when a password is reset.
  stmt('DELETE FROM sessions WHERE identity_id=?',t.identity_id),
  stmt('UPDATE members SET invited_at=NULL WHERE identity_id=?',t.identity_id),
  stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',uid(),t.purpose==='invite'?'Account activated':'Password reset completed',t.member_id||t.identity_id,t.identity_id,'',now(),t.tenant_id||'one-workspace'),
 ]);
 if(!res[0].meta.changes)throw new HttpError(400,'This link is invalid or has expired. Ask your administrator for a new one.');
 return json({ok:true,email:who?.email});
}catch(e){return failure(e)}}
