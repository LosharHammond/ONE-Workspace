import {hasAction} from '../../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,oneOf,auditStatement,parseJson,run,origin} from '../../../server/core';
import {loadConnector,typeOf,configOf,type ConnectorRow} from '../../../server/connectors';
import {manifest,manifestFor,mayUse,federated,connectorRecordsFor,executeAction,confirmAction,pendingActions,actionRuns,queueSync,policyOf} from '../../../server/fabric';
import {connectorTypeById,connectorTypes} from '../../../connector-catalog';
import {kick} from '../../../server/jobs';
import {notify} from '../../../server/notify';
import type {Member} from '../../../server/policy';

// Connector Fabric operations (synced, federated and action modes) for company, department and personal
// connectors. Secrets never leave the server: responses carry manifests, status, records and run results only.
const admin=(u:Member)=>u.role==='admin'||hasAction(u,'connectors','configure');
const configure=(u:Member,c:ConnectorRow)=>c.scope==='user'?c.owner_member_id===u.id:admin(u);
const brief=(c:ConnectorRow)=>({id:c.id,name:c.name,provider:c.provider,scope:c.scope,ownerId:c.owner_member_id||null,status:c.status,health:c.health,paused:!!c.paused,environment:(c as ConnectorRow&{environment?:string}).environment||'production',dailyCallLimit:(c as ConnectorRow&{daily_call_limit?:number}).daily_call_limit||0,lastOkAt:c.last_ok_at,lastSyncAt:c.last_sync_at,nextSyncAt:c.next_sync_at||null,lastError:c.last_error,grantedScopes:(c.granted_scopes||'').split(/\s+/).filter(Boolean),accountIdentity:c.account_identity||'',pages:parseJson<string[]>(c.pages_json,[]),roles:parseJson<string[]>(c.roles_json,[]),policy:policyOf(c)});
export const GET=route(async(req,u)=>{
 const q=new URL(req.url).searchParams;const view=q.get('view')||'';
 if(view==='catalog')return {types:connectorTypes.map(t=>({id:t.id,name:t.name,category:t.category,description:t.description,auth:t.auth,family:t.family||null,manifest:manifestFor(null,t)}))};
 if(view==='pending-actions')return {actions:await pendingActions(u)};
 if(view==='installs'){const rows=await all<{id:string,provider:string,name:string,level:string,reason:string,requested_by:string,status:string,decided_by:string|null,created_at:string,connector_id:string|null}>('SELECT * FROM connector_install_requests WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100',u.tenantId);return {requests:rows.filter(r=>admin(u)||r.requested_by===u.id).map(r=>({id:r.id,provider:r.provider,name:r.name,level:r.level,reason:r.reason,requestedBy:r.requested_by,status:r.status,decidedBy:r.decided_by,connectorId:r.connector_id,createdAt:r.created_at}))}}
 const rows=await all<ConnectorRow>('SELECT * FROM connectors WHERE tenant_id=? ORDER BY name',u.tenantId);const mine=rows.filter(c=>c.scope==='user'?c.owner_member_id===u.id:admin(u)||mayUse(u,c));
 if(view==='installed'||view==='health'){
  const since=new Date(Date.now()-86400000).toISOString();const stats=await all<{connector_id:string,calls:number,errors:number}>("SELECT connector_id,count(*) AS calls,sum(status<>'ok') AS errors FROM connector_logs WHERE tenant_id=? AND created_at>=? GROUP BY connector_id",u.tenantId,since);
  const agents=await all<{id:string,name:string,draft_json:string}>('SELECT id,name,draft_json FROM ai_agents WHERE tenant_id=?',u.tenantId);const apps=await all<{id:string,name:string,draft_json:string}>('SELECT id,name,draft_json FROM studio_apps WHERE tenant_id=?',u.tenantId);
  const out=[];for(const c of mine){const m=await manifest(c).catch(()=>null);const s=stats.find(x=>x.connector_id===c.id);out.push({...brief(c),modes:m?.modes||[],resources:m?.resources.length||0,actions:m?.actions.length||0,calls24h:s?.calls||0,errors24h:s?.errors||0,agents:agents.filter(a=>parseJson<{connectors?:string[]}>(a.draft_json,{}).connectors?.includes(c.id)).map(a=>({id:a.id,name:a.name})),workflows:apps.filter(a=>a.draft_json.includes(c.id)).map(a=>({id:a.id,name:a.name}))})}
  return {connectors:out,canInstall:admin(u)};
 }
 if(view==='syncs')return {syncs:(await all<{connector_id:string,cursor:string,last_full_at:string|null,last_incremental_at:string|null,stats_json:string,updated_at:string}>('SELECT * FROM connector_sync_checkpoints WHERE tenant_id=?',u.tenantId)).filter(s=>mine.some(c=>c.id===s.connector_id)).map(s=>({connectorId:s.connector_id,connector:mine.find(c=>c.id===s.connector_id)?.name,cursor:s.cursor,lastFullAt:s.last_full_at,lastIncrementalAt:s.last_incremental_at,stats:parseJson(s.stats_json,{}),updatedAt:s.updated_at})),queue:(await all("SELECT j.id,j.kind,j.ref_id AS connectorId,j.status,j.attempts,j.last_error AS error,j.run_after AS runAfter FROM jobs j WHERE j.tenant_id=? AND j.kind IN ('connector.fabric-sync','connector.sync') AND j.status IN ('queued','retrying','dead','running') ORDER BY j.updated_at DESC LIMIT 50",u.tenantId))}
 if(view==='logs'){const cid=q.get('id');return {logs:await all(`SELECT l.id,l.connector_id AS connectorId,c.name AS connector,l.action,l.status,l.duration_ms AS ms,l.detail_json AS detail,l.created_at AS createdAt FROM connector_logs l JOIN connectors c ON c.id=l.connector_id AND c.tenant_id=l.tenant_id WHERE l.tenant_id=?${cid?' AND l.connector_id=?':''} ORDER BY l.created_at DESC LIMIT 200`,u.tenantId,...(cid?[cid]:[])).then(r=>r.filter(x=>mine.some(c=>c.id===(x as {connectorId:string}).connectorId)))}}
 if(view==='webhooks')return {webhooks:mine.filter(c=>typeOf(c).id==='webhook').map(c=>({...brief(c),url:`${origin(req)}/api/hooks?id=${c.id}`,hasSecret:!!c.webhook_secret_enc}))};
 const id=q.get('id');if(!id)throw new HttpError(400,'Choose a view.');
 const c=await loadConnector(u.tenantId,idOf(id,'Connector'));if(!mine.some(x=>x.id===c.id))throw new HttpError(404,'Connector not found.');
 if(view==='manifest')return {manifest:await manifest(c),connector:brief(c),checkpoint:await first('SELECT cursor,last_full_at AS lastFullAt,last_incremental_at AS lastIncrementalAt,stats_json AS stats FROM connector_sync_checkpoints WHERE tenant_id=? AND connector_id=?',u.tenantId,c.id)};
 if(view==='records')return {records:await connectorRecordsFor(u,c.id,Math.min(500,Number(q.get('limit'))||100),String(q.get('q')||''))};
 if(view==='actions')return {runs:configure(u,c)?await actionRuns(u.tenantId,c.id):[]};
 if(view==='live'){return federated(u,c.id,str(q.get('resource'),'Resource',100),String(q.get('q')||'').slice(0,200),Math.min(50,Number(q.get('limit'))||20))}
 throw new HttpError(400,'Unknown view.');
},{module:'integrations'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,100000);const action=str(b.action,'Action',32);
 if(action==='request-install'){
  // Anyone who uses connectors may request one; an administrator approves before anything is installed.
  if(!hasAction(u,'connectors','use_connectors')&&!admin(u))throw new HttpError(403,'Connectors are not available to you.');
  const t=connectorTypeById.get(str(b.provider,'Connector type',40));if(!t)throw new HttpError(400,'Choose a connector type.');
  const id=uid();await batch([stmt("INSERT INTO connector_install_requests(id,tenant_id,provider,name,level,config_json,reason,requested_by,status,created_at) VALUES(?,?,?,?,?,'{}',?,?,'pending',?)",id,u.tenantId,t.id,str(b.name||t.name,'Name',80),oneOf(b.level||'company',['company','department','user'] as const,'level'),str(b.reason,'Reason',500),u.id,now()),auditStatement(u,'Connector installation requested',id,'Integrations',null,{provider:t.id})]);
  const admins=(await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin'",u.tenantId)).map(r=>r.id);await notify(u,admins,{kind:'approval',title:`${u.name} asks to install ${t.name}`,body:String(b.reason||''),link:'#/admin/connectors/installs'});return {id};
 }
 if(action==='decide-install'){
  if(!admin(u))throw new HttpError(403,'Only administrators approve connector installations.');
  const r=await first<{id:string,provider:string,name:string,level:string,requested_by:string,status:string}>('SELECT * FROM connector_install_requests WHERE id=? AND tenant_id=?',idOf(b.id,'Request'),u.tenantId);if(!r||r.status!=='pending')throw new HttpError(404,'Request not found.');
  if(b.approve!==true){await batch([stmt("UPDATE connector_install_requests SET status='rejected',decided_by=?,decided_at=? WHERE id=?",u.id,now(),r.id),auditStatement(u,'Connector installation rejected',r.id,'Integrations',null,{note:str(b.note,'Note',300,false)})]);await notify(u,[r.requested_by],{kind:'approval',title:`Your ${r.name} connector request was declined`,link:'#/home/connections'});return {ok:true}}
  const t=connectorTypeById.get(r.provider)!;const cid=uid();
  await batch([stmt("INSERT INTO connectors(id,tenant_id,scope,provider,name,description,auth_type,config_json,secret_enc,secret_hint,webhook_secret_enc,status,pages_json,roles_json,sync_minutes,created_by,created_at,updated_by,updated_at,owner_member_id) VALUES(?,?,?,?,?,'',?,'{}',NULL,'',NULL,?,'[]','[]',0,?,?,?,?,?)",cid,u.tenantId,r.level,t.id,r.name,t.auth,t.auth==='oauth2'?'needs-auth':'configured',u.name,now(),u.name,now(),r.level==='user'?r.requested_by:null),stmt("UPDATE connector_install_requests SET status='approved',decided_by=?,decided_at=?,connector_id=? WHERE id=?",u.id,now(),cid,r.id),auditStatement(u,'Connector installation approved',cid,'Integrations',null,{request:r.id,provider:t.id})]);
  await notify(u,[r.requested_by],{kind:'approval',title:`${r.name} was approved and installed`,body:'Finish its configuration to use it.',link:r.level==='user'?`#/home/connections/${cid}`:`#/admin/connectors/${cid}`});return {connectorId:cid};
 }
 if(action==='confirm-action'||action==='reject-action')return confirmAction(u,idOf(b.runId,'Action'),action==='confirm-action',b.input&&typeof b.input==='object'?b.input as Record<string,unknown>:undefined);
 const c=await loadConnector(u.tenantId,idOf(b.id,'Connector'));
 switch(action){
  case 'sync':{if(!configure(u,c))throw new HttpError(403,'You cannot synchronise this connector.');await batch([queueSync(u.tenantId,c.id,b.full===true),auditStatement(u,b.full===true?'Full resynchronization requested':'Synchronization requested',c.id,'Integrations',null,null)]);kick(3);return {queued:true}}
  case 'action':{if(!mayUse(u,c))throw new HttpError(403,'This connector is not available to you.');return executeAction(u.tenantId,{connectorId:c.id,action:str(b.connectorAction,'Action',80),input:(b.input&&typeof b.input==='object'?b.input:{}) as Record<string,unknown>,origin:'user',requestedBy:u.id,idempotencyKey:str(b.idempotencyKey||uid(),'Idempotency key',100)})}
  case 'policy':{if(!configure(u,c))throw new HttpError(403,'You cannot change this connector.');const m=await manifest(c);const list=(x:unknown)=>Array.isArray(x)?x.map(String).slice(0,50):[];
   const agents=list(b.allowAgents);for(const a of agents)if(!await first('SELECT id FROM ai_agents WHERE id=? AND tenant_id=?',a,u.tenantId))throw new HttpError(400,'An agent does not exist.');
   const policy={allowAgents:agents,autoConfirm:list(b.autoConfirm).filter(a=>m.actions.some(x=>x.id===a&&x.risk!=='high')),allowAutomations:b.allowAutomations!==false,cacheSeconds:0};
   await batch([stmt('UPDATE connectors SET policy_json=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(policy),u.name,now(),c.id,u.tenantId),auditStatement(u,'Connector policy changed',c.id,'Integrations',policyOf(c),policy)]);return {ok:true,policy};
  }
  case 'environment':{if(!configure(u,c))throw new HttpError(403,'You cannot change this connector.');const envv=oneOf(b.environment||'production',['production','test'] as const,'environment');const lim=Math.max(0,Math.min(1000000,Math.round(Number(b.dailyCallLimit)||0)));await batch([stmt('UPDATE connectors SET environment=?,daily_call_limit=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',envv,lim,u.name,now(),c.id,u.tenantId),auditStatement(u,'Connector environment and limits changed',c.id,'Integrations',null,{environment:envv,dailyCallLimit:lim})]);return {ok:true}}
  case 'resources':{if(!configure(u,c))throw new HttpError(403,'You cannot change this connector.');
   // Generic REST connectors declare their synced/federated resources and their actions (paths relative to the base URL).
   const res=(Array.isArray(b.resources)?b.resources:[]).slice(0,20).map((r:any)=>({id:str(r.id,'Resource id',40).toLowerCase().replace(/[^a-z0-9_-]/g,'_'),label:str(r.label,'Resource name',80),path:str(r.path,'Path',200),idField:str(r.idField,'Id field',60,false)||undefined,titleField:str(r.titleField,'Title field',60,false)||undefined,updatedField:str(r.updatedField,'Updated field',60,false)||undefined,urlField:str(r.urlField,'URL field',60,false)||undefined,listField:str(r.listField,'List field',60,false)||undefined}));
   const acts=(Array.isArray(b.actions)?b.actions:[]).slice(0,20).map((a:any)=>({id:str(a.id,'Action id',40).toLowerCase().replace(/[^a-z0-9_-]/g,'_'),label:str(a.label,'Action name',80),method:oneOf(String(a.method||'POST').toUpperCase(),['POST','PUT','PATCH'] as const,'method'),path:str(a.path,'Path',200),risk:oneOf(a.risk||'high',['low','medium','high'] as const,'risk'),fields:Array.isArray(a.fields)?a.fields.map((x:unknown)=>str(x,'Field',60)).slice(0,20):[]}));
   for(const p of [...res.map((r:{path:string})=>r.path),...acts.map((a:{path:string})=>a.path)])if(!/^\/[\w\-./?=&%,:]*$/.test(p)||p.includes('..'))throw new HttpError(400,`“${p}” is not a valid relative path.`);
   const cfg={...configOf(c),resources:JSON.stringify(res),actions:JSON.stringify(acts)};await batch([stmt('UPDATE connectors SET config_json=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(cfg),u.name,now(),c.id,u.tenantId),auditStatement(u,'Connector resources and actions changed',c.id,'Integrations',null,{resources:res.length,actions:acts.length})]);return {ok:true};
  }
  case 'link-record':{
   // Connect a synced external record to a One Workspace record (lineage kept on the external node).
   if(!mayUse(u,c))throw new HttpError(403,'This connector is not available to you.');const rec=await first<{id:string,source_id:string,title:string}>('SELECT id,source_id,title FROM connector_records WHERE id=? AND tenant_id=? AND connector_id=? AND deleted_at IS NULL',idOf(b.recordId,'External record'),u.tenantId,c.id);if(!rec)throw new HttpError(404,'External record not found.');
   const {findNode,addRelationship,syncNode}=await import('../../../server/graph');const target=await findNode(u,str(b.entityType,'Record type',40),idOf(b.entityId,'Record'));await syncNode(u.tenantId,'external',rec.id);const ext=await findNode(u,'external',rec.id);
   await batch([stmt('INSERT INTO connector_links(id,tenant_id,connector_id,external_type,external_id,entity_type,entity_id,title,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,c.id,'record',rec.source_id,target.type,target.source_id,rec.title.slice(0,300),u.id,now())]);
   await addRelationship(u,ext,target,oneOf(b.relationship||'related_to',['related_to','attached_to','decided_in','mentioned_in','resulted_in'] as const,'relationship'),'connector',{meta:{connector:c.id}});return {ok:true};
  }
 }
 void run;throw new HttpError(400,'Unknown action.');
},{module:'integrations'});
