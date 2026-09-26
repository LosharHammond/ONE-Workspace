import {env} from 'cloudflare:workers';
import type {Member} from './policy';
import type {Item} from '../data';
import {roleRules,type AccessRule} from '../access-policy';

export class HttpError extends Error{constructor(public status:number,message:string){super(message)}}
export function db(){if(!env.DB)throw new HttpError(503,'Workspace database is unavailable. Please try again later.');return env.DB}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function failure(e:unknown){if(e instanceof HttpError)return json({error:e.message},e.status);console.error('One Workspace operation failed',e instanceof Error?`${e.name}: ${e.message}`:'UnknownError');return json({error:'Unable to complete this operation. Please try again.'},503)}
export function configured(){return !!env.DB}
export function origin(req?:Request){if(env.APP_ORIGIN)return new URL(env.APP_ORIGIN).origin;if(req)return new URL(req.url).origin;throw new HttpError(503,'Workspace origin unavailable.')}
export function sameOrigin(req:Request){if(req.headers.get('Origin')!==origin(req))throw new HttpError(403,'This action must start in your workspace.')}
export function cookie(req:Request,name:string){return (req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||''}
export function setCookie(name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`}
export const SESSION_COOKIE='__Host-ows-session';
// Sessions issued before the rename keep working until they expire.
const LEGACY_SESSION_COOKIE='__Host-procus-session';
export function sessionToken(req:Request){return cookie(req,SESSION_COOKIE)||cookie(req,LEGACY_SESSION_COOKIE)}
export function clearSessionCookies(){return [setCookie(SESSION_COOKIE,'',0),setCookie(LEGACY_SESSION_COOKIE,'',0)]}
export async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('')}
export const now=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();

// ── Query helpers ───────────────────────────────────────────────────────────
// D1 rejects undefined binds; normalise them to null.
const clean=(b:unknown[])=>b.map(v=>v===undefined?null:v);
export const stmt=(sql:string,...b:unknown[])=>db().prepare(sql).bind(...clean(b));
export async function all<T=Record<string,unknown>>(sql:string,...b:unknown[]){return (await stmt(sql,...b).all<T>()).results}
export const first=<T=Record<string,unknown>>(sql:string,...b:unknown[])=>stmt(sql,...b).first<T>();
export const run=(sql:string,...b:unknown[])=>stmt(sql,...b).run();
export const batch=(s:D1PreparedStatement[])=>db().batch(s);

// ── Sessions ────────────────────────────────────────────────────────────────
export type Tenant={id:string,slug:string,name:string,legal_name:string,domains:string,status:string,plan:string,brand_color:string,currency:string,timezone:string,settings_json:string};
export async function currentUser(req:Request):Promise<Member|null>{
 if(!configured())return null;
 const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const u=await first<Member>('SELECT m.id,m.name,m.email,m.role,m.department,m.active,m.tenant_id AS tenantId,m.role_id AS roleId,m.manager_id AS managerId,m.title,m.phone,m.location,m.platform_role AS platformRole,m.last_seen_at AS lastSeenAt,p.must_change AS mustChange FROM sessions s JOIN members m ON m.id=s.member_id JOIN passwords p ON p.member_id=m.id JOIN tenants t ON t.id=m.tenant_id WHERE s.token_hash=? AND s.expires>? AND m.active=1 AND t.status=\'active\'',await hash(token),Date.now());
 if(!u)return null;
 // Exactly one platform owner; the stored platform_role column is ignored.
 u.platformRole=isPlatformOwner(u.email)?'owner':null;
 const rules=await all<AccessRule>('SELECT * FROM access_rules WHERE tenant_id=?',u.tenantId);
 if(u.roleId){const role=await first<{id:string,permissions_json:string,locations_json:string}>('SELECT id,permissions_json,locations_json FROM roles WHERE id=? AND tenant_id=?',u.roleId,u.tenantId);if(role){rules.push(...roleRules(role.id,role.permissions_json));try{u.locations=JSON.parse(role.locations_json)}catch{}}}
 const legacy=await first('SELECT member_id FROM research_access WHERE member_id=?',u.id);
 if(legacy)for(const action of ['view','upload','process','download'])if(!rules.some(r=>r.page==='research'&&r.action===action&&r.subject_type==='user'&&r.subject_id===u.id))rules.push({subject_type:'user',subject_id:u.id,department:'*',page:'research',action,effect:'allow',scope:'all'});
 u.rules=rules;
 // Presence is refreshed at most every five minutes.
 if(!u.lastSeenAt||Date.parse(u.lastSeenAt)<Date.now()-300000)await run('UPDATE members SET last_seen_at=? WHERE id=?',now(),u.id).catch(()=>{});
 return u;
}
// The single operator of One Workspace. Only this account can open the platform console
// and create or suspend company workspaces.
export const PLATFORM_OWNER_EMAIL='losharhammond@gmail.com';
export const isPlatformOwner=(email:string)=>email.trim().toLowerCase()===PLATFORM_OWNER_EMAIL;
export async function requireUser(req:Request){const u=await currentUser(req);if(!u)throw new HttpError(401,'Sign in with your workspace account.');if(u.mustChange)throw new HttpError(403,'Change your initial password before accessing workspace data.');return u}
export async function readBody(req:Request,limit=64000){const s=await req.text();if(s.length>limit)throw new HttpError(413,'Request is too large.');try{return JSON.parse(s) as Record<string,unknown>}catch{throw new HttpError(400,'Invalid request data.')}}

// Wraps a handler with session, same-origin checks for writes and error mapping.
export function route(fn:(req:Request,u:Member)=>Promise<unknown>){return async(req:Request)=>{try{if(!['GET','HEAD'].includes(req.method))sameOrigin(req);const u=await requireUser(req);const out=await fn(req,u);return out instanceof Response?out:json(out??{ok:true})}catch(e){return failure(e)}}}

// ── Validation ──────────────────────────────────────────────────────────────
export function str(v:unknown,label:string,max=200,required=true):string{if(v===undefined||v===null)v='';if(typeof v!=='string')throw new HttpError(400,`${label} must be text.`);const s=v.trim();if(required&&!s)throw new HttpError(400,`${label} is required.`);if(s.length>max)throw new HttpError(400,`${label} must be ${max} characters or fewer.`);return s}
export function num(v:unknown,label:string,min=0,max=1e12):number{const n=typeof v==='string'&&v.trim()?Number(v):v;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new HttpError(400,`${label} must be a number between ${min} and ${max}.`);return n}
export function oneOf<T extends string>(v:unknown,list:readonly T[],label:string):T{if(!list.includes(v as T))throw new HttpError(400,`Choose a valid ${label}.`);return v as T}
export function date(v:unknown,label:string,required=false):string|null{if(v===undefined||v===null||v===''){if(required)throw new HttpError(400,`${label} is required.`);return null}if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(v)||!Number.isFinite(Date.parse(v)))throw new HttpError(400,`${label} must be a valid date.`);return v.slice(0,10)}
export function idOf(v:unknown,label='Record'):string{if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{1,80}$/.test(v))throw new HttpError(400,`Select a valid ${label.toLowerCase()}.`);return v}

// ── Tenant helpers ──────────────────────────────────────────────────────────
export async function tenantOf(u:{tenantId:string}){const t=await first<Tenant>('SELECT * FROM tenants WHERE id=?',u.tenantId);if(!t)throw new HttpError(404,'Workspace not found.');return t}
export function tenantSettings(t:Tenant){try{return JSON.parse(t.settings_json||'{}') as Record<string,unknown>}catch{return {}}}
// Sequential, gap-tolerant document numbers such as PR-2026-0007.
export async function nextNumber(tenantId:string,prefix:string,yearly=true){const key=yearly?`${prefix}-${new Date().getUTCFullYear()}`:prefix;const r=await first<{value:number}>('INSERT INTO counters(tenant_id,key,value) VALUES(?,?,1) ON CONFLICT(tenant_id,key) DO UPDATE SET value=value+1 RETURNING value',tenantId,key);return `${key}-${String(r?.value||1).padStart(yearly?4:5,'0')}`}

export const projection='id,module,title,department,status,owner,amount,details,updated,version,created_by AS createdBy,file_key AS fileKey';
export async function getRecord(u:{tenantId:string},id:string){return first<Item>(`SELECT ${projection} FROM records WHERE id=? AND tenant_id=?`,id,u.tenantId)}
export function auditStatement(u:{id:string,tenantId:string},action:string,id:string,department:string,before:unknown,after:unknown){return stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,?,?,?,?)',uid(),action,u.id,id,department||'',before?JSON.stringify(before):null,after?JSON.stringify(after):null,now(),u.tenantId)}
