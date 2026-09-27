import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,requirePlatformOwner,platformAuditStatement,parseJson} from '../../../server/core';
import {platformSetting,platformSettingStatement} from '../../../server/platform-settings';
import {PLATFORM_SCOPE} from '../../../server/secrets';
import {validateApp,emptyApp,type AppDef} from '../../../studio-def';
import {widgetTypes} from '../../../widgets';

// Platform Owner oversight of the company operating system across every workspace: Studio templates published
// to selected companies, disabling unsafe applications, approving widget types, Studio usage and audit, and a
// per-company AI kill switch. Every call is written to the platform audit trail.
export const GET=route(async(req,u)=>{
 requirePlatformOwner(u);const q=new URL(req.url).searchParams;const view=q.get('view')||'overview';
 if(view==='overview'){
  const [apps,records,runs,agents,agentRuns,templates,widgetPolicy,audit,tenants]=await Promise.all([
   all<{tenant_id:string,n:number,published:number,disabled:number}>("SELECT tenant_id,count(*) AS n,sum(status='published') AS published,sum(platform_disabled_reason IS NOT NULL) AS disabled FROM studio_apps GROUP BY tenant_id"),
   all<{tenant_id:string,n:number}>('SELECT tenant_id,count(*) AS n FROM studio_records WHERE deleted_at IS NULL GROUP BY tenant_id'),
   all<{tenant_id:string,n:number,failed:number}>("SELECT tenant_id,count(*) AS n,sum(status='failed') AS failed FROM studio_automation_runs GROUP BY tenant_id"),
   all<{tenant_id:string,n:number,killed:number}>('SELECT tenant_id,count(*) AS n,sum(killed) AS killed FROM ai_agents GROUP BY tenant_id'),
   all<{tenant_id:string,n:number,tokens:number}>('SELECT tenant_id,count(*) AS n,coalesce(sum(prompt_tokens+completion_tokens),0) AS tokens FROM ai_agent_runs GROUP BY tenant_id'),
   all<{id:string,name:string,description:string,target_tenants_json:string,status:string,created_at:string}>("SELECT id,name,description,target_tenants_json,status,created_at FROM studio_templates WHERE tenant_id=? ORDER BY created_at DESC",PLATFORM_SCOPE),
   platformSetting<{disabled?:string[]}>('widgetPolicy',{}),
   all("SELECT a.tenant_id AS tenantId,t.name AS workspace,a.action,a.created_at AS createdAt,m.name AS who FROM audit a JOIN tenants t ON t.id=a.tenant_id LEFT JOIN members m ON m.id=a.actor AND m.tenant_id=a.tenant_id WHERE a.department IN ('Workspace Studio','AI') ORDER BY a.created_at DESC LIMIT 100"),
   all<{id:string,name:string,settings_json:string}>("SELECT id,name,settings_json FROM tenants WHERE status!='archived' AND id<>? ORDER BY name",PLATFORM_SCOPE),
  ]);
  const byT=<T extends {tenant_id:string}>(l:T[],id:string)=>l.find(x=>x.tenant_id===id);
  return {workspaces:tenants.map(t=>({id:t.id,name:t.name,apps:byT(apps,t.id)?.n||0,published:byT(apps,t.id)?.published||0,disabledApps:byT(apps,t.id)?.disabled||0,records:byT(records,t.id)?.n||0,automationRuns:byT(runs,t.id)?.n||0,failedRuns:byT(runs,t.id)?.failed||0,agents:byT(agents,t.id)?.n||0,killedAgents:byT(agents,t.id)?.killed||0,agentRuns:byT(agentRuns,t.id)?.n||0,agentTokens:byT(agentRuns,t.id)?.tokens||0,aiKillSwitch:!!parseJson<{aiKillSwitch?:boolean}>(t.settings_json,{}).aiKillSwitch})),
   templates:templates.map(t=>({...t,targets:parseJson<string[]>(t.target_tenants_json,[])})),widgets:widgetTypes.map(w=>({type:w.type,label:w.label,category:w.category,enabled:!(widgetPolicy.disabled||[]).includes(w.type)})),audit};
 }
 if(view==='apps'){const t=idOf(q.get('tenant'),'Workspace');return {apps:await all('SELECT id,name,slug,status,published_version AS publishedVersion,platform_disabled_reason AS disabledReason,updated_at AS updatedAt FROM studio_apps WHERE tenant_id=? ORDER BY name',t)}}
 throw new HttpError(400,'Unknown view.');
});
export const POST=route(async(req,u)=>{
 requirePlatformOwner(u);const b=await readBody(req,300000);const action=str(b.action,'Action',32);
 switch(action){
  case 'template-save':{
   const def={...emptyApp(),...(b.definition&&typeof b.definition==='object'?b.definition:{})} as AppDef;const errors=validateApp(def).filter(x=>x.level==='error');if(errors.length)throw new HttpError(400,errors.map(e=>e.message).join(' '));
   const targets=(Array.isArray(b.targets)?b.targets:[]).map((x:unknown)=>idOf(x,'Workspace')).slice(0,500);const id=b.id?idOf(b.id,'Template'):uid();
   await batch([b.id?stmt('UPDATE studio_templates SET name=?,description=?,definition_json=?,target_tenants_json=? WHERE id=? AND tenant_id=?',str(b.name,'Name',120),str(b.description,'Description',500,false),JSON.stringify(def),JSON.stringify(targets),id,PLATFORM_SCOPE):stmt("INSERT INTO studio_templates(id,tenant_id,name,description,definition_json,target_tenants_json,status,created_by,created_at) VALUES(?,?,?,?,?,?,'active',?,?)",id,PLATFORM_SCOPE,str(b.name,'Name',120),str(b.description,'Description',500,false),JSON.stringify(def),JSON.stringify(targets),u.id,now()),platformAuditStatement({...u,tenantId:null},'studio.template-saved',req,{id,targets:targets.length||'all'})]);return {id};
  }
  case 'template-retire':{await batch([stmt("UPDATE studio_templates SET status='retired' WHERE id=? AND tenant_id=?",idOf(b.id,'Template'),PLATFORM_SCOPE),platformAuditStatement({...u,tenantId:null},'studio.template-retired',req,{id:b.id})]);return {ok:true}}
  case 'disable-app':case 'enable-app':{
   const tenant=idOf(b.tenantId,'Workspace'),app=idOf(b.appId,'Application');const a=await first<{id:string}>('SELECT id FROM studio_apps WHERE id=? AND tenant_id=?',app,tenant);if(!a)throw new HttpError(404,'Application not found.');
   const reason=action==='disable-app'?str(b.reason,'Reason',300):null;
   await batch([stmt('UPDATE studio_apps SET platform_disabled_reason=? WHERE id=? AND tenant_id=?',reason,app,tenant),stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,NULL,?,?,?)',uid(),action==='disable-app'?'Studio app disabled by the Platform Owner':'Studio app re-enabled by the Platform Owner',u.id,app,'Workspace Studio',JSON.stringify({reason}),now(),tenant),platformAuditStatement({...u,tenantId:tenant},`studio.${action}`,req,{app,reason})]);return {ok:true};
  }
  case 'widget-policy':{const disabled=(Array.isArray(b.disabled)?b.disabled:[]).map(String).filter((t:string)=>widgetTypes.some(w=>w.type===t));await batch([platformSettingStatement('widgetPolicy',{disabled},u.id),platformAuditStatement({...u,tenantId:null},'studio.widget-policy',req,{disabled})]);return {ok:true,disabled}}
  case 'ai-kill':{const tenant=idOf(b.tenantId,'Workspace');const t=await first<{settings_json:string}>('SELECT settings_json FROM tenants WHERE id=?',tenant);if(!t)throw new HttpError(404,'Workspace not found.');const s=parseJson<Record<string,unknown>>(t.settings_json,{});const on=b.on===true;
   await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...s,aiKillSwitch:on}),tenant),stmt("UPDATE ai_agent_runs SET status='killed',error='Stopped by the Platform Owner.',finished_at=? WHERE tenant_id=? AND status IN ('queued','running')",now(),tenant),stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,NULL,?,?,?)',uid(),on?'AI kill switch turned ON by the Platform Owner':'AI kill switch turned off by the Platform Owner',u.id,tenant,'AI',JSON.stringify({on}),now(),tenant),platformAuditStatement({...u,tenantId:tenant},'ai.kill-switch',req,{on})]);return {ok:true,on};
  }
 }
 throw new HttpError(400,'Unknown action.');
});
