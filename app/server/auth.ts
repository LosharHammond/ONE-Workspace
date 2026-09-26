import {first,all,stmt,batch,hash,uid,now,origin,HttpError,setCookie,SESSION_COOKIE,clientIp,isPlatformOwner,OWNER_HOME_TENANT} from './core';
import {randomHex} from './passwords';
import {sendEmail,emailReady,escapeHtml as esc} from './notify';

const SESSION_MS=8*3600*1000;
export const TOKEN_TTL:Record<string,number>={invite:7*86400*1000,reset:2*3600*1000};

// Server-side rate limit keyed by action + a subject (login, IP…). Only hashes are stored.
export async function rateLimit(action:string,subject:string,max=5,windowMs=900000){
 const key=await hash(`${action}:${subject}`),t=Date.now();
 await stmt('DELETE FROM login_attempts WHERE expires<?',t).run();
 const r=await first<{attempts:number}>('INSERT INTO login_attempts(key,attempts,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts',key,t+windowMs);
 if((r?.attempts||0)>max)throw new HttpError(429,'Too many attempts. Try again in 15 minutes.');
 return key;
}

// The workspace a person lands in: their last one if still valid, otherwise the first active membership.
// The Platform Owner can always land in their own HQ workspace.
export async function pickMembership(identityId:string,email:string,preferred?:string|null){
 const rows=await all<{id:string,tenant_id:string}>("SELECT m.id,m.tenant_id FROM members m JOIN tenants t ON t.id=m.tenant_id WHERE m.identity_id=? AND m.active=1 AND t.status='active' ORDER BY m.created_at",identityId);
 const pick=rows.find(r=>r.id===preferred)||rows.find(r=>isPlatformOwner(email)&&r.tenant_id===OWNER_HOME_TENANT)||rows[0];
 if(pick)return pick;
 if(isPlatformOwner(email)){const any=await first<{id:string,tenant_id:string}>('SELECT id,tenant_id FROM members WHERE identity_id=? AND active=1 ORDER BY tenant_id=? DESC',identityId,OWNER_HOME_TENANT);if(any)return any}
 return null;
}

export async function createSession(identityId:string,memberId:string){
 const token=randomHex();
 await batch([stmt('DELETE FROM sessions WHERE expires<?',Date.now()),stmt('INSERT INTO sessions(token_hash,member_id,expires,identity_id) VALUES(?,?,?,?)',await hash(token),memberId,Date.now()+SESSION_MS,identityId),stmt('UPDATE identities SET last_member_id=? WHERE id=?',memberId,identityId)]);
 return setCookie(SESSION_COOKIE,token,SESSION_MS/1000);
}

// Builds a one-time activation or reset token. Only its SHA-256 hash is written; the raw token
// exists only in the link returned by deliverToken. Returning the statement lets callers commit
// the token in the same transaction as the account it belongs to.
export async function prepareToken(o:{identityId:string,memberId?:string|null,tenantId?:string|null,purpose:'invite'|'reset',createdBy?:string|null}){
 const token=randomHex(),expires=Date.now()+TOKEN_TTL[o.purpose];
 return {token,expires,statements:[
  // A new link replaces any unused link of the same kind.
  stmt("UPDATE auth_tokens SET used_at=? WHERE identity_id=? AND purpose=? AND used_at IS NULL",now(),o.identityId,o.purpose),
  stmt('INSERT INTO auth_tokens(token_hash,identity_id,member_id,tenant_id,purpose,created_by,created_at,expires) VALUES(?,?,?,?,?,?,?,?)',await hash(token),o.identityId,o.memberId||null,o.tenantId||null,o.purpose,o.createdBy||null,now(),expires),
 ]};
}
// Emails the link when email is configured; otherwise returns it once to the person who created it.
export async function deliverToken(p:{token:string,expires:number},o:{purpose:'invite'|'reset',req?:Request,workspaceName?:string,recipient:{email:string,name:string},inviterName?:string}){
 let base='';try{base=origin(o.req)}catch{}
 const link=`${base}/#/activate/${p.token}`;
 let emailed=false,emailError='';
 if(emailReady()&&/\S+@\S+\.\S+/.test(o.recipient.email)&&!o.recipient.email.endsWith('.invalid')){
  try{await sendEmail(o.recipient.email,o.purpose==='invite'?`You're invited to ${o.workspaceName||'One Workspace'}`:'Reset your One Workspace password',tokenEmail(o.purpose,o.recipient.name,link,o.workspaceName,o.inviterName));emailed=true}
  catch(e){emailError=e instanceof Error?e.message:'Email failed.'}
 }
 return {emailed,emailError,link:emailed?undefined:link,expiresAt:new Date(p.expires).toISOString()};
}
export async function issueToken(o:{identityId:string,memberId?:string|null,tenantId?:string|null,purpose:'invite'|'reset',createdBy?:string|null,req?:Request,workspaceName?:string,recipient:{email:string,name:string},inviterName?:string}){
 const p=await prepareToken(o);await batch(p.statements);return deliverToken(p,o);
}
// Finds or prepares a global identity for an email. New identities are created in the caller's batch.
export async function identityFor(email:string,name:string){
 const e=email.trim().toLowerCase();
 const ex=await first<{id:string,name:string,activated:number}>('SELECT i.id,i.name,(SELECT count(*) FROM credentials c WHERE c.identity_id=i.id) AS activated FROM identities i WHERE i.email=?',e);
 if(ex)return {id:ex.id,email:e,existing:true,activated:!!ex.activated,statements:[] as D1PreparedStatement[]};
 const id=uid();
 return {id,email:e,existing:false,activated:false,statements:[stmt('INSERT INTO identities(id,email,name,created_at) VALUES(?,?,?,?)',id,e,name,now())]};
}
function tokenEmail(purpose:string,name:string,link:string,workspace?:string,inviter?:string){
 const first=esc(name.split(' ')[0]||name);
 const body=purpose==='invite'?`${inviter?esc(inviter)+' has invited you':'You have been invited'} to <b>${esc(workspace||'One Workspace')}</b>. Choose a password to activate your account. This link expires in 7 days.`:'We received a request to reset your password. This link expires in 2 hours. If you did not ask for it, ignore this email.';
 return `<div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f4f1;padding:32px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e6e6e0"><div style="font-weight:700;color:#6D5EF8">● One Workspace</div><p>Hi ${first},</p><p style="color:#333;line-height:1.55">${body}</p><p style="margin-top:22px"><a href="${esc(link)}" style="background:#14151a;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600">${purpose==='invite'?'Activate account':'Reset password'}</a></p><p style="color:#999;font-size:12px;margin-top:24px">The link works once. One Workspace never asks for your password by email.</p></div></div>`;
}

export async function findToken(token:string){
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 return first<{token_hash:string,identity_id:string,member_id:string|null,tenant_id:string|null,purpose:string,expires:number,used_at:string|null}>('SELECT * FROM auth_tokens WHERE token_hash=?',await hash(token));
}
export {clientIp};
