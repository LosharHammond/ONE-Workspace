import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,oneOf,auditStatement,parseJson,tenantOf,tenantSettings,run} from '../../server/core';
import {TEMPLATES,TOOLS,toolCatalog,defaultDef,startRun,decideAction,pendingAgentApprovals,evaluate,agentVersion,killSwitch,type AgentDef,type AgentRow} from '../../server/agents';
import {enqueueStatement,kick} from '../../server/jobs';
import {resolveAi,companyAiRow,platformAi} from '../../server/ai';
import {pageActions} from '../../access-policy';
import type {Member} from '../../server/policy';

// AI workforce and the AI Control Tower. Builders (administrators or agents.configure) manage agents; staff
// see and run the agents published to them, on the pages the agents are assigned to.
const builder=(u:Member)=>u.role==='admin'||hasAction(u,'agents','configure');
function cleanDef(v:unknown,base:AgentDef=defaultDef()):AgentDef{
 const o=(v&&typeof v==='object'?v:{}) as Record<string,any>;const list=(x:unknown,max=40)=>Array.isArray(x)?[...new Set(x.map(y=>String(y).slice(0,80)))].slice(0,max):undefined;
 const pages=(list(o.pages)||list(o.allowedPages)||base.pages).filter(p=>p in pageActions);
 const tools=(list(o.tools)||base.tools).filter(t=>TOOLS.some(x=>x.id===t));
 const d:AgentDef={...base,purpose:String(o.purpose??base.purpose).slice(0,500),instructions:String(o.instructions??base.instructions).slice(0,8000),pages,recordScope:['own','department','all'].includes(o.recordScope)?o.recordScope:base.recordScope,serviceDepartment:o.serviceDepartment!==undefined?String(o.serviceDepartment).slice(0,160):base.serviceDepartment,
  runAs:o.runAs==='service'?'service':o.runAs==='requester'?'requester':base.runAs,tools,connectors:list(o.connectors)||base.connectors,knowledge:{...base.knowledge,...(o.knowledge||{})},provider:'default',model:o.model?String(o.model).slice(0,100):base.model,temperature:Math.max(0,Math.min(1,Number(o.temperature??base.temperature)||0)),maxSteps:Math.max(1,Math.min(10,Math.round(Number(o.maxSteps??base.maxSteps)||6))),
  tokenBudget:Math.max(0,Math.round(Number(o.tokenBudget??base.tokenBudget)||0)),costBudgetMicros:Math.max(0,Math.round(Number(o.costBudgetMicros??base.costBudgetMicros)||0)),schedule:['none','daily','weekly'].includes(o.schedule)?o.schedule:base.schedule,scheduledPrompt:o.scheduledPrompt!==undefined?String(o.scheduledPrompt).slice(0,1000):base.scheduledPrompt,
  triggers:Array.isArray(o.triggers)?o.triggers.slice(0,10).map((t:any)=>({module:t.module?String(t.module).slice(0,30):undefined,action:t.action?String(t.action).slice(0,80):undefined,prompt:String(t.prompt||'').slice(0,1000)})):base.triggers,extraApprovals:(list(o.extraApprovals)||base.extraApprovals).filter(t=>TOOLS.some(x=>x.id===t)),retentionDays:Math.max(1,Math.min(3650,Math.round(Number(o.retentionDays??base.retentionDays)||90))),roles:list(o.roles)||base.roles};
 if(o.visibility==='private')d.roles=['__owner__'];else if(o.visibility==='workspace'&&d.roles.includes('__owner__'))d.roles=[];
 return d;
}
const summary=(a:AgentRow,d?:AgentDef|null)=>({id:a.id,name:a.name,description:a.description,template:a.template,ownerId:a.owner_id,status:a.status,killed:!!a.killed,publishedVersion:a.published_version,draftVersion:a.draft_version,createdBy:a.created_by,createdAt:a.created_at,updatedAt:a.updated_at,updatedBy:a.updated_by,pages:d?.pages||[],runAs:d?.runAs,tools:d?.tools||[]});
// People may use a published agent when its role list allows them (a private agent: only its owner).
const mayUse=(u:Member,a:AgentRow,d:AgentDef|null)=>!!d&&a.status!=='disabled'&&(builder(u)||(d.roles.includes('__owner__')?a.owner_id===u.id:!d.roles.length||d.roles.includes(u.role)||d.roles.includes(u.roleId||'')))&&hasAction(u,'agents','view');
async function load(u:Member,id:string){const a=await first<AgentRow>('SELECT * FROM ai_agents WHERE id=? AND tenant_id=?',id,u.tenantId);if(!a)throw new HttpError(404,'Agent not found.');return a}
const draftOf=(a:AgentRow)=>({...defaultDef(),...parseJson<Partial<AgentDef>>(a.draft_json,{})}) as AgentDef;

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'agents','view'))throw new HttpError(403,'The AI workforce is not available to you.');
 const q=new URL(req.url).searchParams;const view=q.get('view');
 if(view==='templates')return {templates:TEMPLATES};
 if(view==='tools')return {tools:toolCatalog()};
 if(view==='approvals')return {approvals:await pendingAgentApprovals(u)};
 // Agents available on a page (for the page-embedded agent panel).
 if(q.get('page')!==null){const page=String(q.get('page'));const rows=await all<AgentRow>("SELECT * FROM ai_agents WHERE tenant_id=? AND status='active' AND killed=0 AND published_version IS NOT NULL ORDER BY name",u.tenantId);const out=[];for(const a of rows){const d=await agentVersion(u.tenantId,a);if(mayUse(u,a,d)&&(!page||!d!.pages.length||d!.pages.includes(page)))out.push({...summary(a,d),purpose:d!.purpose})}return {agents:out,killSwitch:await killSwitch(u.tenantId)}}
 if(view==='tower'){
  if(!builder(u))throw new HttpError(403,'Only administrators see the AI Control Tower.');
  const since=new Date(Date.now()-30*86400000).toISOString();
  const [agents,byStatus,totals,tools,violations,evals,usage]=await Promise.all([
   all<{status:string,killed:number,n:number}>('SELECT status,killed,count(*) AS n FROM ai_agents WHERE tenant_id=? GROUP BY status,killed',u.tenantId),
   all<{status:string,n:number}>('SELECT status,count(*) AS n FROM ai_agent_runs WHERE tenant_id=? AND started_at>=? GROUP BY status',u.tenantId,since),
   first<{runs:number,tokens:number,cost:number,avg_ms:number}>('SELECT count(*) AS runs,coalesce(sum(prompt_tokens+completion_tokens),0) AS tokens,coalesce(sum(cost_micros),0) AS cost,coalesce(avg(duration_ms),0) AS avg_ms FROM ai_agent_runs WHERE tenant_id=? AND started_at>=?',u.tenantId,since),
   all<{tool:string,status:string,n:number}>('SELECT tool,status,count(*) AS n FROM ai_tool_calls WHERE tenant_id=? AND created_at>=? GROUP BY tool,status ORDER BY n DESC LIMIT 60',u.tenantId,since),
   all("SELECT a.after_json AS detail,a.record_id AS runId,a.created_at AS createdAt FROM audit a WHERE a.tenant_id=? AND a.action='AI policy violation blocked' ORDER BY a.created_at DESC LIMIT 50",u.tenantId),
   all("SELECT e.agent_id AS agentId,e.agent_version AS version,e.passed,e.critical_failed AS criticalFailed,e.created_at AS createdAt,g.name FROM ai_eval_runs e JOIN ai_agents g ON g.id=e.agent_id AND g.tenant_id=e.tenant_id WHERE e.tenant_id=? ORDER BY e.created_at DESC LIMIT 30",u.tenantId),
   all("SELECT provider,model,count(*) AS requests,sum(prompt_tokens+completion_tokens) AS tokens,sum(1-ok) AS failures FROM ai_usage WHERE tenant_id=? AND created_at>=? GROUP BY provider,model",u.tenantId,since),
  ]);
  const p=await resolveAi(u.tenantId);const lastFail=await first<{created_at:string}>('SELECT created_at FROM ai_usage WHERE tenant_id=? AND ok=0 ORDER BY created_at DESC LIMIT 1',u.tenantId);const lastOk=await first<{created_at:string}>('SELECT created_at FROM ai_usage WHERE tenant_id=? AND ok=1 ORDER BY created_at DESC LIMIT 1',u.tenantId);
  const done=byStatus.filter(s=>['succeeded','failed','killed','waiting_approval'].includes(s.status)).reduce((n,s)=>n+s.n,0);const failed=byStatus.filter(s=>s.status==='failed').reduce((n,s)=>n+s.n,0);
  const t=await tenantOf(u);const s=tenantSettings(t);
  return {agents,runsByStatus:byStatus,totals:{...totals,successRate:done?Math.round((done-failed)/done*100):null,failureRate:done?Math.round(failed/done*100):null},tools,violations,evals,usage,provider:p?{name:p.name,model:p.model,source:p.source,lastSuccess:lastOk?.created_at||null,lastFailure:lastFail?.created_at||null,company:!!(await companyAiRow(u.tenantId)),platformDefault:!!(await platformAi())}:null,killSwitch:!!s.aiKillSwitch,prices:s.aiPrices||{},pending:(await pendingAgentApprovals(u)).length};
 }
 if(view==='runs'||q.get('run')){
  const runId=q.get('run');
  if(runId){const r=await first<Record<string,unknown>&{requested_by:string,agent_id:string}>('SELECT r.*,a.name FROM ai_agent_runs r JOIN ai_agents a ON a.id=r.agent_id AND a.tenant_id=r.tenant_id WHERE r.id=? AND r.tenant_id=?',idOf(runId,'Run'),u.tenantId);if(!r||(!builder(u)&&r.requested_by!==u.id))throw new HttpError(404,'Run not found.');return {run:{...r,citations:parseJson(String(r.citations_json||'[]'),[])},tools:await all('SELECT step,tool,input_json AS input,output_summary AS output,status,duration_ms AS ms,created_at AS createdAt FROM ai_tool_calls WHERE tenant_id=? AND run_id=? ORDER BY step,created_at',u.tenantId,r.id),approvals:await all('SELECT id,tool,target,effect,risk,status,decided_by AS decidedBy,decided_at AS decidedAt,result_json AS result FROM ai_action_approvals WHERE tenant_id=? AND run_id=?',u.tenantId,r.id)}}
  const agent=q.get('agent');return {runs:await all(`SELECT r.id,r.agent_id AS agentId,a.name,r.agent_version AS version,r.run_as AS runAs,r.requested_by AS requestedBy,r.trigger,r.status,r.steps,r.prompt_tokens+r.completion_tokens AS tokens,r.cost_micros AS cost,r.duration_ms AS ms,r.error,r.started_at AS startedAt FROM ai_agent_runs r JOIN ai_agents a ON a.id=r.agent_id AND a.tenant_id=r.tenant_id WHERE r.tenant_id=?${agent?' AND r.agent_id=?':''}${builder(u)?'':' AND r.requested_by=?'} ORDER BY r.started_at DESC LIMIT 200`,u.tenantId,...(agent?[agent]:[]),...(builder(u)?[]:[u.id]))};
 }
 const id=q.get('id');
 if(id){const a=await load(u,idOf(id,'Agent'));const d=await agentVersion(u.tenantId,a);if(!builder(u)&&!mayUse(u,a,d))throw new HttpError(404,'Agent not found.');
  if(!builder(u))return {agent:{...summary(a,d),purpose:d?.purpose},definition:null,canManage:false};
  return {agent:summary(a,d),definition:draftOf(a),published:d,versions:await all('SELECT version,eval_status AS evalStatus,created_by AS createdBy,created_at AS createdAt FROM ai_agent_versions WHERE tenant_id=? AND agent_id=? ORDER BY version DESC',u.tenantId,a.id),evals:(await all<{id:string,agent_version:number,results_json:string,passed:number,critical_failed:number,created_at:string}>('SELECT * FROM ai_eval_runs WHERE tenant_id=? AND agent_id=? ORDER BY created_at DESC LIMIT 10',u.tenantId,a.id)).map(e=>({id:e.id,version:e.agent_version,results:JSON.parse(e.results_json),passed:e.passed,criticalFailed:e.critical_failed,createdAt:e.created_at})),canManage:true}}
 const rows=await all<AgentRow>('SELECT * FROM ai_agents WHERE tenant_id=? ORDER BY name',u.tenantId);const out=[];
 for(const a of rows){const d=await agentVersion(u.tenantId,a);if(builder(u)||mayUse(u,a,d))out.push(summary(a,d))}
 return {agents:out,canManage:builder(u),killSwitch:await killSwitch(u.tenantId)};
},{module:'agents'});

export const POST=route(async(req,u)=>{
 if(!hasAction(u,'agents','view'))throw new HttpError(403,'The AI workforce is not available to you.');
 const b=await readBody(req,100000);const action=str(b.action,'Action',32);
 if(action==='run'){
  // Runs as the requester (or the agent's service identity); refused when a kill switch is on.
  const a=await load(u,idOf(b.id,'Agent'));const d=await agentVersion(u.tenantId,a);if(!mayUse(u,a,d))throw new HttpError(404,'Agent not found.');
  if(!hasAction(u,'agents','run'))throw new HttpError(403,'Running agents is not part of your role.');
  if(a.killed||a.status!=='active'||await killSwitch(u.tenantId))throw new HttpError(409,a.killed?'This agent’s kill switch is on.':a.status!=='active'?`This agent is ${a.status}.`:'The company-wide AI kill switch is on.');
  const record=b.record&&typeof b.record==='object'?{type:str((b.record as Record<string,unknown>).type,'Record type',40),id:idOf((b.record as Record<string,unknown>).id,'Record')}:undefined;
  const r=await startRun(u.tenantId,a.id,{prompt:str(b.input??b.prompt,'Request',4000),trigger:b.page?'page':'manual',page:b.page?str(b.page,'Page',40):undefined,record,requestedBy:u.id,requester:u});
  const row=await first<{status:string,output_text:string,error:string,citations_json:string,agent_version:number,steps:number}>('SELECT status,output_text,error,citations_json,agent_version,steps FROM ai_agent_runs WHERE id=?',r.id);
  if(row?.status==='blocked')throw new HttpError(409,row.error);
  return {runId:r.id,status:row?.status,output:row?.output_text||'',error:row?.error||'',citations:parseJson(row?.citations_json,[]),version:row?.agent_version,steps:row?.steps,approvals:await all('SELECT id,tool,target,effect,risk,status FROM ai_action_approvals WHERE tenant_id=? AND run_id=?',u.tenantId,r.id)};
 }
 if(action==='approve'||action==='reject'){return decideAction(u,idOf(b.approvalId,'Approval'),action==='approve',b.edited&&typeof b.edited==='object'?b.edited as Record<string,unknown>:undefined,str(b.note,'Note',500,false))}
 if(!builder(u))throw new HttpError(403,'Only administrators manage agents.');
 if(action==='kill-switch'){const t=await tenantOf(u);const s=tenantSettings(t);const on=b.on===true;await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...s,aiKillSwitch:on}),u.tenantId),auditStatement(u,on?'Company-wide AI kill switch turned ON':'Company-wide AI kill switch turned off',u.tenantId,'AI',{on:!!s.aiKillSwitch},{on})]);if(on)await run("UPDATE ai_agent_runs SET status='killed',error='Stopped by the company-wide kill switch.',finished_at=? WHERE tenant_id=? AND status IN ('queued','running')",now(),u.tenantId);return {ok:true,on}}
 if(action==='prices'){const t=await tenantOf(u);const s=tenantSettings(t);const prices=Object.fromEntries(Object.entries((b.prices&&typeof b.prices==='object'?b.prices:{}) as Record<string,{prompt:number,completion:number}>).slice(0,20).map(([m,p])=>[m.slice(0,100),{prompt:Math.max(0,Number(p.prompt)||0),completion:Math.max(0,Number(p.completion)||0)}]));await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...s,aiPrices:prices}),u.tenantId),auditStatement(u,'AI prices changed',u.tenantId,'AI',null,{models:Object.keys(prices)})]);return {ok:true}}
 if(action==='create'){
  const tpl=b.template?TEMPLATES.find(t=>t.id===b.template):null;const def=cleanDef(b.definition,{...defaultDef(),...(tpl?.def||{})});const id=uid(),ts=now();
  await batch([stmt("INSERT INTO ai_agents(id,tenant_id,name,description,template,owner_id,status,killed,published_version,draft_json,draft_version,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,'draft',0,NULL,?,1,?,?,?,?)",id,u.tenantId,str(b.name||tpl?.name,'Name',100),str(b.description??tpl?.description,'Description',500,false),tpl?.id||'custom',u.id,JSON.stringify(def),u.id,ts,u.id,ts),auditStatement(u,'AI agent created',id,'AI',null,{template:tpl?.id||'custom',tools:def.tools,runAs:def.runAs})]);return {id};
 }
 if(action==='retry-run'){const r=await first<{id:string,agent_id:string,status:string,input_text:string,requested_by:string,trigger:string}>('SELECT * FROM ai_agent_runs WHERE id=? AND tenant_id=?',idOf(b.runId,'Run'),u.tenantId);if(!r||r.status!=='failed')throw new HttpError(409,'Only failed runs can be retried.');const n=await startRun(u.tenantId,r.agent_id,{prompt:r.input_text,trigger:'manual',requestedBy:u.id,requester:u});await auditStatement(u,'Agent run retried',r.agent_id,'AI',null,{from:r.id,to:n.id}).run();return n}
 const a=await load(u,idOf(b.id,'Agent'));
 switch(action){
  case 'save':{const def=cleanDef(b.definition,draftOf(a));await batch([stmt('UPDATE ai_agents SET name=?,description=?,draft_json=?,draft_version=draft_version+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',str(b.name??a.name,'Name',100),str(b.description??a.description,'Description',500,false),JSON.stringify(def),u.id,now(),a.id,u.tenantId),auditStatement(u,'AI agent draft saved',a.id,'AI',null,{tools:def.tools,pages:def.pages,runAs:def.runAs})]);return {ok:true}}
  case 'evaluate':{const def=draftOf(a);return evaluate(u,a,a.draft_version,def)}
  case 'publish':case 'rollback':{
   let def=draftOf(a);if(action==='rollback'){const v=await first<{definition_json:string}>('SELECT definition_json FROM ai_agent_versions WHERE tenant_id=? AND agent_id=? AND version=?',u.tenantId,a.id,Number(b.version));if(!v)throw new HttpError(404,'Version not found.');def={...defaultDef(),...parseJson<Partial<AgentDef>>(v.definition_json,{})}}
   // Critical security evaluations must pass before any version goes live.
   const ev=await evaluate(u,a,a.draft_version,def);if(ev.criticalFailed)throw new HttpError(409,JSON.stringify({message:'Critical evaluations failed; the agent was not published.',results:ev.results.filter(r=>r.critical&&r.status==='failed')}));
   const cur=await first<{v:number}>('SELECT max(version) AS v FROM ai_agent_versions WHERE tenant_id=? AND agent_id=?',u.tenantId,a.id);const version=(cur?.v||0)+1;
   await batch([stmt("INSERT INTO ai_agent_versions(id,tenant_id,agent_id,version,definition_json,eval_status,eval_run_id,created_by,created_at) VALUES(?,?,?,?,?,'passed',?,?,?)",uid(),u.tenantId,a.id,version,JSON.stringify(def),ev.id,u.id,now()),stmt("UPDATE ai_agents SET published_version=?,status=CASE WHEN status='draft' THEN 'active' ELSE status END,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?",version,u.id,now(),a.id,u.tenantId),auditStatement(u,action==='rollback'?`AI agent rolled back (version ${version})`:`AI agent published (version ${version})`,a.id,'AI',{version:a.published_version},{version,tools:def.tools,runAs:def.runAs}),enqueueStatement(u.tenantId,'agents.schedule',u.tenantId,{},{key:`agents-schedule:${now().slice(0,13)}`})]);kick(2);
   return {ok:true,version,evaluation:{passed:ev.passed,criticalFailed:ev.criticalFailed}};
  }
  case 'pause':case 'resume':case 'disable':{const status=action==='pause'?'paused':action==='disable'?'disabled':'active';await batch([stmt('UPDATE ai_agents SET status=?,killed=CASE WHEN ?=\'active\' THEN 0 ELSE killed END,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',status,status,u.id,now(),a.id,u.tenantId),auditStatement(u,`AI agent ${status}`,a.id,'AI',{status:a.status},{status})]);return {ok:true}}
  case 'kill':{await batch([stmt('UPDATE ai_agents SET killed=1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',u.id,now(),a.id,u.tenantId),stmt("UPDATE ai_agent_runs SET status='killed',error='Stopped by the kill switch.',finished_at=? WHERE tenant_id=? AND agent_id=? AND status IN ('queued','running')",now(),u.tenantId,a.id),auditStatement(u,'AI agent kill switch ON',a.id,'AI',null,null)]);return {ok:true}}
  case 'restrict-tools':{const def=draftOf(a);const remove=new Set((Array.isArray(b.tools)?b.tools:[]).map(String));def.tools=def.tools.filter(t=>!remove.has(t));await batch([stmt('UPDATE ai_agents SET draft_json=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(def),now(),a.id,u.tenantId),auditStatement(u,'AI agent tools restricted (publish to apply)',a.id,'AI',null,{removed:[...remove]})]);return {ok:true}}
  case 'revoke-connector':{const cid=idOf(b.connectorId,'Connector');const def=draftOf(a);def.connectors=def.connectors.filter(c=>c!==cid);await batch([stmt('UPDATE ai_agents SET draft_json=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(def),now(),a.id,u.tenantId),stmt("UPDATE connectors SET policy_json=json_set(coalesce(policy_json,'{}'),'$.allowAgents',(SELECT json_group_array(value) FROM json_each(coalesce(json_extract(policy_json,'$.allowAgents'),'[]')) WHERE value<>?)) WHERE id=? AND tenant_id=?",a.id,cid,u.tenantId),auditStatement(u,'Connector access revoked from AI agent',a.id,'AI',null,{connector:cid})]);return {ok:true}}
  case 'budget':{const def=draftOf(a);def.tokenBudget=Math.max(0,Math.round(Number(b.tokenBudget??def.tokenBudget)));def.costBudgetMicros=Math.max(0,Math.round(Number(b.costBudgetMicros??def.costBudgetMicros)));await batch([stmt('UPDATE ai_agents SET draft_json=?,draft_version=draft_version+1,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(def),now(),a.id,u.tenantId),auditStatement(u,'AI agent budget changed (publish to apply)',a.id,'AI',null,{tokens:def.tokenBudget,cost:def.costBudgetMicros})]);return {ok:true}}
  case 'set-owner':{const owner=idOf(b.ownerId,'Owner');if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',owner,u.tenantId))throw new HttpError(400,'Choose an active person.');await batch([stmt('UPDATE ai_agents SET owner_id=? WHERE id=? AND tenant_id=?',owner,a.id,u.tenantId),auditStatement(u,'AI agent owner changed',a.id,'AI',{owner:a.owner_id},{owner})]);return {ok:true}}
 }
 void oneOf;throw new HttpError(400,'Unknown action.');
},{module:'agents'});
