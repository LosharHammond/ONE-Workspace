import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf} from '../../server/core';
import {derive,randomHex,ITERATIONS} from '../../server/passwords';
import {seedTenant} from '../../server/tenancy';
import type {Member} from '../../server/policy';
// Platform console: the operator of One Workspace provisions and suspends company workspaces.
// It shows only workspace metadata and counts, never another company's records.
const owner=(u:Member)=>{if(u.platformRole!=='owner')throw new HttpError(403,'The platform console is restricted to workspace operators.')};
export const GET=route(async(_req,u)=>{owner(u);return {tenants:await all("SELECT t.id,t.slug,t.name,t.legal_name AS legalName,t.domains,t.status,t.plan,t.brand_color AS brandColor,t.currency,t.created_at AS createdAt,(SELECT count(*) FROM members m WHERE m.tenant_id=t.id AND m.active=1) AS members,(SELECT count(*) FROM assets a WHERE a.tenant_id=t.id) AS assets,(SELECT count(*) FROM tickets k WHERE k.tenant_id=t.id) AS tickets,(SELECT count(*) FROM purchase_docs d WHERE d.tenant_id=t.id) AS purchasing,(SELECT max(m.last_seen_at) FROM members m WHERE m.tenant_id=t.id) AS lastActive FROM tenants t ORDER BY t.created_at")}});
export const POST=route(async(req,u)=>{
 owner(u);const b=await readBody(req);
 if(b.action==='status'){const id=idOf(b.id,'Workspace');if(id===u.tenantId)throw new HttpError(400,'You cannot suspend your own workspace.');const status=oneOf(b.status,['active','suspended'] as const,'status');await batch([stmt('UPDATE tenants SET status=? WHERE id=?',status,id),...(status==='suspended'?[stmt('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE tenant_id=?)',id)]:[])]);return {ok:true}}
 if(b.action==='plan'){await stmt('UPDATE tenants SET plan=? WHERE id=?',oneOf(b.plan,['starter','business','enterprise'] as const,'plan'),idOf(b.id,'Workspace')).run();return {ok:true}}
 if(b.action!=='create')throw new HttpError(400,'Unknown action.');
 const name=str(b.name,'Company name',120),slug=str(b.slug,'Workspace address',40).toLowerCase();
 if(!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug))throw new HttpError(400,'Use 3–40 lowercase letters, numbers and dashes for the workspace address.');
 const domains=str(b.domains,'Email domains',300,false).toLowerCase().split(',').map(s=>s.trim().replace(/^@/,'')).filter(Boolean);
 if(domains.some(d=>!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))throw new HttpError(400,'Enter email domains like company.com, separated by commas.');
 const adminName=str(b.adminName,'Administrator name',100),adminEmail=str(b.adminEmail,'Administrator email',160).toLowerCase(),password=str(b.password,'Temporary password',128);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))throw new HttpError(400,'Enter a valid administrator email.');
 if(domains.length&&!domains.some(d=>adminEmail.endsWith('@'+d)))throw new HttpError(400,'The administrator email must use one of the company domains.');
 if(password.length<12)throw new HttpError(400,'Temporary passwords need at least 12 characters.');
 if(await first('SELECT id FROM tenants WHERE slug=?',slug))throw new HttpError(409,'This workspace address is taken.');
 if(await first('SELECT member_id FROM passwords WHERE username=?',adminEmail)||await first('SELECT id FROM members WHERE lower(email)=?',adminEmail))throw new HttpError(409,'This administrator email already has an account.');
 const color=/^#[0-9a-fA-F]{6}$/.test(String(b.brandColor))?String(b.brandColor):'#6D5EF8';
 const tenantId=uid(),adminId=uid(),salt=randomHex(),t=now();
 await batch([
  stmt('INSERT INTO tenants(id,slug,name,legal_name,domains,status,plan,brand_color,currency,timezone,settings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',tenantId,slug,name,str(b.legalName,'Legal name',160,false)||name,domains.join(','),'active',oneOf(b.plan||'business',['starter','business','enterprise'] as const,'plan'),color,str(b.currency||'GHS','Currency',8),str(b.timezone||'Africa/Accra','Time zone',60),JSON.stringify({prPrefix:'PR',poPrefix:'PO',ticketPrefix:'TKT',assetPrefix:'AST'}),t),
  stmt('INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,title) VALUES(?,?,?,?,?,1,?,?,?)',adminId,adminName,adminEmail,'admin','Administration',t,tenantId,'Workspace administrator'),
  stmt('INSERT INTO passwords(member_id,username,salt,password_hash,iterations,must_change) VALUES(?,?,?,?,?,1)',adminId,adminEmail,salt,await derive(password,salt),ITERATIONS),
  ...seedTenant(tenantId,adminId,name),
  stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',uid(),'Workspace created by platform operator',u.id,tenantId,'Administration',t,tenantId),
 ]);
 return {id:tenantId,slug};
});
