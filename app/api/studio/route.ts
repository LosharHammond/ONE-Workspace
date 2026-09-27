import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,auditStatement,parseJson,run} from '../../server/core';
import {validateApp,emptyApp,type AppDef,type Automation} from '../../studio-def';
import {canBuild,roleMatch,dryRun,automationLimit,scheduleStatement,type AppRow} from '../../server/studio';
import {generateAutomation} from '../../server/studio-ai';
import {enqueueStatement,kick} from '../../server/jobs';
import {notify} from '../../server/notify';
import {PLATFORM_SCOPE} from '../../server/secrets';
import {widgetTypes} from '../../widgets';
import type {Member} from '../../server/policy';

// Workspace Studio: app lifecycle (draft → test → submit for approval → publish → deprecate/archive/restore,
// rollback), AI-drafted automations (always disabled drafts), run operations, templates, widget presets and
// extensions of built-in modules. Published versions are immutable rows; the draft lives on the app.
function memberDefinition(value:AppDef,u:Member):AppDef{
 const d=JSON.parse(JSON.stringify(value)) as AppDef;
 d.tables=d.tables.filter(t=>roleMatch(u,t.permissions?.view));const keys=new Set(d.tables.map(t=>t.key));
 for(const t of d.tables)t.fields=t.fields.filter(f=>roleMatch(u,f.readRoles));
 d.forms=d.forms.filter(f=>keys.has(f.table)&&roleMatch(u,f.roles)).map(f=>({...f,sections:f.sections.map(s=>({...s,fields:s.fields.filter(k=>d.tables.find(t=>t.key===f.table)?.fields.some(x=>x.key===k))}))}));
 d.reports=d.reports.filter(r=>roleMatch(u,r.roles)&&(r.source.kind!=='table'||keys.has(r.source.id)));
 d.automations=[];d.workflows=d.workflows.filter(w=>keys.has(w.table)).map(w=>({...w,transitions:w.transitions.map(t=>({...t,actions:undefined}))}));
 d.nav=d.nav.filter(n=>n.kind==='table'?keys.has(n.ref):n.kind==='form'?d.forms.some(f=>f.key===n.ref):n.kind==='report'?d.reports.some(r=>r.key===n.ref):true);
 return d;
}
const summary=(a:AppRow)=>({id:a.id,slug:a.slug,name:a.name,description:a.description,icon:a.icon,status:a.status,draftVersion:a.draft_version,publishedVersion:a.published_version,approvalStatus:a.approval_status,disabledReason:a.platform_disabled_reason,paused:parseJson<string[]>(a.paused_json,[]),createdAt:a.created_at,updatedAt:a.updated_at,createdBy:a.created_by,updatedBy:a.updated_by});
function slugOf(v:unknown,name:string){const raw=str(v,'Address',48,false)||name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);const slug=raw.toLowerCase();if(!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug))throw new HttpError(400,'Use lowercase letters, numbers and dashes for the app address.');return slug}
async function known(u:Member){return {connectors:(await all<{id:string}>('SELECT id FROM connectors WHERE tenant_id=?',u.tenantId)).map(r=>r.id),agents:(await all<{id:string}>('SELECT id FROM ai_agents WHERE tenant_id=?',u.tenantId)).map(r=>r.id)}}
async function readDefinition(u:Member,v:unknown):Promise<{def:AppDef,issues:ReturnType<typeof validateApp>}>{
 if(!v||typeof v!=='object'||Array.isArray(v))throw new HttpError(400,'Provide an application definition.');
 const json=JSON.stringify(v);if(json.length>200000)throw new HttpError(413,'Application definitions must be 200 KB or smaller.');
 const source=v as Partial<AppDef>;for(const k of ['tables','forms','workflows','automations','reports','pages','nav'] as const)if(!Array.isArray(source[k]))throw new HttpError(400,'The definition is missing required sections.');
 if(!source.permissions||typeof source.permissions!=='object')throw new HttpError(400,'The definition is missing permissions.');
 const def={...emptyApp(),...source} as AppDef;let issues;try{issues=validateApp(def,await known(u))}catch{throw new HttpError(400,'The application definition contains invalid metadata.')}
 // Pages must be page-builder pages of this workspace.
 for(const p of def.pages)if(/^[0-9a-f-]{36}$/i.test(p.id)&&!await first('SELECT id FROM app_pages WHERE id=? AND tenant_id=?',p.id,u.tenantId))issues.push({level:'error',where:'Pages',message:`The page “${p.title}” no longer exists.`});
 return {def,issues};
}
const fail=(issues:ReturnType<typeof validateApp>,message:string)=>{const errors=issues.filter(x=>x.level==='error');if(errors.length)throw new HttpError(400,JSON.stringify({message,issues:errors}))};
async function load(u:Member,id:string){const a=await first<AppRow>('SELECT * FROM studio_apps WHERE (id=? OR slug=?) AND tenant_id=?',id,id,u.tenantId);if(!a)throw new HttpError(404,'Studio application not found.');return a}
async function publishedDef(u:Member,a:AppRow){if(!a.published_version)return null;const v=await first<{definition_json:string}>('SELECT definition_json FROM studio_app_versions WHERE tenant_id=? AND app_id=? AND version=?',u.tenantId,a.id,a.published_version);return v?parseJson<AppDef>(v.definition_json,emptyApp()):null}

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'studio','view'))throw new HttpError(403,'Workspace Studio is not available to you.');
 const q=new URL(req.url).searchParams;const id=q.get('id');const view=q.get('view');const builder=canBuild(u);
 if(view==='templates')return {templates:(await all<{id:string,tenant_id:string,name:string,description:string,target_tenants_json:string,created_at:string,definition_json:string}>("SELECT * FROM studio_templates WHERE status='active' AND (tenant_id=? OR tenant_id=?) ORDER BY name",u.tenantId,PLATFORM_SCOPE)).filter(t=>t.tenant_id===u.tenantId||(()=>{const tg=parseJson<string[]>(t.target_tenants_json,[]);return !tg.length||tg.includes(u.tenantId)})()).map(t=>{const d=parseJson<AppDef>(t.definition_json,emptyApp());return {id:t.id,name:t.name,description:t.description,scope:t.tenant_id===PLATFORM_SCOPE?'platform':'company',createdAt:t.created_at,tables:d.tables.length,workflows:d.workflows.length,automations:d.automations.length}})};
 if(view==='widgets')return {widgets:(await all<{id:string,name:string,description:string,base_type:string,config_json:string,visibility_json:string,status:string,created_at:string}>("SELECT * FROM studio_widgets WHERE tenant_id=? AND status='active' ORDER BY name",u.tenantId)).map(w=>({id:w.id,name:w.name,description:w.description,baseType:w.base_type,config:parseJson(w.config_json,{}),visibility:parseJson(w.visibility_json,{}),createdAt:w.created_at})),registry:widgetTypes.map(w=>({type:w.type,label:w.label,category:w.category,description:w.description,fields:w.fields.map(f=>f.key),page:w.page||null}))};
 if(view==='extensions')return {extensions:(await all<{entity_type:string,fields_json:string,stages_json:string,version:number,updated_at:string}>('SELECT * FROM module_extensions WHERE tenant_id=?',u.tenantId)).map(e=>({entityType:e.entity_type,fields:parseJson(e.fields_json,[]),stages:parseJson(e.stages_json,[]),version:e.version,updatedAt:e.updated_at})),canEdit:builder};
 if(view==='usage'){if(!builder)throw new HttpError(403,'Only Studio builders see usage.');const lim=await automationLimit(u.tenantId);return {automationRuns:lim,apps:(await first<{n:number}>("SELECT count(*) AS n FROM studio_apps WHERE tenant_id=? AND status!='archived'",u.tenantId))?.n||0,records:(await first<{n:number}>('SELECT count(*) AS n FROM studio_records WHERE tenant_id=? AND deleted_at IS NULL',u.tenantId))?.n||0,byStatus:await all("SELECT status,count(*) AS n FROM studio_automation_runs WHERE tenant_id=? GROUP BY status",u.tenantId)}}
 if(view==='runs'){if(!builder)throw new HttpError(403,'Only Studio builders see automation runs.');const a=await load(u,idOf(q.get('app'),'Application'));return {runs:(await all<{id:string,automation_id:string,app_version:number,trigger:string,status:string,dry_run:number,input_json:string,output_json:string,error:string,attempts:number,started_at:string,finished_at:string|null}>('SELECT * FROM studio_automation_runs WHERE tenant_id=? AND app_id=? ORDER BY started_at DESC LIMIT 200',u.tenantId,a.id)).map(r=>({id:r.id,automationId:r.automation_id,version:r.app_version,trigger:r.trigger,status:r.status,dryRun:!!r.dry_run,input:parseJson(r.input_json,{}),output:parseJson(r.output_json,{}),error:r.error,attempts:r.attempts,startedAt:r.started_at,finishedAt:r.finished_at}))}}
 if(id){
  const a=await load(u,idOf(id,'Application'));const wanted=q.get('version');
  if(!builder){
   if(a.status!=='published'||a.platform_disabled_reason||!a.published_version)throw new HttpError(404,'Studio application not found.');
   const d=await publishedDef(u,a);if(!d||!roleMatch(u,d.permissions?.use))throw new HttpError(404,'Studio application not found.');
   return {app:summary(a),definition:memberDefinition(d,u),version:a.published_version,canManage:false,versions:[]};
  }
  let definition:AppDef;let version:number;let note='';
  if(wanted==='published'||(wanted&&Number(wanted))){const v=wanted==='published'?a.published_version:Number(wanted);const row=v?await first<{definition_json:string,note:string}>('SELECT definition_json,note FROM studio_app_versions WHERE tenant_id=? AND app_id=? AND version=?',u.tenantId,a.id,v):null;if(!row)throw new HttpError(404,'Application version not found.');definition=parseJson<AppDef>(row.definition_json,emptyApp());version=v!;note=row.note}
  else{definition={...emptyApp(),...parseJson<Partial<AppDef>>(a.draft_json,{})};version=a.draft_version}
  const versions=await all('SELECT version,note,created_by AS createdBy,created_at AS createdAt,test_report_json AS testReport FROM studio_app_versions WHERE tenant_id=? AND app_id=? ORDER BY version DESC LIMIT 100',u.tenantId,a.id);
  return {app:summary(a),definition,version,note,canManage:true,versions,issues:validateApp(definition,await known(u))};
 }
 const rows=await all<AppRow>("SELECT * FROM studio_apps WHERE tenant_id=? AND status!='archived' OR (tenant_id=? AND status='archived' AND ?) ORDER BY updated_at DESC LIMIT 200",u.tenantId,u.tenantId,builder?1:0);
 const out=[];for(const a of rows){if(builder){out.push(summary(a));continue}if(a.status!=='published'||a.platform_disabled_reason||!a.published_version)continue;const d=await publishedDef(u,a);if(d&&roleMatch(u,d.permissions?.use))out.push(summary(a))}
 return {apps:out,canCreate:builder};
},{module:'studio'});

export const POST=route(async(req,u)=>{
 if(!hasAction(u,'studio','view'))throw new HttpError(403,'Workspace Studio is not available to you.');
 const b=await readBody(req,300000),action=str(b.action,'Action',32);
 if(!canBuild(u))throw new HttpError(403,'Only a Workspace Administrator can build Studio apps.');
 if(action==='generate-automation'){
  // AI drafts are returned (and optionally stored) as DISABLED automations; nothing is published or activated.
  const a=b.id?await load(u,idOf(b.id,'Application')):null;const def=a?{...emptyApp(),...parseJson<Partial<AppDef>>(a.draft_json,{})}:undefined;
  const r=await generateAutomation(u,str(b.text,'Description',2000),def);
  if(a&&b.save===true){def!.automations.push(...r.drafts.map(d=>d.automation));await batch([stmt('UPDATE studio_apps SET draft_json=?,draft_version=draft_version+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(def),u.id,now(),a.id,u.tenantId),auditStatement(u,'AI automation drafts added (disabled, unpublished)',a.id,'Workspace Studio',null,{count:r.drafts.length,prompt:String(b.text).slice(0,300)})])}
  return {...r,saved:!!(a&&b.save===true)};
 }
 if(action==='create'||action==='use-template'){
  const name=str(b.name,'Name',120),description=str(b.description,'Description',500,false),slug=slugOf(b.slug,name);
  let source:unknown=b.definition;
  if(action==='use-template'){const t=await first<{definition_json:string,tenant_id:string,target_tenants_json:string}>("SELECT * FROM studio_templates WHERE id=? AND status='active' AND (tenant_id=? OR tenant_id=?)",idOf(b.templateId,'Template'),u.tenantId,PLATFORM_SCOPE);if(!t)throw new HttpError(404,'Template not found.');const tg=parseJson<string[]>(t.target_tenants_json,[]);if(t.tenant_id===PLATFORM_SCOPE&&tg.length&&!tg.includes(u.tenantId))throw new HttpError(404,'Template not found.');source=parseJson(t.definition_json,emptyApp())}
  const {def,issues}=await readDefinition(u,source||emptyApp());fail(issues,'Fix validation errors before saving this app.');
  if(await first('SELECT id FROM studio_apps WHERE tenant_id=? AND slug=?',u.tenantId,slug))throw new HttpError(409,'Another app already uses this address.');
  const id=uid(),ts=now();await batch([stmt("INSERT INTO studio_apps(id,tenant_id,slug,name,description,icon,status,draft_json,draft_version,published_version,approval_status,template_id,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,'draft',?,1,NULL,'none',?,?,?,?,?)",id,u.tenantId,slug,name,description,str(b.icon||'AppWindow','Icon',40),JSON.stringify(def),action==='use-template'?String(b.templateId):null,u.id,ts,u.id,ts),auditStatement(u,action==='use-template'?'Studio app created from template':'Studio app created',id,'Workspace Studio',null,{slug,tables:def.tables.length})]);
  return {ok:true,id,version:1,issues};
 }
 if(action==='widget-save'){
  const base=str(b.baseType,'Widget type',40);if(!widgetTypes.some(w=>w.type===base))throw new HttpError(400,'Choose an approved widget type.');const {validateLayout}=await import('../../server/widgets');validateLayout({sections:[{rows:[{columns:[{widgets:[{id:'w1',type:base,config:b.config||{}}]}]}]}]});
  const id=b.id?idOf(b.id,'Widget'):uid();await batch([b.id?stmt('UPDATE studio_widgets SET name=?,description=?,base_type=?,config_json=?,visibility_json=?,updated_at=? WHERE id=? AND tenant_id=?',str(b.name,'Name',80),str(b.description,'Description',300,false),base,JSON.stringify(b.config||{}),JSON.stringify(b.visibility||{}),now(),id,u.tenantId):stmt("INSERT INTO studio_widgets(id,tenant_id,name,description,base_type,config_json,visibility_json,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?,?)",id,u.tenantId,str(b.name,'Name',80),str(b.description,'Description',300,false),base,JSON.stringify(b.config||{}),JSON.stringify(b.visibility||{}),u.id,now(),now()),auditStatement(u,'Reusable widget saved',id,'Workspace Studio',null,{base})]);return {id};
 }
 if(action==='widget-delete'){await batch([stmt("UPDATE studio_widgets SET status='deleted' WHERE id=? AND tenant_id=?",idOf(b.id,'Widget'),u.tenantId),auditStatement(u,'Reusable widget deleted',String(b.id),'Workspace Studio',null,null)]);return {ok:true}}
 if(action==='extension-save'){
  // Custom fields and stages on built-in modules (validated with the same field rules as Studio tables).
  const type=str(b.entityType,'Module',30);if(!['ticket','asset','project','task','PR','PO','vendor','person','work_order'].includes(type))throw new HttpError(400,'This module cannot be extended.');
  const fields=Array.isArray(b.fields)?b.fields.slice(0,40):[];const stages=Array.isArray(b.stages)?b.stages.map((x:unknown)=>str(x,'Stage',60)).slice(0,20):[];
  const issues=validateApp({...emptyApp(),tables:[{key:'ext',name:'Extension',fields,titleField:fields[0]?.key||'',permissions:{view:[],create:[],edit:[],delete:[],scope:'all'}}]}).filter(x=>x.level==='error'&&!/record title|at least one field/.test(x.message));if(issues.length)throw new HttpError(400,issues.map(i=>i.message).join(' '));
  await batch([stmt('INSERT INTO module_extensions(id,tenant_id,entity_type,fields_json,stages_json,version,updated_by,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(tenant_id,entity_type) DO UPDATE SET fields_json=excluded.fields_json,stages_json=excluded.stages_json,version=module_extensions.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at',uid(),u.tenantId,type,JSON.stringify(fields),JSON.stringify(stages),u.id,now()),auditStatement(u,`Custom fields for ${type} changed`,type,'Workspace Studio',null,{fields:fields.length,stages})]);return {ok:true};
 }
 if(action==='retry-run'){const r=await first<{id:string,app_id:string,status:string}>('SELECT id,app_id,status FROM studio_automation_runs WHERE id=? AND tenant_id=?',idOf(b.runId,'Run'),u.tenantId);if(!r)throw new HttpError(404,'Run not found.');if(!['failed','blocked','retrying','cancelled'].includes(r.status))throw new HttpError(409,'Only failed runs can be retried.');await batch([stmt("UPDATE studio_automation_runs SET status='queued',error='' WHERE id=?",r.id),enqueueStatement(u.tenantId,'studio.automation',r.id,{},{key:`retry:${r.id}:${now()}`,maxAttempts:4}),auditStatement(u,'Automation run retried',r.app_id,'Workspace Studio',null,{run:r.id})]);kick(3);return {ok:true}}
 if(action==='delete-template'){await batch([stmt("UPDATE studio_templates SET status='deleted' WHERE id=? AND tenant_id=?",idOf(b.id,'Template'),u.tenantId),auditStatement(u,'Studio template deleted',String(b.id),'Workspace Studio',null,null)]);return {ok:true}}
 const a=await load(u,idOf(b.id,'Application'));
 const draft=()=>({...emptyApp(),...parseJson<Partial<AppDef>>(a.draft_json,{})}) as AppDef;
 switch(action){
  case 'save':{
   if(b.baseVersion!==undefined&&Number(b.baseVersion)!==a.draft_version)throw new HttpError(409,'Someone else changed this app. Reload its latest draft before saving.');
   const {def,issues}=await readDefinition(u,b.definition);fail(issues,'Fix validation errors before saving this app.');
   // Editing a published app changes only the draft; the published version stays as it was.
   const version=a.draft_version+1;await batch([stmt("UPDATE studio_apps SET name=?,description=?,icon=?,draft_json=?,draft_version=?,approval_status=CASE WHEN approval_status='approved' THEN 'none' ELSE approval_status END,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",str(b.name??a.name,'Name',120),str(b.description??a.description,'Description',500,false),str(b.icon??a.icon,'Icon',40),JSON.stringify(def),version,u.id,now(),a.id,u.tenantId),auditStatement(u,'Studio app draft saved',a.id,'Workspace Studio',{version:a.draft_version},{version,tables:def.tables.length,automations:def.automations.length})]);
   return {ok:true,id:a.id,version,issues};
  }
  case 'test':{
   const {def,issues}=await readDefinition(u,b.definition??draft());
   const report={passed:!issues.some(x=>x.level==='error'),errors:issues.filter(x=>x.level==='error').length,warnings:issues.filter(x=>x.level==='warning').length,testedAt:now(),testedBy:u.id,summary:{tables:def.tables.length,forms:def.forms.length,workflows:def.workflows.length,automations:def.automations.length,reports:def.reports.length}};
   await run('UPDATE studio_apps SET updated_at=updated_at WHERE id=?',a.id);
   return {ok:report.passed,issues,report,summary:report.summary,checks:{metadata:true,tenantScope:true,workflowGraph:issues.filter(x=>x.where.startsWith('Workflow')).every(x=>x.level!=='error'),untrustedCode:false}};
  }
  case 'dry-run':return dryRun(u,a,draft(),str(b.automationId,'Automation',60),(b.sample&&typeof b.sample==='object'?b.sample:{}) as Record<string,unknown>);
  case 'submit-for-approval':{
   const {issues}=await readDefinition(u,draft());fail(issues,'Fix validation errors before submitting.');
   await batch([stmt("UPDATE studio_apps SET approval_status='pending',updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",u.id,now(),a.id,u.tenantId),auditStatement(u,'Studio app submitted for publishing approval',a.id,'Workspace Studio',null,{version:a.draft_version})]);
   const admins=(await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin' AND id<>?",u.tenantId,u.id)).map(r=>r.id);await notify(u,admins,{kind:'approval',title:`Publish approval requested: ${a.name}`,link:`#/studio/apps/${a.id}`});return {ok:true};
  }
  case 'approve-publish':case 'reject-publish':{
   if(a.approval_status!=='pending')throw new HttpError(409,'Nothing is waiting for approval.');if(a.updated_by===u.id)throw new HttpError(403,'Another administrator must approve your submission.');
   await batch([stmt('UPDATE studio_apps SET approval_status=? WHERE id=? AND tenant_id=?',action==='approve-publish'?'approved':'rejected',a.id,u.tenantId),auditStatement(u,action==='approve-publish'?'Studio app approved for publishing':'Studio app publishing rejected',a.id,'Workspace Studio',null,{note:str(b.note,'Note',300,false)})]);return {ok:true};
  }
  case 'publish':case 'rollback':{
   if(!hasAction(u,'studio','publish'))throw new HttpError(403,'You cannot publish Studio apps.');
   let json=a.draft_json,note=str(b.note,'Version note',200,false)||'Published';
   if(action==='rollback'){const target=Number(b.version);const old=Number.isSafeInteger(target)?await first<{definition_json:string}>('SELECT definition_json FROM studio_app_versions WHERE tenant_id=? AND app_id=? AND version=?',u.tenantId,a.id,target):null;if(!old)throw new HttpError(404,'Application version not found.');json=old.definition_json;note=`Rolled back to version ${target}`}
   const {def,issues}=await readDefinition(u,parseJson(json,emptyApp()));const errors=issues.filter(x=>x.level==='error');if(errors.length)throw new HttpError(409,JSON.stringify({message:'This application has validation errors and cannot be published.',issues:errors}));
   if(action==='publish'&&def.settings?.requiresApproval&&a.approval_status!=='approved')throw new HttpError(409,'This app requires approval before publishing. Submit it for approval first.');
   const current=await first<{version:number}>('SELECT max(version) AS version FROM studio_app_versions WHERE tenant_id=? AND app_id=?',u.tenantId,a.id),version=(current?.version||0)+1,ts=now();
   await batch([stmt('INSERT INTO studio_app_versions(id,tenant_id,app_id,version,definition_json,note,test_report_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,a.id,version,JSON.stringify(def),note,JSON.stringify({passed:true,warnings:issues.filter(x=>x.level==='warning').length,checkedAt:ts}),u.id,ts),
    stmt("UPDATE studio_apps SET status='published',published_version=?,approval_status='none',updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",version,u.id,ts,a.id,u.tenantId),
    auditStatement(u,action==='rollback'?`Studio app rolled back (version ${version})`:`Studio app published (version ${version})`,a.id,'Workspace Studio',{published:a.published_version},{published:version,automations:def.automations.filter((x:Automation)=>x.enabled).length}),
    scheduleStatement(u.tenantId)]);kick(2);
   return {ok:true,version,issues};
  }
  case 'pause-automation':case 'resume-automation':{const id=str(b.automationId,'Automation',60);const set=new Set(parseJson<string[]>(a.paused_json,[]));action==='pause-automation'?set.add(id):set.delete(id);await batch([stmt('UPDATE studio_apps SET paused_json=? WHERE id=? AND tenant_id=?',JSON.stringify([...set]),a.id,u.tenantId),auditStatement(u,`Automation ${action==='pause-automation'?'paused':'resumed'}`,a.id,'Workspace Studio',null,{automation:id})]);return {ok:true}}
  case 'save-template':{const d=a.published_version?(await first<{definition_json:string}>('SELECT definition_json FROM studio_app_versions WHERE tenant_id=? AND app_id=? AND version=?',u.tenantId,a.id,a.published_version))?.definition_json:a.draft_json;const id=uid();await batch([stmt("INSERT INTO studio_templates(id,tenant_id,name,description,definition_json,target_tenants_json,status,created_by,created_at) VALUES(?,?,?,?,?,'[]','active',?,?)",id,u.tenantId,str(b.name||a.name,'Template name',120),str(b.description||a.description,'Description',500,false),d||'{}',u.id,now()),auditStatement(u,'Studio template saved',id,'Workspace Studio',null,{from:a.id})]);return {id}}
  case 'deprecate':case 'archive':case 'restore':{const status=action==='deprecate'?'deprecated':action==='archive'?'archived':a.published_version?'published':'draft';await batch([stmt('UPDATE studio_apps SET status=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',status,u.id,now(),a.id,u.tenantId),auditStatement(u,`Studio app ${action}d`,a.id,'Workspace Studio',{status:a.status},{status})]);return {ok:true,status}}
 }
 throw new HttpError(400,'Unsupported Workspace Studio action.');
},{module:'studio'});
