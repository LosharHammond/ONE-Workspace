import {TRIGGERS,ACTIONS,type Automation,type Cond,type WfAction,type ApprovalStage,type Approver,type AppDef} from '../studio-def';
import {resolveAi,chatJson,usageStatement,assertAiQuota,AiError} from './ai';
import {HttpError,uid,all} from './core';
import type {Member} from './policy';

// Natural language → an editable, DISABLED draft automation. Nothing is saved or activated here: the caller
// stores it in an app draft, and only a person can test and publish it.
const OPS=['eq','neq','gt','gte','lt','lte','contains','empty','notEmpty','in'];
const KINDS=['person','role','group','department_head','department','manager'];
function cleanApprover(a:unknown):Approver|null{const o=(a&&typeof a==='object'?a:{}) as Record<string,unknown>;const kind=String(o.kind||'');if(!KINDS.includes(kind))return null;return {kind:kind as Approver['kind'],value:o.value?String(o.value).slice(0,120):undefined}}
export function sanitizeAutomation(raw:unknown,known:{departments:string[],roles:string[]}):{automation:Automation,warnings:string[]}{
 const r=(raw&&typeof raw==='object'?raw:{}) as Record<string,any>;const warnings:string[]=[];
 const tt=String(r.trigger?.type||'');if(!(TRIGGERS as readonly string[]).includes(tt))throw new HttpError(422,'The description did not map to a supported trigger. Try naming the event (e.g. “when a purchase request is submitted”).');
 const trigger={type:tt,...(r.trigger?.module?{module:String(r.trigger.module)}:{}),...(r.trigger?.table?{table:String(r.trigger.table)}:{}),...(r.trigger?.schedule&&['hourly','daily','weekly'].includes(r.trigger.schedule)?{schedule:r.trigger.schedule}:{}),...(r.trigger?.percent?{percent:Number(r.trigger.percent)}:{})} as Automation['trigger'];
 const conditions:Cond[]=(Array.isArray(r.conditions)?r.conditions:[]).slice(0,10).filter((c:any)=>c&&typeof c.field==='string'&&OPS.includes(c.op)).map((c:any)=>({field:c.field.slice(0,60),op:c.op,value:c.value}));
 const actions:WfAction[]=[];
 for(const a of (Array.isArray(r.actions)?r.actions:[]).slice(0,10)){
  if(!(ACTIONS as readonly string[]).includes(a?.type)){warnings.push(`Skipped an unsupported step (${String(a?.type||'unknown')}).`);continue}
  if(a.type==='request_approval'){const stages:ApprovalStage[]=(Array.isArray(a.stages)?a.stages:[]).slice(0,6).map((s:any,i:number)=>({name:String(s.name||`Stage ${i+1}`).slice(0,80),mode:['any','all','quorum'].includes(s.mode)?s.mode:'all',quorum:s.quorum?Number(s.quorum):undefined,approvers:(Array.isArray(s.approvers)?s.approvers:[]).map(cleanApprover).filter(Boolean),when:s.when&&OPS.includes(s.when.op)?{field:String(s.when.field),op:s.when.op,value:s.when.value}:undefined}));
   for(const st of stages)for(const ap of st.approvers)if(ap.kind==='department'&&ap.value&&!known.departments.some(d=>d.toLowerCase()===ap.value!.toLowerCase()))warnings.push(`The department “${ap.value}” does not exist yet; create it or change the approver.`);
   actions.push({type:'request_approval',title:String(a.title||'{{title}}').slice(0,200),stages});continue}
  if(a.type==='notify'){actions.push({type:'notify',to:(Array.isArray(a.to)?a.to:[]).map(cleanApprover).filter(Boolean),title:String(a.title||'Update: {{title}}').slice(0,200),body:String(a.body||'').slice(0,1000)});continue}
  if(a.type==='create_task'){actions.push({type:'create_task',title:String(a.title||'Follow up: {{title}}').slice(0,200),assignTo:cleanApprover(a.assignTo)||undefined,dueInDays:a.dueInDays!==undefined?Number(a.dueInDays):undefined});continue}
  if(a.type==='post_message'){actions.push({type:'post_message',channel:a.channel==='department'?'department':'company',text:String(a.text||'{{title}}').slice(0,1000)});continue}
  warnings.push(`“${a.type}” needs details that must be completed in the builder.`);actions.push({type:a.type});
 }
 if(!actions.length)throw new HttpError(422,'The description did not include any action to take.');
 return {automation:{id:`ai_${uid().slice(0,8)}`,name:String(r.name||'AI-drafted automation').slice(0,100),trigger,conditions,actions,enabled:false,generatedBy:'ai',explanation:String(r.explanation||'').slice(0,2000)},warnings};
}
// The draft's shape in words, as a simple ordered diagram.
export function diagram(a:Automation){
 const steps:string[]=[`When: ${a.trigger.type.replace(/_/g,' ')}${a.trigger.module?` (${a.trigger.module})`:''}`];
 if(a.conditions.length)steps.push(`If: ${a.conditions.map(c=>`${c.field} ${c.op} ${c.value??''}`).join(' and ')}`);
 for(const x of a.actions){if(x.type==='request_approval')for(const s of (x.stages as ApprovalStage[]))steps.push(`Approval: ${s.name} (${s.mode}) by ${s.approvers.map(p=>p.kind+(p.value?` ${p.value}`:'')).join(', ')}`);else if(x.type==='notify')steps.push(`Notify: ${((x.to as Approver[])||[]).map(p=>p.kind+(p.value?` ${p.value}`:'')).join(', ')}`);else steps.push(`Then: ${x.type.replace(/_/g,' ')}`)}
 return steps;
}
export function requiredPermissions(a:Automation){const out=new Set<string>(['Workspace Studio: publish']);if(['purchase_submitted','approval_completed'].includes(a.trigger.type))out.add('Purchasing data is read by the automation (as the workflow identity)');for(const x of a.actions){if(x.type==='connector_action')out.add('Connector action policy for the chosen connector');if(x.type==='run_agent')out.add('An active AI agent with a service identity');if(x.type==='create_task')out.add('Tasks module enabled')}return [...out]}
export async function generateAutomation(u:Member,text:string,def?:AppDef){
 const p=await resolveAi(u.tenantId);if(!p)throw new AiError(503,'AI is not configured for this workspace.','not_configured');await assertAiQuota(u.tenantId);
 const departments=(await all<{name:string}>('SELECT name FROM departments WHERE tenant_id=?',u.tenantId)).map(d=>d.name);const roles=(await all<{name:string,id:string}>('SELECT id,name FROM roles WHERE tenant_id=?',u.tenantId));
 const schema=`{"name":string,"trigger":{"type":one of ${JSON.stringify(TRIGGERS)},"module"?:"PR"|"PO"|"ticket"|"asset"|"task"|"project"|"file","table"?:string,"schedule"?:"hourly"|"daily"|"weekly","percent"?:number},"conditions":[{"field":string,"op":one of ${JSON.stringify(OPS)},"value":any}],"actions":[{"type":"request_approval","title":string,"stages":[{"name":string,"mode":"any"|"all"|"quorum","approvers":[{"kind":"department_head"|"department"|"manager"|"role"|"group"|"person","value"?:string}]}]} | {"type":"notify","to":[approver],"title":string,"body":string} | {"type":"create_task","title":string,"assignTo":approver,"dueInDays":number} | {"type":"post_message","channel":"company"|"department","text":string}],"explanation":string}`;
 const sys=`You convert a company administrator's description into ONE automation for a no-code workflow engine. Reply with JSON only, matching: ${schema}. Rules: purchase requests use trigger purchase_submitted and the amount field is "amount" (the request total). "Department head" means approver kind department_head (the requester's department). A named department (e.g. Finance, Procurement) is kind "department" with that name as value. When several parties must all approve, use one request_approval action with one stage per party (sequential) unless the description says in parallel. A step that happens "after approval" or "when both approve" goes in a SEPARATE automation; for this one, describe it in the explanation and add it as a notify action only if it can run right after approval stages are requested. Known departments: ${departments.join(', ')||'none'}. Known roles: ${roles.map(r=>r.name).join(', ')||'none'}.${def?` Tables in this app: ${def.tables.map(t=>`${t.key} (${t.fields.map(f=>f.key).join(', ')})`).join('; ')}.`:''} Never invent people's names.`;
 const {data,usage}=await chatJson<Record<string,unknown>>(p,[{role:'system',content:sys},{role:'user',content:text.slice(0,2000)}],1500);
 await usageStatement(u,p,'studio.nl-automation',usage).run();
 const first=sanitizeAutomation(data,{departments,roles:roles.map(r=>r.name)});
 // "…then notify X when both approve" becomes a second draft triggered by that approval completing.
 const then=/(then|after|once|when)[^.]*\b(approve|approval|approved)\b[^.]*\b(notify|inform|tell|email)\b\s+([A-Za-z &]+)/i.exec(text);
 const drafts=[first.automation];
 if(then&&first.automation.actions.some(a=>a.type==='request_approval')){const target=then[4].trim().replace(/\s+(when|after|once).*$/i,'').replace(/[.,]$/,'');const dep=departments.find(d=>d.toLowerCase()===target.toLowerCase());
  drafts.push({id:`ai_${uid().slice(0,8)}`,name:`Notify ${target} after approval`,trigger:{type:'approval_completed',automationId:first.automation.id,toStatus:'approved'},conditions:[],actions:[{type:'notify',to:[dep?{kind:'department',value:dep}:{kind:'role',value:target}],title:'Approved: {{title}}',body:'All approval stages are complete.'}],enabled:false,generatedBy:'ai',explanation:`Runs when every approval stage of “${first.automation.name}” is complete, then notifies ${target}.`})}
 return {drafts:drafts.map(d=>({automation:d,diagram:diagram(d),permissions:requiredPermissions(d)})),warnings:first.warnings,note:'These are disabled drafts. Review, test (dry run) and publish them yourself; AI never activates automations.'};
}
