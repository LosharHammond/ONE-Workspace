// Workspace Studio metadata, shared by the browser (builders) and the server (validation, runtime).
// An application is JSON only: tables, fields, forms, workflows, automations, reports, navigation and
// permissions. Nothing here is executable code: formulas are parsed by a small arithmetic evaluator and
// conditions are data. The server validates every definition before it is saved or published.

export const FIELD_TYPES=['text','richtext','number','currency','percent','date','datetime','email','phone','address','select','multiselect','checkbox','radio','person','department','location','group','role','file','signature','rating','lookup','formula','autonumber','relationship','repeating'] as const;
export type FieldType=typeof FIELD_TYPES[number];
export const FIELD_LABELS:Record<FieldType,string>={text:'Text',richtext:'Rich text',number:'Number',currency:'Currency',percent:'Percentage',date:'Date',datetime:'Date and time',email:'Email',phone:'Phone',address:'Address',select:'Select',multiselect:'Multi-select',checkbox:'Checkbox',radio:'Radio',person:'Person',department:'Department',location:'Location',group:'Group',role:'Role',file:'File upload',signature:'Signature',rating:'Rating',lookup:'Lookup (app table)',formula:'Formula',autonumber:'Auto-number',relationship:'Relationship (record)',repeating:'Repeating section / subform'};
export const RELATION_TYPES=['project','task','ticket','asset','PR','PO','vendor','person','file','studio_record'] as const;
export type Cond={field:string,op:'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'empty'|'notEmpty'|'in',value?:unknown};
export type StudioField={key:string,label:string,type:FieldType,required?:boolean,help?:string,options?:string[],default?:unknown,min?:number,max?:number,pattern?:string,unique?:boolean,formula?:string,lookupTable?:string,relation?:string,prefix?:string,currency?:string,showIf?:Cond,readRoles?:string[],writeRoles?:string[],subfields?:StudioField[]};
export type Perms={view:string[],create:string[],edit:string[],delete:string[],scope:'all'|'department'|'own'};
export type StudioTable={key:string,name:string,fields:StudioField[],titleField:string,statuses?:string[],numbering?:{prefix:string},permissions:Perms,retentionDays?:number,audit?:boolean,workflow?:string,searchFields?:string[]};
export type StudioForm={key:string,name:string,table:string,sections:{title:string,fields:string[]}[],submitLabel?:string,allowDraft?:boolean,startTransition?:string,roles?:string[]};
export type Approver={kind:'person'|'role'|'group'|'department_head'|'department'|'manager',value?:string};
export type ApprovalStage={name:string,mode:'any'|'all'|'quorum',quorum?:number,approvers:Approver[],when?:Cond,escalateAfterHours?:number,escalateTo?:Approver};
export const ACTIONS=['notify','create_record','update_record','set_status','create_task','post_message','connector_action','run_agent','request_approval','add_relationship'] as const;
export type WfAction={type:typeof ACTIONS[number],[k:string]:unknown};
export type WfState={id:string,name:string,kind:'start'|'normal'|'end'};
export type WfTransition={id:string,from:string,to:string,label:string,roles?:string[],condition?:Cond,requiredFields?:string[],approval?:{stages:ApprovalStage[]},actions?:WfAction[],timerHours?:number,branch?:'default'|'else'};
export type StudioWorkflow={key:string,name:string,table:string,states:WfState[],transitions:WfTransition[]};
export const TRIGGERS=['record_created','record_updated','status_changed','approval_completed','purchase_submitted','module_event','file_uploaded','schedule','date_reached','task_overdue','budget_threshold','inventory_below_min','maintenance_due','webhook_received','connector_event','ai_classification_completed','relationship_created'] as const;
export type Trigger={type:typeof TRIGGERS[number],table?:string,toStatus?:string,module?:string,action?:string,schedule?:'hourly'|'daily'|'weekly',field?:string,percent?:number,connectorId?:string,automationId?:string};
export type Automation={id:string,name:string,trigger:Trigger,conditions:Cond[],actions:WfAction[],enabled:boolean,generatedBy?:'ai'|'human',explanation?:string};
export const CHARTS=['table','kpi','bar','line','area','pie','donut','funnel','timeline','calendar','pivot','map'] as const;
export type StudioReport={key:string,name:string,source:{kind:'module'|'table'|'graph'|'connector',id:string},groupBy?:string,column?:string,measure:{op:'count'|'sum'|'avg',field?:string},chart:typeof CHARTS[number],filters?:Cond[],dateField?:string,exportRoles?:string[],roles?:string[],schedule?:{frequency:'daily'|'weekly',recipients:Approver[]}};
export type AppDef={tables:StudioTable[],forms:StudioForm[],workflows:StudioWorkflow[],automations:Automation[],reports:StudioReport[],pages:{id:string,title:string}[],nav:{label:string,kind:'table'|'form'|'report'|'page',ref:string}[],permissions:{use:string[],admin:string[]},settings:{requiresApproval?:boolean}};
export const emptyApp=():AppDef=>({tables:[],forms:[],workflows:[],automations:[],reports:[],pages:[],nav:[],permissions:{use:[],admin:[]},settings:{}});

// ── Formulas: numbers, fields, + - * / ( ), and round/min/max/abs/if. No code execution. ──
export function evalFormula(expr:string,data:Record<string,unknown>):number|string|null{
 const src=String(expr||'');let i=0;
 const ws=()=>{while(/\s/.test(src[i]||''))i++};
 const num=(v:unknown)=>{const n=typeof v==='number'?v:Number(v);return Number.isFinite(n)?n:0};
 function primary():number|string{ws();const c=src[i];
  if(c==='('){i++;const v=expr0();ws();if(src[i]!==')')throw new Error('Missing )');i++;return v}
  if(c==='-'){i++;return -num(primary())}
  if(c==='"'){const j=src.indexOf('"',i+1);if(j<0)throw new Error('Unclosed text');const s=src.slice(i+1,j);i=j+1;return s}
  const m=/^[0-9]+(\.[0-9]+)?/.exec(src.slice(i));if(m){i+=m[0].length;return Number(m[0])}
  const id=/^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));if(!id)throw new Error(`Unexpected “${c||'end'}”`);i+=id[0].length;ws();
  if(src[i]==='('){i++;const args:(number|string)[]=[];ws();if(src[i]!==')'){for(;;){args.push(expr0());ws();if(src[i]===','){i++;continue}break}}if(src[i]!==')')throw new Error('Missing )');i++;
   const f=id[0].toLowerCase();if(f==='round')return Math.round(num(args[0])*10**num(args[1]??0))/10**num(args[1]??0);if(f==='min')return Math.min(...args.map(num));if(f==='max')return Math.max(...args.map(num));if(f==='abs')return Math.abs(num(args[0]));if(f==='if')return num(args[0])?args[1]:args[2];if(f==='concat')return args.map(String).join('');throw new Error(`Unknown function ${id[0]}`)}
  const v=data[id[0]];return typeof v==='number'||typeof v==='string'?v:num(v)}
 function term():number|string{let v=primary();for(;;){ws();const c=src[i];if(c==='*'||c==='/'){i++;const r=primary();v=c==='*'?num(v)*num(r):num(r)===0?0:num(v)/num(r)}else return v}}
 function expr0():number|string{let v=term();for(;;){ws();const c=src[i];if(c==='+'||c==='-'){i++;const r=term();v=c==='+'&&(typeof v==='string'||typeof r==='string')?String(v)+String(r):c==='+'?num(v)+num(r):num(v)-num(r)}else if(c==='>'||c==='<'||(c==='='&&src[i+1]==='=')){const op=src.slice(i,i+2).replace(/[^<>=]/g,'');i+=op.length===2&&['>=','<=','=='].includes(op)?2:1;const r=expr0();const o=op.length===2&&['>=','<=','=='].includes(op)?op:c;v=Number(o==='>'?num(v)>num(r):o==='<'?num(v)<num(r):o==='>='?num(v)>=num(r):o==='<='?num(v)<=num(r):String(v)===String(r))}else return v}}
 if(!src.trim())return null;
 const v=expr0();ws();if(i<src.length)throw new Error(`Unexpected “${src[i]}”`);return v;
}
export function formulaFields(expr:string){return [...new Set((String(expr).replace(/"[^"]*"/g,'').match(/[A-Za-z_][A-Za-z0-9_]*/g)||[]).filter(x=>!['round','min','max','abs','if','concat'].includes(x.toLowerCase())))]}
export function test(c:Cond|undefined,data:Record<string,unknown>):boolean{
 if(!c||!c.field)return true;const v=data[c.field];const n=(x:unknown)=>Number(x);
 switch(c.op){case 'eq':return String(v??'')===String(c.value??'');case 'neq':return String(v??'')!==String(c.value??'');case 'gt':return n(v)>n(c.value);case 'gte':return n(v)>=n(c.value);case 'lt':return n(v)<n(c.value);case 'lte':return n(v)<=n(c.value);case 'contains':return String(Array.isArray(v)?v.join(','):v??'').toLowerCase().includes(String(c.value??'').toLowerCase());case 'empty':return v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);case 'notEmpty':return !(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length));case 'in':return String(c.value||'').split(',').map(x=>x.trim()).includes(String(v??''))}
 return false;
}

// ── Workflow validation (shown live in the builder and enforced when publishing) ──
export type Issue={level:'error'|'warning',where:string,message:string};
export function validateWorkflow(w:StudioWorkflow,table?:StudioTable,known?:{connectors?:string[],agents?:string[]}):Issue[]{
 const out:Issue[]=[];const where=`Workflow “${w.name||w.key}”`;const ids=new Set(w.states.map(s=>s.id));
 if(!w.states.length){out.push({level:'error',where,message:'Add at least a start and an end state.'});return out}
 const starts=w.states.filter(s=>s.kind==='start'),ends=w.states.filter(s=>s.kind==='end');
 if(starts.length!==1)out.push({level:'error',where,message:'There must be exactly one start state.'});
 if(!ends.length)out.push({level:'error',where,message:'Missing an end state.'});
 if(ids.size!==w.states.length)out.push({level:'error',where,message:'State ids must be unique.'});
 for(const t of w.transitions){
  const tw=`${where} · “${t.label||t.id}”`;
  if(!ids.has(t.from)||!ids.has(t.to))out.push({level:'error',where:tw,message:'Goes from or to a state that no longer exists.'});
  if(w.states.find(s=>s.id===t.from)?.kind==='end')out.push({level:'error',where:tw,message:'An end state cannot have outgoing transitions.'});
  for(const st of t.approval?.stages||[]){if(!st.approvers?.length)out.push({level:'error',where:tw,message:`Approval stage “${st.name}” has no approvers.`});if(st.mode==='quorum'&&!(Number(st.quorum)>0))out.push({level:'error',where:tw,message:`Approval stage “${st.name}” needs a quorum.`});for(const a of st.approvers||[])if(['person','role','group','department'].includes(a.kind)&&!a.value)out.push({level:'error',where:tw,message:`An approver in “${st.name}” is incomplete.`})}
  const fields=new Set((table?.fields||[]).map(f=>f.key));
  if(table){for(const f of [...(t.requiredFields||[]),...(t.condition?[t.condition.field]:[]),...((t.approval?.stages||[]).flatMap(s=>s.when?[s.when.field]:[]))])if(f&&!fields.has(f))out.push({level:'error',where:tw,message:`Uses the field “${f}”, which no longer exists.`})}
  for(const a of t.actions||[]){if(a.type==='connector_action'&&known?.connectors&&!known.connectors.includes(String(a.connectorId)))out.push({level:'error',where:tw,message:'Refers to a connector that is not installed.'});if(a.type==='run_agent'&&known?.agents&&!known.agents.includes(String(a.agentId)))out.push({level:'error',where:tw,message:'Refers to an AI agent that does not exist.'})}
 }
 // Reachability from the start state.
 const start=starts[0];if(start){const seen=new Set([start.id]);const q=[start.id];while(q.length){const s=q.shift()!;for(const t of w.transitions)if(t.from===s&&!seen.has(t.to)){seen.add(t.to);q.push(t.to)}}for(const s of w.states)if(!seen.has(s.id))out.push({level:'error',where,message:`State “${s.name}” can never be reached.`})}
 // Loops with no way out: states from which no end state is reachable.
 const canEnd=new Set(ends.map(e=>e.id));let grew=true;while(grew){grew=false;for(const t of w.transitions)if(canEnd.has(t.to)&&!canEnd.has(t.from)){canEnd.add(t.from);grew=true}}
 for(const s of w.states)if(s.kind!=='end'&&!canEnd.has(s.id))out.push({level:'error',where,message:`From “${s.name}” the record can never finish (an endless loop or dead end).`});
 for(const s of w.states)if(s.kind==='normal'&&!w.transitions.some(t=>t.from===s.id))out.push({level:'warning',where,message:`“${s.name}” has no way forward.`});
 return out;
}
export function validateApp(def:AppDef,known?:{connectors?:string[],agents?:string[]}):Issue[]{
 const out:Issue[]=[];const tables=new Map(def.tables.map(t=>[t.key,t]));
 const keyRe=/^[a-z][a-z0-9_]{0,39}$/;
 const dup=(list:{key:string}[],what:string)=>{const s=new Set<string>();for(const x of list){if(!keyRe.test(x.key))out.push({level:'error',where:what,message:`“${x.key}” is not a valid key (lowercase letters, numbers and _).`});if(s.has(x.key))out.push({level:'error',where:what,message:`The key “${x.key}” is used twice.`});s.add(x.key)}};
 dup(def.tables,'Tables');dup(def.forms,'Forms');dup(def.workflows,'Workflows');dup(def.reports,'Reports');
 for(const t of def.tables){const where=`Table “${t.name}”`;dup(t.fields,where);if(!t.fields.length)out.push({level:'error',where,message:'Add at least one field.'});if(!t.fields.some(f=>f.key===t.titleField))out.push({level:'error',where,message:'Choose which field is the record title.'});
  for(const f of t.fields){if(!(FIELD_TYPES as readonly string[]).includes(f.type))out.push({level:'error',where,message:`Unknown field type “${f.type}”.`});
   if(['select','multiselect','radio'].includes(f.type)&&!f.options?.length)out.push({level:'error',where,message:`“${f.label}” needs options.`});
   if(f.type==='lookup'&&!tables.has(String(f.lookupTable)))out.push({level:'error',where,message:`“${f.label}” looks up a table that does not exist.`});
   if(f.type==='relationship'&&!(RELATION_TYPES as readonly string[]).includes(String(f.relation)))out.push({level:'error',where,message:`“${f.label}” needs a record type.`});
   if(f.type==='formula'){try{evalFormula(f.formula||'',{});for(const x of formulaFields(f.formula||''))if(!t.fields.some(y=>y.key===x))out.push({level:'error',where,message:`Formula “${f.label}” uses unknown field “${x}”.`})}catch(e){out.push({level:'error',where,message:`Formula “${f.label}”: ${(e as Error).message}`})}}
   if(f.showIf&&!t.fields.some(y=>y.key===f.showIf!.field))out.push({level:'error',where,message:`“${f.label}” depends on a field that no longer exists.`});
   if(f.pattern){try{new RegExp(f.pattern)}catch{out.push({level:'error',where,message:`“${f.label}” has an invalid pattern.`})}}}
  if(t.workflow&&!def.workflows.some(w=>w.key===t.workflow))out.push({level:'error',where,message:'Uses a workflow that does not exist.'});
 }
 for(const f of def.forms){const t=tables.get(f.table);const where=`Form “${f.name}”`;if(!t){out.push({level:'error',where,message:'Its table no longer exists.'});continue}for(const k of f.sections.flatMap(s=>s.fields))if(!t.fields.some(x=>x.key===k))out.push({level:'error',where,message:`Shows the field “${k}”, which no longer exists.`});for(const r of t.fields.filter(x=>x.required&&x.type!=='formula'&&x.type!=='autonumber'))if(!f.sections.some(s=>s.fields.includes(r.key))&&r.default===undefined)out.push({level:'warning',where,message:`Required field “${r.label}” is not on the form.`})}
 for(const w of def.workflows){const t=tables.get(w.table);if(!t)out.push({level:'error',where:`Workflow “${w.name}”`,message:'Its table no longer exists.'});out.push(...validateWorkflow(w,t,known))}
 for(const a of def.automations){const where=`Automation “${a.name}”`;if(!(TRIGGERS as readonly string[]).includes(a.trigger?.type))out.push({level:'error',where,message:'Choose a trigger.'});if(a.trigger?.table&&!tables.has(a.trigger.table))out.push({level:'error',where,message:'Its table no longer exists.'});if(!a.actions?.length)out.push({level:'error',where,message:'Add at least one action.'});
  for(const x of a.actions||[]){if(x.type==='connector_action'&&known?.connectors&&!known.connectors.includes(String(x.connectorId)))out.push({level:'error',where,message:'Refers to a connector that is not installed.'});if(x.type==='run_agent'&&known?.agents&&!known.agents.includes(String(x.agentId)))out.push({level:'error',where,message:'Refers to an AI agent that does not exist.'});if(x.type==='request_approval'&&!(x.stages as ApprovalStage[]|undefined)?.length)out.push({level:'error',where,message:'An approval action needs at least one stage.'});if(x.type==='create_record'&&!tables.has(String(x.table)))out.push({level:'error',where,message:'Creates records in a table that does not exist.'})}}
 for(const r of def.reports){if(r.source.kind==='table'&&!tables.has(r.source.id))out.push({level:'error',where:`Report “${r.name}”`,message:'Its table no longer exists.'})}
 return out;
}
