import {env} from 'cloudflare:workers';
import type {Member} from './policy';
import type {Item} from '../data';
import {roleRules,type AccessRule} from '../access-policy';
import {disabledPages,modules as moduleCatalog} from '../modules';

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
// The single operator of One Workspace. Only this identity can open the Platform Console,
// create or suspend workspaces, or start a support session inside another workspace.
// No workspace role, including Company Admin, can grant this.
export const PLATFORM_OWNER_EMAIL='losharhammond@gmail.com';
export const isPlatformOwner=(email:string)=>email.trim().toLowerCase()===PLATFORM_OWNER_EMAIL;
export const OWNER_HOME_TENANT='one-workspace';
export function clientIp(req:Request){return (req.headers.get('CF-Connecting-IP')||req.headers.get('X-Forwarded-For')||'').split(',')[0].trim().slice(0,64)}

type SessionRow={member_id:string,identity_id:string|null,support_session_id:string|null};
type MemberRow=Member&{mustChange?:number};
const memberColumns='m.id,m.name,m.email,m.role,m.department,m.active,m.tenant_id AS tenantId,m.identity_id AS identityId,m.role_id AS roleId,m.manager_id AS managerId,m.title,m.phone,m.location,m.last_seen_at AS lastSeenAt';

// Loads everything access decisions need for a member acting in a workspace.
async function withAccess(u:Member){
 const t=await first<Tenant>('SELECT * FROM tenants WHERE id=?',u.tenantId);
 u.disabledPages=disabledPages(t?tenantSettings(t).modules:undefined);
 const rules=await all<AccessRule>('SELECT * FROM access_rules WHERE tenant_id=?',u.tenantId);
 if(u.roleId&&u.role!=='admin'){
  const role=await first<{id:string,permissions_json:string,locations_json:string,scope_json:string,vendor_access:number,assigned_only:number}>('SELECT id,permissions_json,locations_json,scope_json,vendor_access,assigned_only FROM roles WHERE id=? AND tenant_id=?',u.roleId,u.tenantId);
  if(role){
   rules.push(...roleRules(role.id,role.permissions_json));
   const scope=parseJson<{departments?:string[],locations?:string[],assetCategories?:string[],assetStatuses?:string[]}>(role.scope_json,{});
   u.locations=[...parseJson<string[]>(role.locations_json,[]),...(scope.locations||[])];
   u.extraDepartments=scope.departments||[];u.assetCategories=scope.assetCategories||[];u.assetStatuses=scope.assetStatuses||[];u.assignedOnly=!!role.assigned_only;
   if(role.vendor_access)for(const action of ['view','create','update'])rules.push({subject_type:'customrole',subject_id:role.id,department:'*',page:'suppliers',action,effect:'allow',scope:'all'});
  }
 }
 const legacy=await first('SELECT member_id FROM research_access WHERE member_id=?',u.id);
 if(legacy)for(const action of ['view','upload','process','download'])if(!rules.some(r=>r.page==='research'&&r.action===action&&r.subject_type==='user'&&r.subject_id===u.id))rules.push({subject_type:'user',subject_id:u.id,department:'*',page:'research',action,effect:'allow',scope:'all'});
 u.rules=rules;
 return u;
}
export function parseJson<T>(s:string|null|undefined,fallback:T):T{try{return s?JSON.parse(s) as T:fallback}catch{return fallback}}

// Resolves the session cookie to the person and the workspace they are acting in.
// The workspace always comes from the server-side session, never from the request.
export async function currentUser(req:Request):Promise<Member|null>{
 if(!configured())return null;
 const token=sessionToken(req);if(!/^[a-f0-9]{64}$/.test(token))return null;
 const s=await first<SessionRow>('SELECT member_id,identity_id,support_session_id FROM sessions WHERE token_hash=? AND expires>?',await hash(token),Date.now());
 if(!s)return null;
 const home=await first<MemberRow>(`SELECT ${memberColumns},c.must_change AS mustChange,t.status AS tenantStatus FROM members m JOIN identities i ON i.id=m.identity_id JOIN credentials c ON c.identity_id=i.id JOIN tenants t ON t.id=m.tenant_id WHERE m.id=? AND m.active=1${s.identity_id?' AND m.identity_id=?':''}`,...[s.member_id,...(s.identity_id?[s.identity_id]:[])]);
 if(!home)return null;
 const identity=await first<{id:string,email:string,name:string}>('SELECT id,email,name FROM identities WHERE id=?',home.identityId);
 if(!identity)return null;
 const owner=isPlatformOwner(identity.email);
 // Platform Owner support session: act as an administrator inside the target workspace.
 if(owner&&s.support_session_id){
  const ss=await first<{id:string,tenant_id:string}>('SELECT id,tenant_id FROM support_sessions WHERE id=? AND owner_identity_id=? AND ended_at IS NULL',s.support_session_id,identity.id);
  const target=ss?await first<{id:string,status:string}>("SELECT id,status FROM tenants WHERE id=? AND status!='archived'",ss.tenant_id):null;
  if(ss&&target){
   const u:Member={id:home.id,name:identity.name,email:identity.email,role:'admin',department:'Platform support',active:1,tenantId:target.id,identityId:identity.id,platformRole:'owner',supportSessionId:ss.id,homeTenantId:home.tenantId,mustChange:home.mustChange,title:'Platform Owner'};
   return withAccess(u);
  }
 }
 // Ordinary members of a suspended or archived workspace are locked out; the owner never is.
 if((home as unknown as {tenantStatus:string}).tenantStatus!=='active'&&!owner)return null;
 const u:Member={...home,email:identity.email,identityId:identity.id,platformRole:owner?'owner':null};
 delete (u as unknown as {tenantStatus?:string}).tenantStatus;
 // Presence is refreshed at most every five minutes.
 if(!u.lastSeenAt||Date.parse(u.lastSeenAt)<Date.now()-300000)await run('UPDATE members SET last_seen_at=? WHERE id=?',now(),u.id).catch(()=>{});
 return withAccess(u);
}
export async function requireUser(req:Request){const u=await currentUser(req);if(!u)throw new HttpError(401,'Sign in with your workspace account.');if(u.mustChange)throw new HttpError(403,'Change your initial password before accessing workspace data.');return u}
export function requirePlatformOwner(u:Member){if(u.platformRole!=='owner')throw new HttpError(403,'The Platform Console is restricted to the Platform Owner.')}
export async function readBody(req:Request,limit=64000){const s=await req.text();if(s.length>limit)throw new HttpError(413,'Request is too large.');try{return JSON.parse(s) as Record<string,unknown>}catch{throw new HttpError(400,'Invalid request data.')}}

// Records every request the Platform Owner makes inside another workspace.
export function platformAuditStatement(u:{identityId:string,tenantId?:string|null,supportSessionId?:string|null},action:string,req?:Request,detail?:unknown){const url=req?new URL(req.url):null;return stmt('INSERT INTO platform_audit(id,actor_identity_id,tenant_id,support_session_id,action,method,path,detail_json,ip,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.identityId,u.tenantId||null,u.supportSessionId||null,action,req?.method||'',url?url.pathname+(url.search.length<300?url.search:''):'',detail===undefined?null:JSON.stringify(detail),req?clientIp(req):'',now())}

// Wraps a handler with the session, same-origin checks for writes, optional module gating,
// support-session auditing and error mapping.
export function route(fn:(req:Request,u:Member)=>Promise<unknown>,opts:{module?:string}={}){return async(req:Request)=>{try{
 if(!['GET','HEAD'].includes(req.method))sameOrigin(req);
 const u=await requireUser(req);
 if(opts.module){const mod=moduleCatalog.find(m=>m.id===opts.module);if(mod&&mod.pages.every(p=>u.disabledPages?.includes(p)))throw new HttpError(404,'This module is not enabled for your workspace.')}
 if(u.supportSessionId)await platformAuditStatement(u,req.method==='GET'?'support.view':'support.change',req).run();
 const out=await fn(req,u);
 return out instanceof Response?out:json(out??{ok:true});
}catch(e){return failure(e)}}}

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
// Numbers already used (e.g. by imports or a changed prefix) are skipped, so a collision never blocks work.
const numbered:Record<string,[string,string]>={TKT:['tickets','number'],PR:['purchase_docs','number'],PO:['purchase_docs','number'],WO:['work_orders','number']};
export async function nextNumber(tenantId:string,prefix:string,yearly=true,check?:[string,string]){const key=yearly?`${prefix}-${new Date().getUTCFullYear()}`:prefix;const guard=check||numbered[prefix]||(yearly?null:['assets','code']);for(let i=0;i<50;i++){const r=await first<{value:number}>('INSERT INTO counters(tenant_id,key,value) VALUES(?,?,1) ON CONFLICT(tenant_id,key) DO UPDATE SET value=value+1 RETURNING value',tenantId,key);const n=`${key}-${String(r?.value||1).padStart(yearly?4:5,'0')}`;if(!guard||!await first(`SELECT 1 FROM ${guard[0]} WHERE tenant_id=? AND ${guard[1]}=?`,tenantId,n))return n}throw new HttpError(409,'Could not allocate a document number. Try again.')}

export const projection='id,module,title,department,status,owner,amount,details,updated,version,created_by AS createdBy,file_key AS fileKey';
export async function getRecord(u:{tenantId:string},id:string){return first<Item>(`SELECT ${projection} FROM records WHERE id=? AND tenant_id=?`,id,u.tenantId)}
// Every audit row made during a Platform Owner support session carries the support session id.
export function auditStatement(u:{id:string,tenantId:string,supportSessionId?:string|null},action:string,id:string,department:string,before:unknown,after:unknown){return stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id,support_session_id) VALUES (?,?,?,?,?,?,?,?,?,?)',uid(),action,u.id,id,department||'',before?JSON.stringify(before):null,after?JSON.stringify(after):null,now(),u.tenantId,u.supportSessionId||null)}
