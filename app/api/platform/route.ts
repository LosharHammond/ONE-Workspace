import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,num,requirePlatformOwner,platformAuditStatement,sessionToken,hash,clientIp,parseJson,OWNER_HOME_TENANT,isPlatformOwner,type Tenant} from '../../server/core';
import {seedTenant,starterSettings,defaultSeedOptions,type SeedOptions} from '../../server/tenancy';
import {identityFor,prepareToken,deliverToken} from '../../server/auth';
import {moduleIds,planLimits,enabledModules,entitledPages,pagesForModules,legacyModules} from '../../modules';
import {withDependencies,planRank,assignablePages,type PagePlan} from '../../page-catalog';
import {effectiveCatalog,platformSettingStatement,platformSetting} from '../../server/platform-settings';
import {platformAi,GROQ_DEFAULT_MODEL} from '../../server/ai';
import type {Member} from '../../server/policy';

// Platform Console API. Only the Platform Owner reaches any of this; every call is written to platform_audit.
const plans=['starter','business','enterprise'] as const;
const statuses=['active','suspended','archived'] as const;
function domainsOf(v:unknown){const d=str(v,'Email domains',300,false).toLowerCase().split(',').map(s=>s.trim().replace(/^@/,'')).filter(Boolean);if(d.some(x=>!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)))throw new HttpError(400,'Enter email domains like company.com, separated by commas.');return d}
// Company pages for a workspace: known, not platform-only, dependencies added, within the plan unless allowed.
async function validPages(input:unknown,plan:string,allowAbovePlan:boolean){
 if(!Array.isArray(input))throw new HttpError(400,'Choose the pages this company receives.');
 const cat=await effectiveCatalog();const byId=new Map(cat.pages.map(p=>[p.id,p]));
 const asked=input.map(String);
 for(const p of asked){const c=byId.get(p);if(!c||!assignablePages.includes(p))throw new HttpError(400,'Choose valid pages.');if(c.kind==='platform')throw new HttpError(400,`${c.name} is platform-only and cannot be given to a company.`)}
 const pages=withDependencies(asked).filter(p=>byId.get(p)?.kind==='company');
 const above=pages.filter(p=>planRank[byId.get(p)!.plan]>planRank[(plan in planRank?plan:'business') as PagePlan]);
 if(above.length&&!allowAbovePlan)throw new HttpError(400,`${above.map(p=>byId.get(p)!.name).join(', ')} need a higher plan. Upgrade the plan or allow pages above the plan.`);
 return {pages,added:pages.filter(p=>!asked.includes(p))};
}
async function loadTenant(id:string){const t=await first<Tenant>('SELECT * FROM tenants WHERE id=?',id);if(!t)throw new HttpError(404,'Workspace not found.');return t}
const settingsOf=(t:Tenant)=>parseJson<Record<string,unknown>>(t.settings_json,{});

export const GET=route(async(req,u)=>{
 requirePlatformOwner(u);
 const url=new URL(req.url),id=url.searchParams.get('id'),view=url.searchParams.get('view');
 if(view==='catalog'){
  const cat=await effectiveCatalog();
  const tenants=await all<Tenant>("SELECT * FROM tenants WHERE status!='archived' ORDER BY name");
  return {...cat,workspaces:tenants.map(t=>({id:t.id,name:t.name,plan:t.plan,status:t.status,pages:entitledPages(settingsOf(t))}))};
 }
 if(view==='health'){
  // Platform-wide AI consumption and connector status (counts only; no prompts or secrets).
  const since=new Date(Date.now()-30*86400000).toISOString();
  const [ai,connectors,cfg,platform]=await Promise.all([
   all("SELECT t.id,t.name,count(a.id) AS requests,coalesce(sum(a.prompt_tokens+a.completion_tokens),0) AS tokens,coalesce(sum(1-a.ok),0) AS failures,(SELECT provider FROM ai_providers p WHERE p.tenant_id=t.id AND p.active=1) AS companyProvider FROM tenants t LEFT JOIN ai_usage a ON a.tenant_id=t.id AND a.created_at>=? WHERE t.status!='archived' GROUP BY t.id ORDER BY requests DESC",since),
   all("SELECT c.tenant_id AS tenantId,coalesce(t.name,'Platform') AS workspace,c.id,c.name,c.provider,c.status,c.health,c.last_ok_at AS lastOkAt,c.last_error AS lastError FROM connectors c LEFT JOIN tenants t ON t.id=c.tenant_id ORDER BY c.health='failing' DESC,workspace,c.name LIMIT 500"),
   platformSetting<{model?:string}>('ai',{}),platformAi(),
  ]);
  return {ai,connectors,aiDefault:{configured:!!platform,provider:'Groq',model:cfg.model||GROQ_DEFAULT_MODEL,keySource:'GROQ_API_KEY server secret'}};
 }
 if(view==='audit'){await platformAuditStatement(u,'platform.view-audit',req).run();return {events:await all("SELECT p.*,i.email AS actorEmail,t.name AS tenantName FROM platform_audit p LEFT JOIN identities i ON i.id=p.actor_identity_id LEFT JOIN tenants t ON t.id=p.tenant_id ORDER BY p.created_at DESC LIMIT 300")}}
 if(id){
  const t=await loadTenant(idOf(id,'Workspace'));
  await platformAuditStatement(u,'platform.view-workspace',req,{tenant:t.id}).run();
  const settings=settingsOf(t);
  const [usage,admins,activity,support,storage,invited]=await Promise.all([
   first<Record<string,number>>("SELECT (SELECT count(*) FROM members WHERE tenant_id=?1 AND active=1) AS members,(SELECT count(*) FROM members WHERE tenant_id=?1 AND active=0) AS disabled,(SELECT count(*) FROM assets WHERE tenant_id=?1) AS assets,(SELECT count(*) FROM tickets WHERE tenant_id=?1) AS tickets,(SELECT count(*) FROM tickets WHERE tenant_id=?1 AND status NOT IN ('Resolved','Closed')) AS openTickets,(SELECT count(*) FROM purchase_docs WHERE tenant_id=?1) AS purchasing,(SELECT count(*) FROM files WHERE tenant_id=?1) AS files,(SELECT count(*) FROM pages WHERE tenant_id=?1) AS pages,(SELECT count(*) FROM inventory_items WHERE tenant_id=?1) AS inventoryItems,(SELECT count(*) FROM work_orders WHERE tenant_id=?1) AS workOrders,(SELECT count(*) FROM departments WHERE tenant_id=?1) AS departments,(SELECT count(*) FROM roles WHERE tenant_id=?1) AS roles",t.id),
   all("SELECT m.id,m.name,m.email,m.active,m.last_seen_at AS lastSeenAt,m.invited_at AS invitedAt,(SELECT count(*) FROM credentials c WHERE c.identity_id=m.identity_id) AS activated FROM members m WHERE m.tenant_id=? AND m.role='admin' ORDER BY m.name",t.id),
   all('SELECT a.id,a.action,a.actor,a.created_at AS createdAt,a.support_session_id AS supportSessionId,m.name AS actorName FROM audit a LEFT JOIN members m ON m.id=a.actor WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 60',t.id),
   all('SELECT s.id,s.reason,s.started_at AS startedAt,s.ended_at AS endedAt,s.ip,(SELECT count(*) FROM platform_audit p WHERE p.support_session_id=s.id AND p.method NOT IN (\'GET\',\'HEAD\')) AS changes FROM support_sessions s WHERE s.tenant_id=? ORDER BY s.started_at DESC LIMIT 30',t.id),
   first<{bytes:number}>('SELECT coalesce(sum(bytes),0) AS bytes FROM files WHERE tenant_id=?',t.id),
   first<{n:number}>("SELECT count(*) AS n FROM members m WHERE m.tenant_id=? AND m.active=1 AND NOT EXISTS(SELECT 1 FROM credentials c WHERE c.identity_id=m.identity_id)",t.id),
  ]);
  const last=await first<{at:string}>('SELECT max(last_seen_at) AS at FROM members WHERE tenant_id=?',t.id);
  const limits={...planLimits[t.plan]||planLimits.business,...(settings.limits as object||{})};
  const cat=await effectiveCatalog();
  return {tenant:{...t,settings},modules:enabledModules(settings),pages:entitledPages(settings),catalog:cat.pages,packages:cat.packages,limits,usage:{...usage,storageBytes:storage?.bytes||0,invited:invited?.n||0,lastActive:last?.at||null},admins,activity,support};
 }
 const tenants=await all("SELECT t.id,t.slug,t.name,t.legal_name AS legalName,t.domains,t.status,t.plan,t.brand_color AS brandColor,t.currency,t.created_at AS createdAt,(SELECT count(*) FROM members m WHERE m.tenant_id=t.id AND m.active=1) AS members,(SELECT count(*) FROM assets a WHERE a.tenant_id=t.id) AS assets,(SELECT count(*) FROM tickets k WHERE k.tenant_id=t.id) AS tickets,(SELECT count(*) FROM purchase_docs d WHERE d.tenant_id=t.id) AS purchasing,(SELECT max(m.last_seen_at) FROM members m WHERE m.tenant_id=t.id) AS lastActive FROM tenants t ORDER BY t.status='archived',t.created_at");
 const support=await first('SELECT s.id,s.tenant_id AS tenantId,t.name AS tenantName,s.started_at AS startedAt FROM support_sessions s JOIN tenants t ON t.id=s.tenant_id WHERE s.owner_identity_id=? AND s.ended_at IS NULL ORDER BY s.started_at DESC LIMIT 1',u.identityId);
 return {tenants,homeTenant:OWNER_HOME_TENANT,activeSupport:support};
});

export const POST=route(async(req,u)=>{
 requirePlatformOwner(u);
 const b=await readBody(req);const action=String(b.action||'');
 const log=(name:string,tenantId?:string|null,detail?:unknown)=>platformAuditStatement({...u,tenantId:tenantId??null},name,req,detail);
 if(action==='create')return create(u,b,req);
 if(action==='ai-default'){
  const model=str(b.model,'Model',120);if(!/^[w./:-]+$/.test(model))throw new HttpError(400,'Enter a valid model name.');
  const before=await platformSetting<{model?:string}>('ai',{});
  await batch([platformSettingStatement('ai',{...before,model},u.email),log('ai.default-model',null,{before:before.model||GROQ_DEFAULT_MODEL,after:model})]);
  return {ok:true};
 }
 if(action==='catalog'){
  const cat=await effectiveCatalog();const o={...cat.overrides};
  if(b.page!==undefined){
   const id=String(b.page);if(!assignablePages.includes(id))throw new HttpError(400,'Only company pages can be changed.');
   const x=(b.changes&&typeof b.changes==='object'?b.changes:{}) as Record<string,unknown>;
   const prev=o.pages?.[id]||{};
   const next={...prev,...(x.status?{status:oneOf(x.status,['stable','beta'] as const,'status')}:{}),...(x.plan?{plan:oneOf(x.plan,['starter','business','enterprise'] as const,'plan')}:{}),...(x.platformOnly!==undefined?{platformOnly:!!x.platformOnly}:{}),...(x.description!==undefined?{description:str(x.description,'Description',300,false)}:{}),...(Array.isArray(x.dependsOn)?{dependsOn:x.dependsOn.map(String).filter(d=>assignablePages.includes(d)&&d!==id)}:{}),updatedAt:now()};
   o.pages={...(o.pages||{}),[id]:next};
   await batch([platformSettingStatement('catalog',o,u.email),log('catalog.page',null,{page:id,before:prev,after:next})]);
   return {ok:true};
  }
  if(Array.isArray(b.packages)){
   const packages=b.packages.slice(0,30).map((p:any)=>({id:str(p.id,'Package ID',40).toLowerCase().replace(/[^a-z0-9-]/g,'-'),name:str(p.name,'Package name',60),description:str(p.description,'Description',200,false),pages:withDependencies(Array.isArray(p.pages)?p.pages.map(String):[])}));
   if(new Set(packages.map((p:{id:string})=>p.id)).size!==packages.length)throw new HttpError(400,'Package IDs must be unique.');
   await batch([platformSettingStatement('catalog',{...o,packages},u.email),log('catalog.packages',null,{packages:packages.map((p:{id:string,pages:string[]})=>({id:p.id,pages:p.pages.length}))})]);
   return {ok:true};
  }
  throw new HttpError(400,'Nothing to change.');
 }
 if(action==='support-end'){
  const token=await hash(sessionToken(req));
  const s=await first<{support_session_id:string|null}>('SELECT support_session_id FROM sessions WHERE token_hash=?',token);
  if(s?.support_session_id){const ss=await first<{tenant_id:string}>('SELECT tenant_id FROM support_sessions WHERE id=?',s.support_session_id);await batch([stmt('UPDATE support_sessions SET ended_at=? WHERE id=? AND ended_at IS NULL',now(),s.support_session_id),stmt('UPDATE sessions SET support_session_id=NULL WHERE token_hash=?',token),log('support.exit',ss?.tenant_id,{supportSessionId:s.support_session_id})])}
  return {ok:true};
 }
 const t=await loadTenant(idOf(b.id,'Workspace'));
 const settings=settingsOf(t);
 switch(action){
  case 'support-start':{
   const reason=str(b.reason,'Reason',300);if(reason.length<5)throw new HttpError(400,'Give a short reason for entering this workspace.');
   if(t.status==='archived')throw new HttpError(409,'Restore the workspace before entering it.');
   const token=await hash(sessionToken(req));const id=uid();
   await batch([
    stmt('UPDATE support_sessions SET ended_at=? WHERE owner_identity_id=? AND ended_at IS NULL',now(),u.identityId),
    stmt('INSERT INTO support_sessions(id,owner_identity_id,tenant_id,reason,started_at,ip,user_agent) VALUES(?,?,?,?,?,?,?)',id,u.identityId,t.id,reason,now(),clientIp(req),(req.headers.get('User-Agent')||'').slice(0,300)),
    stmt('UPDATE sessions SET support_session_id=? WHERE token_hash=? AND identity_id=?',id,token,u.identityId),
    log('support.enter',t.id,{supportSessionId:id,reason}),
    stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id,support_session_id) VALUES(?,?,?,?,?,?,?,?)',uid(),`Platform Owner support session started: ${reason}`,u.id,t.id,'Administration',now(),t.id,id),
   ]);
   return {ok:true,supportSessionId:id};
  }
  case 'update':{
   const next={name:str(b.name,'Company name',120),legal_name:str(b.legalName,'Legal name',160,false),domains:domainsOf(b.domains).join(','),brand_color:/^#[0-9a-fA-F]{6}$/.test(String(b.brandColor))?String(b.brandColor):t.brand_color,currency:str(b.currency||t.currency,'Currency',8).toUpperCase(),timezone:str(b.timezone||t.timezone,'Time zone',60),plan:oneOf(b.plan||t.plan,plans,'plan')};
   await batch([stmt('UPDATE tenants SET name=?,legal_name=?,domains=?,brand_color=?,currency=?,timezone=?,plan=? WHERE id=?',next.name,next.legal_name,next.domains,next.brand_color,next.currency,next.timezone,next.plan,t.id),log('workspace.update',t.id,{before:{name:t.name,plan:t.plan,domains:t.domains},after:next})]);
   return {ok:true};
  }
  case 'modules':{
   if(!Array.isArray(b.modules))throw new HttpError(400,'Choose modules.');
   const asked=b.modules.map(String).filter(m=>moduleIds.includes(m));
   // Module switches set the page entitlement to every page of the chosen modules. Modules added after this
   // call was introduced (people, AI, connectors, builder, data) keep their current state unless named.
   const current=enabledModules(settings);
   const mods=[...new Set([...asked,...current.filter(m=>!legacyModules.includes(m)&&!asked.includes(m))])];
   const {pages}=await validPages(pagesForModules(mods),t.plan,true);
   await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...settings,modules:mods,pages,pagesExcluded:assignablePages.filter(p=>!pages.includes(p))}),t.id),log('workspace.modules',t.id,{before:entitledPages(settings),after:pages}),stmt('INSERT INTO audit(id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES(?,?,?,?,?,?,?,?,?)',uid(),'Page entitlements changed by the Platform Owner',u.id,t.id,'Administration',JSON.stringify(entitledPages(settings)),JSON.stringify(pages),now(),t.id)]);
   return {ok:true,pages};
  }
  case 'pages':case 'package':{
   let input:unknown=b.pages;
   if(action==='package'){const cat=await effectiveCatalog();const pkg=cat.packages.find(p=>p.id===b.package);if(!pkg)throw new HttpError(404,'Package not found.');input=pkg.pages}
   const {pages,added}=await validPages(input,t.plan,!!b.allowAbovePlan||action==='package');
   const before=entitledPages(settings);
   const mods=enabledModules({pages});
   await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...settings,pages,pagesExcluded:assignablePages.filter(p=>!pages.includes(p)),modules:mods}),t.id),log('workspace.pages',t.id,{before,after:pages,package:action==='package'?b.package:undefined}),stmt('INSERT INTO audit(id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES(?,?,?,?,?,?,?,?,?)',uid(),'Page entitlements changed by the Platform Owner',u.id,t.id,'Administration',JSON.stringify(before),JSON.stringify(pages),now(),t.id)]);
   return {ok:true,pages,added,removed:before.filter(p=>!pages.includes(p))};
  }
  case 'limits':{
   const cur={...(planLimits[t.plan]||planLimits.business),...((settings.limits as object)||{})} as Record<string,number>;
   const limits={maxUsers:Math.round(num(b.maxUsers,'User limit',1,100000)),maxStorageMb:Math.round(num(b.maxStorageMb,'Storage limit',10,10000000)),aiRequestsPerMonth:Math.round(num(b.aiRequestsPerMonth??cur.aiRequestsPerMonth,'AI requests per month',0,10000000)),maxConnectors:Math.round(num(b.maxConnectors??cur.maxConnectors,'Connector limit',0,1000))};
   await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...settings,limits}),t.id),log('workspace.limits',t.id,limits)]);
   return {ok:true};
  }
  case 'status':{
   const status=oneOf(b.status,statuses,'status');
   if(t.id===OWNER_HOME_TENANT&&status!=='active')throw new HttpError(400,'The Platform Owner workspace cannot be suspended or archived.');
   if(status==='archived'&&String(b.confirm||'')!==t.slug)throw new HttpError(400,`Type the workspace ID (${t.slug}) to archive it.`);
   await batch([
    stmt('UPDATE tenants SET status=? WHERE id=?',status,t.id),
    // Members of a suspended/archived workspace are signed out; the owner's support access is unaffected unless archived.
    ...(status==='active'?[]:[stmt('DELETE FROM sessions WHERE support_session_id IS NULL AND member_id IN (SELECT id FROM members WHERE tenant_id=?)',t.id)]),
    ...(status==='archived'?[stmt('UPDATE support_sessions SET ended_at=? WHERE tenant_id=? AND ended_at IS NULL',now(),t.id)]:[]),
    log(`workspace.${status==='active'?'reactivate':status==='suspended'?'suspend':'archive'}`,t.id,{from:t.status,to:status}),
   ]);
   return {ok:true};
  }
  case 'admin-disable':case 'admin-enable':case 'admin-remove':{
   // Company administrators are managed by the Platform Owner; a workspace always keeps one active admin.
   const m=await first<{id:string,name:string,email:string,active:number,role:string}>('SELECT id,name,email,active,role FROM members WHERE id=? AND tenant_id=?',idOf(b.memberId,'Administrator'),t.id);
   if(!m||m.role!=='admin')throw new HttpError(404,'Administrator not found.');
   if(action!=='admin-enable'){const others=await first<{n:number}>("SELECT count(*) AS n FROM members WHERE tenant_id=? AND role='admin' AND active=1 AND id!=?",t.id,m.id);if(!others?.n)throw new HttpError(409,'This is the only active administrator. Invite another administrator first.')}
   const next=action==='admin-remove'?{role:'employee',active:m.active}:{role:'admin',active:action==='admin-enable'?1:0};
   await batch([stmt('UPDATE members SET role=?,active=?,role_id=CASE WHEN ?=? THEN NULL ELSE role_id END WHERE id=? AND tenant_id=?',next.role,next.active,next.role,"employee",m.id,t.id),...(next.active===0?[stmt('DELETE FROM sessions WHERE member_id=?',m.id)]:[]),stmt('INSERT INTO audit(id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES(?,?,?,?,?,?,?,?,?)',uid(),action==='admin-remove'?'Administrator removed by the Platform Owner':action==='admin-disable'?'Administrator disabled by the Platform Owner':'Administrator reactivated by the Platform Owner',u.id,m.id,'Administration',JSON.stringify({role:m.role,active:m.active}),JSON.stringify(next),now(),t.id),log(`workspace.${action}`,t.id,{email:m.email})]);
   return {ok:true};
  }
  case 'invite-admin':case 'reset-admin':{
   if(t.status==='archived')throw new HttpError(409,'Restore the workspace first.');
   let memberId:string,identityId:string,name:string,email:string;const stmts:D1PreparedStatement[]=[];
   if(action==='reset-admin'){
    const m=await first<{id:string,identity_id:string,name:string,email:string}>("SELECT id,identity_id,name,email FROM members WHERE id=? AND tenant_id=? AND role='admin'",idOf(b.memberId,'Administrator'),t.id);
    if(!m)throw new HttpError(404,'Administrator not found.');
    if(isPlatformOwner(m.email))throw new HttpError(400,'Use the owner setup flow for the Platform Owner account.');
    ({id:memberId,identity_id:identityId,name,email}=m);
   }else{
    name=str(b.name,'Administrator name',100);email=str(b.email,'Administrator email',160).toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid email address.');
    const doms=t.domains.split(',').filter(Boolean);if(doms.length&&!doms.some(d=>email.endsWith('@'+d)))throw new HttpError(400,`Use a ${doms.map(d=>'@'+d).join(' or ')} address.`);
    const idn=await identityFor(email,name);identityId=idn.id;stmts.push(...idn.statements);
    const existing=await first<{id:string}>('SELECT id FROM members WHERE tenant_id=? AND identity_id=?',t.id,identityId);
    if(existing){memberId=existing.id;stmts.push(stmt("UPDATE members SET role='admin',role_id=NULL,active=1 WHERE id=?",memberId))}
    else{memberId=uid();stmts.push(stmt("INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,title,identity_id,invited_at) VALUES(?,?,?,'admin','Administration',1,?,?,'Company administrator',?,?)",memberId,name,email,now(),t.id,identityId,now()))}
    if(idn.activated){await batch([...stmts,log('workspace.admin-added',t.id,{email})]);return {ok:true,emailed:false,note:'This person already has a One Workspace account and can now switch into this workspace.'}}
   }
   const tok=await prepareToken({identityId,memberId,tenantId:t.id,purpose:action==='invite-admin'?'invite':'reset',createdBy:u.id});
   await batch([...stmts,...tok.statements,log(action==='invite-admin'?'workspace.admin-invited':'workspace.admin-reset-link',t.id,{email})]);
   return deliverToken(tok,{purpose:action==='invite-admin'?'invite':'reset',req,workspaceName:t.name,recipient:{email,name},inviterName:'One Workspace'});
  }
 }
 throw new HttpError(400,'Unknown action.');
});

// Provisions a whole workspace in one D1 batch (a single transaction): everything is created or nothing is.
async function create(u:Member,b:Record<string,unknown>,req:Request){
 const name=str(b.name,'Company name',120),slug=str(b.slug,'Workspace ID',40).toLowerCase();
 if(!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug))throw new HttpError(400,'Use 3–40 lowercase letters, numbers and dashes for the workspace ID.');
 const domains=domainsOf(b.domains);
 const adminName=str(b.adminName,'Administrator name',100),adminEmail=str(b.adminEmail,'Administrator email',160).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))throw new HttpError(400,'Enter a valid administrator email.');
 if(domains.length&&!domains.some(d=>adminEmail.endsWith('@'+d)))throw new HttpError(400,'The administrator email must use one of the company domains.');
 if(await first('SELECT id FROM tenants WHERE slug=?',slug))throw new HttpError(409,'This workspace ID is already taken.');
 for(const d of domains){const clash=await first<{name:string}>("SELECT name FROM tenants WHERE ','||domains||',' LIKE ? AND status!='archived'",`%,${d},%`);if(clash)throw new HttpError(409,`The domain ${d} already belongs to another workspace.`)}
 const plan=oneOf(b.plan||'business',plans,'plan');
 const opts:SeedOptions={...defaultSeedOptions,...(b.defaults&&typeof b.defaults==='object'?Object.fromEntries(Object.entries(b.defaults as object).map(([k,v])=>[k,!!v])):{})} as SeedOptions;
 const mods=Array.isArray(b.modules)?b.modules.map(String).filter(m=>moduleIds.includes(m)):moduleIds;
 const cat=await effectiveCatalog();const pkg=typeof b.package==='string'?cat.packages.find(p=>p.id===b.package):null;
 const {pages}=await validPages(Array.isArray(b.pages)?b.pages:pkg?pkg.pages:pagesForModules(mods),String(b.plan||'business'),true);
 const color=/^#[0-9a-fA-F]{6}$/.test(String(b.brandColor))?String(b.brandColor):'#6D5EF8';
 const tenantId=uid(),memberId=uid();
 const idn=await identityFor(adminEmail,adminName);
 const tok=idn.activated?null:await prepareToken({identityId:idn.id,memberId,tenantId,purpose:'invite',createdBy:u.id});
 await batch([
  stmt('INSERT INTO tenants(id,slug,name,legal_name,domains,status,plan,brand_color,currency,timezone,settings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',tenantId,slug,name,str(b.legalName,'Legal name',160,false)||name,domains.join(','),'active',plan,color,str(b.currency||'GHS','Currency',8).toUpperCase(),str(b.timezone||'Africa/Accra','Time zone',60),JSON.stringify({...starterSettings,modules:enabledModules({pages}),pages,limits:planLimits[plan]}),now()),
  ...idn.statements,
  stmt("INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,title,identity_id,invited_at) VALUES(?,?,?,'admin','Administration',1,?,?,'Company administrator',?,?)",memberId,adminName,adminEmail,now(),tenantId,idn.id,idn.activated?null:now()),
  ...seedTenant(tenantId,memberId,name,opts),
  ...(tok?tok.statements:[]),
  stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',uid(),'Workspace created by the Platform Owner',u.id,tenantId,'Administration',now(),tenantId),
  platformAuditStatement({...u,tenantId},'workspace.create',req,{slug,plan,pages,defaults:opts,admin:adminEmail}),
 ]);
 const delivery=tok?await deliverToken(tok,{purpose:'invite',req,workspaceName:name,recipient:{email:adminEmail,name:adminName},inviterName:'One Workspace'}):{emailed:false,link:undefined,note:'The administrator already has an account and can switch into the new workspace.'};
 return {id:tenantId,slug,...delivery};
}
