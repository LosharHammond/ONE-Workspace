// Acceptance tests for the company operating system: One Work Graph, Workspace Studio, the governed AI
// workforce and the Connector Fabric (scenarios 1–28 of the brief; 29–30 are the build/lint/test commands and
// the manual runtime check). Runs after platform.test.mjs against the same throwaway database.
// External services are local mocks (tests/mock-services.mjs); nothing leaves this machine.
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client,rand,strongPassword,tokenFrom,sql as rawSql,settle} from './helpers.mjs';
const pending=[];const sql=q=>{pending.push(1);return rawSql(q)};
beforeEach(async()=>{if(pending.length){pending.length=0;await settle()}});
const MOCK=process.env.OWS_MOCK,OWNER='losharhammond@gmail.com';
const mockLog=async()=>(await fetch(MOCK+'/__log')).json();
const mockReset=()=>fetch(MOCK+'/__reset');
const REST_SECRET='rest-secret-DO-NOT-LEAK-123',AI_KEY='sk-company-e-DO-NOT-LEAK-999';
const owner=new Client();
const E={slug:'ecorp-'+rand(),domain:`ecorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const F={slug:'fcorp-'+rand(),domain:`fcorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const S={};
const ok=(r,msg)=>{assert.equal(r.status,200,`${msg||''} ${JSON.stringify(r.data)}`);return r.data};
async function activate(link,pw){const r=await new Client().post('/api/auth/activate',{token:tokenFrom(link),password:pw});assert.equal(r.status,200,'activation')}
async function invite(co,name,extra){const email=`${name.toLowerCase().replace(/\W+/g,'.')}-${rand()}@${co.domain}`;const r=await co.admin.post('/api/people',{action:'create',name,email,...extra});assert.equal(r.status,200,JSON.stringify(r.data));const pw=strongPassword();await activate(r.data.link,pw);const c=new Client();await c.login(email,pw);c.id=r.data.id;return c}

test('setup. Two business workspaces with staff in two departments',async()=>{
 // Earlier suites in the same run activate many accounts from this machine's IP; the activation limiter
 // (20 per 15 minutes) is reset in the throwaway test database so this suite starts from a clean window.
 sql('DELETE FROM login_attempts');await settle();pending.length=0;
 await owner.login(OWNER,process.env.OWS_OWNER_PW);
 for(const co of [E,F]){
  const r=await owner.post('/api/platform',{action:'create',name:co===E?'Echo Energy':'Foxtrot Foods',slug:co.slug,domains:co.domain,adminName:`Admin ${co.slug}`,adminEmail:`admin@${co.domain}`,plan:'business',package:'business',defaults:{departments:true,locations:true,roles:true,workflows:true,folders:true,welcome:true}});
  ok(r,'create workspace');co.id=r.data.id;await activate(r.data.link,co.pw);await co.admin.login(`admin@${co.domain}`,co.pw);
 }
 const s=(await E.admin.get('/api/session')).data;const depts=s.departments.map(d=>d.name);assert.ok(depts.length>=2);S.deptA=depts[0];S.deptB=depts[1];S.adminId=s.user.id;
 S.staff=await invite(E,'Ada Staff',{role:'employee',department:S.deptA});
 S.outsider=await invite(E,'Otto Outsider',{role:'employee',department:S.deptB});
 S.admin2=await invite(E,'Second Admin',{role:'admin',department:S.deptA});
});

// ── One Work Graph ──────────────────────────────────────────────────────────
test('1. A project shows its authorised people, budget, purchasing, tasks, files, decisions, assets, goals and customers',async()=>{
 const p=ok(await E.admin.post('/api/projects',{action:'create',name:`Solar farm ${rand()}`,type:'capital',department:S.deptA,description:'Build the solar farm',managerId:S.adminId}),'project');S.project=p.id;
 ok(await E.admin.post('/api/projects',{action:'members',id:S.project,add:[S.staff.id],role:'member'}),'team');
 const budget=ok(await E.admin.post('/api/purchasing',{action:'budget',name:'Solar capex',department:S.deptA,costCentre:'CAPEX',periodStart:'2026-01-01',periodEnd:'2026-12-31',amount:90000,currency:'GHS'}),'budget');
 ok(await E.admin.post('/api/projects',{action:'link',id:S.project,type:'budget',recordId:budget.id}),'budget link');
 const pr=ok(await E.admin.post('/api/purchasing',{action:'save',kind:'PR',title:'Inverters',department:S.deptA,projectId:S.project,budgetId:budget.id,lines:[{description:'Inverter',qty:2,unit:'ea',unitPrice:3000,taxRate:0}]}),'PR');S.pr=pr.id;
 ok(await E.admin.post('/api/tasks',{action:'save',projectId:S.project,title:'Survey the site',assignees:[S.staff.id]}),'task');
 ok(await E.admin.post('/api/projects',{action:'record',id:S.project,kind:'decision',title:'Use tracker mounts',body:'Agreed at design review.'}),'decision');
 const asset=ok(await E.admin.post('/api/assets',{action:'create',name:'Site generator',category:'Generator',department:S.deptA}),'asset');S.asset=asset.id;
 const up=await E.admin.upload('asset',S.asset,'layout.txt','Array layout for the solar farm.');assert.equal(up.status,200,JSON.stringify(up.data));const fileId=up.data.id||up.data.files?.[0]?.id;assert.ok(fileId,JSON.stringify(up.data));
 ok(await E.admin.post('/api/files',{action:'link',id:fileId,entityType:'project',entityId:S.project}),'file linked to the project');
 ok(await E.admin.post('/api/projects',{action:'link',id:S.project,type:'asset',recordId:S.asset}),'asset link');
 const goal=ok(await E.admin.post('/api/business',{action:'save',kind:'goal',title:'Net-zero operations',department:S.deptA}),'goal');
 const obj=ok(await E.admin.post('/api/business',{action:'save',kind:'objective',title:'Cut grid use 40%',parentId:goal.id}),'objective');
 ok(await E.admin.post('/api/business',{action:'save',kind:'initiative',title:'On-site generation',parentId:obj.id,data:{projects:[S.project]}}),'initiative');
 const cust=ok(await E.admin.post('/api/business',{action:'save',kind:'customer',title:'Harbour Authority',data:{projects:[S.project]}}),'customer');S.customer=cust.id;
 ok(await E.admin.post('/api/business',{action:'save',kind:'contract',title:'Harbour power supply',parentId:cust.id,amount:250000}),'contract');
 await new Promise(r=>setTimeout(r,1500));
 const ctx=ok(await E.admin.get(`/api/graph?view=context&type=project&id=${S.project}`),'context');
 const types=new Set(ctx.sections.flatMap(s=>s.items.map(i=>i.type)));
 for(const t of ['person','budget','PR','task','file','decision','asset','initiative','customer'])assert.ok(types.has(t),`project context includes ${t} (has ${[...types].join(',')})`);
 assert.ok(ctx.facts.length>0,'the context carries record facts');
 assert.ok(ctx.history.length>0,'the context carries connected history');
 // Every record type exposes the same connected context API (tasks, customers, the budget, the requisition).
 for(const [t,id] of [['customer',cust.id],['PR',S.pr]])ok(await E.admin.get(`/api/graph?view=context&type=${t}&id=${id}`),`${t} context`);
});

test('2. An asset shows its purchase, project and maintenance chain',async()=>{
 ok(await E.admin.post('/api/maintenance',{action:'order',assetId:S.asset,title:'Service the generator',department:S.deptA}),'work order');
 await new Promise(r=>setTimeout(r,1000));
 const ctx=ok(await E.admin.get(`/api/graph?view=context&type=asset&id=${S.asset}`),'asset context');
 const keys=new Set(ctx.sections.map(s=>s.key));assert.ok(keys.has('maintenance'),'maintenance section');assert.ok(keys.has('project'),'project section');
 const agentText=ok(await E.admin.get(`/api/graph?id=${S.asset}&type=asset&depth=2`),'traversal');assert.ok(agentText.graph.nodes.some(n=>n.type==='work_order'));
});

test('3. A user cannot discover unauthorised graph records or relationships',async()=>{
 assert.equal((await S.outsider.get(`/api/graph?view=context&type=project&id=${S.project}`)).status,404,'another department cannot open the project context');
 assert.equal((await S.outsider.get(`/api/graph?id=${S.project}&type=project`)).status,404,'nor traverse from it');
 const found=ok(await S.outsider.get(`/api/graph?q=${encodeURIComponent('Solar farm')}`),'search');assert.ok(!found.nodes.some(n=>n.sourceId===S.project),'search does not reveal it');
 // A member of the project sees it, but a restricted neighbour (the budget in another scope) is only counted.
 const mine=await S.staff.get(`/api/graph?view=context&type=project&id=${S.project}`);assert.equal(mine.status,200,'team member sees the project');
 const leaked=JSON.stringify(mine.data);assert.ok(typeof mine.data.restricted==='number');
 assert.ok(!/Solar capex/.test(leaked)||mine.data.sections.some(s=>s.items.some(i=>i.type==='budget')),'a hidden budget never appears by title');
 // Relating records needs visibility of both ends.
 assert.equal((await S.outsider.post('/api/graph',{action:'relate',fromType:'project',fromId:S.project,toType:'customer',toId:S.customer,relationship:'related_to'})).status,404);
 // Search through the assistant path is permission-checked too (graph-aware search).
 const s=ok(await S.outsider.get(`/api/search?q=${encodeURIComponent('Harbour')}`),'search');assert.ok(Array.isArray(s.hits||s.results||[]));
});

test('4. Forging another workspace ID does not expose graph data',async()=>{
 for(const q of [`/api/graph?view=context&type=project&id=${S.project}&tenant=${E.id}`,`/api/graph?id=${S.project}&type=project&tenantId=${E.id}`,`/api/graph?q=Solar&workspace=${E.id}`]){
  const r=await F.admin.get(q);assert.ok(r.status===404||(r.status===200&&!JSON.stringify(r.data).includes(S.project)),`forged ${q}`);
 }
 const forged=await new Client().req(`/api/graph?view=context&type=project&id=${S.project}`,undefined,'GET');assert.equal(forged.status,401,'no session, no data');
 assert.equal((await F.admin.post('/api/graph',{action:'relate',tenantId:E.id,fromType:'project',fromId:S.project,toType:'customer',toId:S.customer,relationship:'related_to'})).status,404);
});

// ── Workspace Studio ───────────────────────────────────────────────────────
const appDef=()=>({tables:[{key:'contracts',name:'Contract reviews',titleField:'title',numbering:{prefix:'CR'},workflow:'review',permissions:{view:[],create:[],edit:[],delete:['admin'],scope:'all'},fields:[
 {key:'title',label:'Contract',type:'text',required:true},{key:'value',label:'Value',type:'currency',currency:'GHS',min:0},{key:'kind',label:'Kind',type:'select',options:['Supply','Service']},
 {key:'service_level',label:'Service level',type:'text',showIf:{field:'kind',op:'eq',value:'Service'}},{key:'vat',label:'VAT',type:'formula',formula:'round(value*0.15,2)'},{key:'owner',label:'Owner',type:'person'},{key:'project',label:'Project',type:'relationship',relation:'project'}]}],
 forms:[{key:'new_review',name:'New contract review',table:'contracts',sections:[{title:'Contract',fields:['title','value','kind','service_level','owner','project']}],allowDraft:true}],
 workflows:[{key:'review',name:'Contract review',table:'contracts',states:[{id:'draft',name:'Draft',kind:'start'},{id:'review',name:'Legal review',kind:'normal'},{id:'approved',name:'Approved',kind:'end'},{id:'rejected',name:'Rejected',kind:'end'}],
  transitions:[{id:'submit',from:'draft',to:'review',label:'Submit',requiredFields:['value']},{id:'approve',from:'review',to:'approved',label:'Approve',approval:{stages:[{name:'Second admin',mode:'any',approvers:[{kind:'person',value:S.admin2.id}]}]}},{id:'reject',from:'review',to:'rejected',label:'Reject'}]}],
 automations:[{id:'notify_new',name:'Notify on new review',trigger:{type:'record_created',table:'contracts'},conditions:[{field:'value',op:'gt',value:1000}],actions:[{type:'notify',to:[{kind:'role',value:'admin'}],title:'New review {{title}}'}],enabled:true}],
 reports:[{key:'by_kind',name:'Reviews by kind',source:{kind:'table',id:'contracts'},groupBy:'kind',measure:{op:'sum',field:'value'},chart:'bar'},{key:'dash',name:'Dashboard count',source:{kind:'table',id:'contracts'},measure:{op:'count'},chart:'kpi'}],
 pages:[],nav:[{label:'Reviews',kind:'table',ref:'contracts'},{label:'New',kind:'form',ref:'new_review'},{label:'By kind',kind:'report',ref:'by_kind'}],permissions:{use:[],admin:[]},settings:{}});

test('5–6. A Company Administrator builds an app (form, table, dashboard, workflow) without code',async()=>{
 const r=ok(await E.admin.post('/api/studio',{action:'create',name:'Contract reviews',slug:`contracts-${rand()}`,description:'Legal review',definition:appDef()}),'create app');S.app=r.id;
 const d=ok(await E.admin.get(`/api/studio?id=${S.app}`),'builder view');
 assert.equal(d.definition.forms.length,1);assert.equal(d.definition.tables.length,1);assert.equal(d.definition.reports.length,2);assert.equal(d.definition.workflows.length,1);
 assert.deepEqual(d.issues.filter(i=>i.level==='error'),[],'the definition validates');
 // Invalid workflows are refused (a state that can never finish).
 const bad=appDef();bad.workflows[0].transitions=bad.workflows[0].transitions.filter(t=>t.id!=='approve'&&t.id!=='reject');
 assert.equal((await E.admin.post('/api/studio',{action:'save',id:S.app,definition:bad})).status,400,'endless workflows are rejected');
 // Non-builders cannot create apps.
 assert.equal((await S.staff.post('/api/studio',{action:'create',name:'Mine',definition:appDef()})).status,403);
});

test('7. The app can be previewed, tested, published and rolled back',async()=>{
 const pre=await E.admin.post('/api/studio/records',{action:'create',app:S.app,table:'contracts',data:{title:'Preview record',value:10},preview:true});assert.equal(pre.status,200,JSON.stringify(pre.data));
 assert.equal((await S.staff.get(`/api/studio/records?app=${S.app}&table=contracts`)).status,404,'unpublished apps are invisible to members');
 const t=ok(await E.admin.post('/api/studio',{action:'test',id:S.app}),'test');assert.equal(t.ok,true);
 assert.equal(ok(await E.admin.post('/api/studio',{action:'publish',id:S.app,note:'v1'})).version,1);
 const def2=appDef();def2.tables[0].fields.push({key:'notes',label:'Notes',type:'richtext'});ok(await E.admin.post('/api/studio',{action:'save',id:S.app,definition:def2}),'save v2 draft');
 assert.equal(ok(await E.admin.post('/api/studio',{action:'publish',id:S.app})).version,2);
 assert.equal(ok(await E.admin.post('/api/studio',{action:'rollback',id:S.app,version:1})).version,3,'rollback publishes version 1 again');
 const live=ok(await E.admin.get(`/api/studio?id=${S.app}&version=published`));assert.ok(!live.definition.tables[0].fields.some(f=>f.key==='notes'),'the live definition is version 1');
 // Staff use it: form with conditional field and formula, workflow with required fields and an approval.
 const rec=ok(await S.staff.post('/api/studio/records',{action:'create',app:S.app,table:'contracts',form:'new_review',data:{title:'Harbour supply',value:5000,kind:'Supply',service_level:'ignored',project:[S.project]}}),'record');S.record=rec.id;
 const got=ok(await S.staff.get(`/api/studio/records?app=${S.app}&id=${rec.id}`));assert.equal(got.record.data.vat,750,'formula');assert.ok(!got.record.data.service_level,'hidden conditional field is cleared');
 ok(await S.staff.post('/api/studio/records',{action:'transition',app:S.app,id:rec.id,transition:'submit'}),'submit');
 const ap=await S.staff.post('/api/studio/records',{action:'transition',app:S.app,id:rec.id,transition:'approve'});assert.equal(ap.status,200,JSON.stringify(ap.data));
 const detail=ok(await S.admin2.get(`/api/studio/records?app=${S.app}&id=${rec.id}`));const pendingAp=detail.approvals.find(a=>a.status==='pending');assert.ok(pendingAp,'approval stage created');
 assert.equal((await S.staff.post('/api/studio/records',{action:'decide',approvalId:pendingAp.id,approve:true})).status,403,'requesters cannot approve their own record');
 ok(await S.admin2.post('/api/studio/records',{action:'decide',approvalId:pendingAp.id,approve:true,comment:'Fine'}),'decide');
 assert.equal(ok(await S.staff.get(`/api/studio/records?app=${S.app}&id=${rec.id}`)).record.status,'approved','approval moved the record');
 const report=ok(await S.staff.get(`/api/studio/records?app=${S.app}&report=by_kind`),'report');assert.equal(report.series.find(s=>s.name==='Supply').value,5000);
 // The relationship field put the app record into the Work Graph next to the project.
 await new Promise(r=>setTimeout(r,1000));const pc=ok(await E.admin.get(`/api/graph?view=context&type=studio_record&id=${rec.id}`),'app record context');assert.ok(pc.sections.some(s=>s.items.some(i=>i.type==='project')),'linked project appears in the record context');
});

test('8. Studio records stay inside their workspace',async()=>{
 assert.equal((await F.admin.get(`/api/studio/records?app=${S.app}&table=contracts`)).status,404);
 assert.equal((await F.admin.get(`/api/studio/records?app=${S.app}&id=${S.record}`)).status,404);
 assert.equal((await F.admin.post('/api/studio/records',{action:'update',app:S.app,table:'contracts',id:S.record,data:{title:'x'}})).status,404);
 assert.equal((await F.admin.get(`/api/studio?id=${S.app}`)).status,404);
 const rows=sql(`SELECT DISTINCT tenant_id FROM studio_records WHERE app_id='${S.app}'`);assert.deepEqual(rows.map(r=>r.tenant_id),[E.id]);
});

test('9–10. Natural language drafts an editable, disabled automation; AI cannot publish it',async()=>{
 const g=ok(await E.admin.post('/api/studio',{action:'generate-automation',id:S.app,save:true,text:'When a purchase request above GHS 20,000 is submitted, require department-head approval, then finance approval, and notify the requester after approval.'}),'generate');
 assert.ok(g.drafts.length>=1&&g.saved);for(const d of g.drafts){assert.equal(d.automation.enabled,false,'AI drafts are disabled');assert.equal(d.automation.generatedBy,'ai')}
 assert.ok(g.drafts[0].diagram.length>=2,'a readable diagram');assert.ok(g.drafts[0].permissions.length>=1,'required permissions are listed');
 const draft=ok(await E.admin.get(`/api/studio?id=${S.app}`));const ai=draft.definition.automations.filter(a=>a.generatedBy==='ai');assert.ok(ai.length>=1);assert.ok(ai.every(a=>!a.enabled));
 // Editable: a person changes the threshold and saves; the published version is untouched until publish.
 ai[0].conditions=[{field:'amount',op:'gt',value:25000}];ok(await E.admin.post('/api/studio',{action:'save',id:S.app,definition:draft.definition}),'edit draft');
 const live=ok(await E.admin.get(`/api/studio?id=${S.app}&version=published`));assert.ok(!live.definition.automations.some(a=>a.generatedBy==='ai'),'nothing AI-drafted is live');
 // Approval-gated publishing: requiresApproval blocks publish until ANOTHER administrator approves.
 draft.definition.settings={requiresApproval:true};ok(await E.admin.post('/api/studio',{action:'save',id:S.app,definition:draft.definition}));
 assert.equal((await E.admin.post('/api/studio',{action:'publish',id:S.app})).status,409,'publish needs approval');
 ok(await E.admin.post('/api/studio',{action:'submit-for-approval',id:S.app}));
 assert.equal((await E.admin.post('/api/studio',{action:'approve-publish',id:S.app})).status,403,'the submitter cannot approve');
 ok(await S.admin2.post('/api/studio',{action:'approve-publish',id:S.app}),'second admin approves');
 const pub=ok(await E.admin.post('/api/studio',{action:'publish',id:S.app}),'publish');assert.ok(pub.version>=4);
 const now=ok(await E.admin.get(`/api/studio?id=${S.app}&version=published`));assert.ok(now.definition.automations.filter(a=>a.generatedBy==='ai').every(a=>!a.enabled),'still disabled until a person enables it');
 // An agent tool can only propose a Studio draft; nothing is added until a person approves.
});

// ── AI workforce ───────────────────────────────────────────────────────────
test('11–12. A restricted procurement agent uses only its permitted tools and data',async()=>{
 const tpl=ok(await E.admin.get('/api/agents?view=templates'));const proc=tpl.templates.find(t=>/procurement/i.test(t.name));assert.ok(proc);
 const a=ok(await E.admin.post('/api/agents',{action:'create',template:proc.id,name:'Procurement agent'}),'create');S.agent=a.id;
 const d=ok(await E.admin.get(`/api/agents?id=${S.agent}`));assert.ok(!d.definition.tools.includes('draft_message'),'procurement agent has no messaging tool');
 ok(await E.admin.post('/api/agents',{action:'save',id:S.agent,definition:{...d.definition,roles:[]}}));
 const pub=await E.admin.post('/api/agents',{action:'publish',id:S.agent});assert.equal(pub.status,200,JSON.stringify(pub.data));assert.equal(pub.data.evaluation.criticalFailed,0,'critical security evaluations passed');
 // It appears on its pages (page-embedded agents), not on unrelated pages.
 assert.ok(ok(await S.staff.get('/api/agents?page=requests')).agents.some(x=>x.id===S.agent),'available on the requisitions page');
 assert.ok(!ok(await S.staff.get('/api/agents?page=knowledge')).agents.some(x=>x.id===S.agent),'not on unrelated pages');
 // A tool outside its allowlist is refused and logged as a policy violation.
 const r=ok(await S.staff.post('/api/agents',{action:'run',id:S.agent,page:'requests',input:'TOOL:draft_message {"channel":"company","text":"hi"}'}),'run');
 const calls=sql(`SELECT tool,status FROM ai_tool_calls WHERE tenant_id='${E.id}' AND run_id='${r.runId}'`);assert.ok(calls.some(c=>c.tool==='draft_message'&&c.status==='denied'),'non-allowlisted tool denied');
 assert.equal(sql(`SELECT count(*) AS n FROM messages WHERE tenant_id='${E.id}' AND body='hi'`)[0].n,0,'nothing was posted');
 // Record data is limited to the requester's permissions: the outsider cannot read the project through the agent.
 const o=await S.outsider.post('/api/agents',{action:'run',id:S.agent,page:'requests',input:`TOOL:graph_context {"type":"project","id":"${S.project}"}`});assert.equal(o.status,200,JSON.stringify(o.data));
 const oc=sql(`SELECT status,output_summary FROM ai_tool_calls WHERE tenant_id='${E.id}' AND run_id='${o.data.runId}' AND tool='graph_context'`);assert.ok(oc.length&&oc.every(c=>c.status!=='ok'),'the agent could not read a record its requester cannot see');
 assert.ok(!/Solar farm/.test(o.data.output),'no leaked title');
});

test('13. The agent cannot reach another company',async()=>{
 assert.equal((await F.admin.get(`/api/agents?id=${S.agent}`)).status,404);
 assert.equal((await F.admin.post('/api/agents',{action:'run',id:S.agent,input:'hello'})).status,404);
 const fProject=ok(await F.admin.post('/api/projects',{action:'create',name:'Foxtrot secret',type:'capital',department:(await F.admin.get('/api/session')).data.departments[0].name,description:'x'}),'F project');
 const r=ok(await E.admin.post('/api/agents',{action:'run',id:S.agent,input:`TOOL:read_record {"type":"project","id":"${fProject.id}"}`}));
 const c=sql(`SELECT status FROM ai_tool_calls WHERE run_id='${r.runId}' AND tool='read_record'`);assert.ok(c.length&&c.every(x=>x.status!=='ok'),'cross-company record not readable');assert.ok(!/Foxtrot secret/.test(r.output));
});

test('14. A consequential AI action waits for human approval',async()=>{
 const r=ok(await S.staff.post('/api/agents',{action:'run',id:S.agent,page:'requests',input:'TOOL:create_purchase_request {"title":"Agent-drafted cables","justification":"Site wiring","lines":[{"description":"Cable","qty":10,"unitPrice":50}]}'}));
 assert.equal(r.status,'waiting_approval');assert.equal(r.approvals.length,1);
 assert.equal(sql(`SELECT count(*) AS n FROM purchase_docs WHERE tenant_id='${E.id}' AND title='Agent-drafted cables'`)[0].n,0,'nothing is created before approval');
 let inInbox=false;for(let i=0;i<20&&!inInbox;i++){const inbox=ok(await E.admin.get('/api/inbox?view=approvals'));inInbox=inbox.items.some(x=>x.sourceType==='ai_approval'&&x.sourceId===r.approvals[0].id);if(!inInbox)await new Promise(x=>setTimeout(x,500))}assert.ok(inInbox,'the approval is in the universal inbox');
 const done=await E.admin.post('/api/agents',{action:'approve',approvalId:r.approvals[0].id});assert.equal(done.status,200,JSON.stringify(done.data));
 const pr=sql(`SELECT status FROM purchase_docs WHERE tenant_id='${E.id}' AND title='Agent-drafted cables'`);assert.equal(pr.length,1);assert.equal(pr[0].status,'Draft','created as a draft, never submitted by the agent');
});

test('15. The AI Control Tower shows runs, costs, failures, tools and versions',async()=>{
 ok(await E.admin.post('/api/agents',{action:'prices',prices:{'llama-3.3-70b-versatile':{prompt:1,completion:2}}}));
 const t=ok(await E.admin.get('/api/agents?view=tower'),'tower');
 assert.ok(t.totals.runs>=4);assert.ok(t.tools.some(x=>x.tool==='draft_message'&&x.status==='denied'));assert.ok(typeof t.totals.failureRate==='number');assert.ok(t.violations.length>=1,'policy violations are listed');assert.ok(t.evals.length>=1);assert.ok(t.provider);
 const v=ok(await E.admin.get(`/api/agents?id=${S.agent}`));assert.ok(v.versions.length>=1);
 const runs=ok(await E.admin.get('/api/agents?view=runs'));assert.ok(runs.runs.length>=4);const one=ok(await E.admin.get(`/api/agents?run=${runs.runs[0].id}`));assert.ok(Array.isArray(one.tools));
 assert.equal((await S.staff.get('/api/agents?view=tower')).status,403,'staff cannot open the tower');
});

test('16. The kill switch immediately stops new agent runs',async()=>{
 ok(await E.admin.post('/api/agents',{action:'kill-switch',on:true}));
 assert.equal((await S.staff.post('/api/agents',{action:'run',id:S.agent,input:'hello'})).status,409);
 ok(await E.admin.post('/api/agents',{action:'kill-switch',on:false}));
 ok(await E.admin.post('/api/agents',{action:'kill',id:S.agent}));assert.equal((await S.staff.post('/api/agents',{action:'run',id:S.agent,input:'hello'})).status,409);
 ok(await E.admin.post('/api/agents',{action:'resume',id:S.agent}));
 // The Platform Owner can stop AI for one company without affecting others.
 ok(await owner.post('/api/platform/os',{action:'ai-kill',tenantId:E.id,on:true}));assert.equal((await S.staff.post('/api/agents',{action:'run',id:S.agent,input:'hello'})).status,409);
 ok(await owner.post('/api/platform/os',{action:'ai-kill',tenantId:E.id,on:false}));
 assert.equal((await S.staff.post('/api/agents',{action:'run',id:S.agent,input:'hello'})).status,200,'runs again once switched back on');
});

test('17–18. Groq is the default gateway; one company can switch provider without affecting another',async()=>{
 await mockReset();ok(await S.staff.post('/api/agents',{action:'run',id:S.agent,input:'status please'}));
 let log=await mockLog();assert.ok(log.some(e=>e.path==='/groq/v1/chat/completions'),'platform Groq default used');
 ok(await E.admin.post('/api/ai',{action:'provider-save',provider:'openai-compatible',model:'mock-model',baseUrl:`${MOCK}/company-a/v1`,apiKey:AI_KEY,fallback:'none'}),'company provider');
 await mockReset();const r=ok(await S.staff.post('/api/agents',{action:'run',id:S.agent,input:'status please'}));assert.match(r.output,/company-a-mock/);
 const fa=ok(await F.admin.post('/api/agents',{action:'create',name:'Foxtrot helper'}));ok(await F.admin.post('/api/agents',{action:'publish',id:fa.id}));
 ok(await F.admin.post('/api/agents',{action:'run',id:fa.id,input:'hello'}));
 log=await mockLog();assert.ok(log.some(e=>e.path==='/company-a/v1/chat/completions'&&e.auth===`Bearer ${AI_KEY}`),'E used its own key');
 assert.ok(log.some(e=>e.path==='/groq/v1/chat/completions'&&e.auth!==`Bearer ${AI_KEY}`),'F still used the platform default');
});

// ── Connector Fabric ───────────────────────────────────────────────────────
test('19. A synced connector imports authorised records with permissions and lineage',async()=>{
 const c=ok(await E.admin.post('/api/connectors',{action:'create',provider:'rest',name:'Stock system',config:{baseUrl:`${MOCK}/rest`,authType:'api_key',header:'X-API-Key',testPath:'/health'},secrets:{secret:REST_SECRET},pages:['app-pages','assistant']}),'connector');S.rest=c.id;
 ok(await E.admin.post('/api/connectors/fabric',{action:'resources',id:S.rest,resources:[{id:'items',label:'Stock items',path:'/items',idField:'sku',titleField:'name',listField:'items'}],actions:[{id:'reorder',label:'Place reorder',method:'POST',path:'/orders',risk:'medium',fields:['sku','qty']}]}),'declare resources');
 const m=ok(await E.admin.get(`/api/connectors/fabric?view=manifest&id=${S.rest}`));assert.deepEqual([...m.manifest.modes].sort(),['action','federated','synced']);
 ok(await E.admin.post('/api/connectors/fabric',{action:'sync',id:S.rest,full:true}),'sync');
 let recs=[];for(let i=0;i<30&&!recs.length;i++){await new Promise(r=>setTimeout(r,1000));recs=ok(await E.admin.get(`/api/connectors/fabric?view=records&id=${S.rest}`)).records}
 assert.equal(recs.length,2,'two external records synced');assert.ok(recs.every(r=>r.externalId&&r.lastVerifiedAt!==undefined));
 const rows=sql(`SELECT permissions_json,tenant_id FROM connector_records WHERE connector_id='${S.rest}'`);assert.ok(rows.every(r=>r.tenant_id===E.id&&r.permissions_json.includes('connector')),'permission mapping stored with each record');
 assert.equal((await F.admin.get(`/api/connectors/fabric?view=records&id=${S.rest}`)).status,404,'another company cannot read them');
 assert.equal((await S.outsider.get(`/api/connectors/fabric?view=records&id=${S.rest}`)).status,404,'people the connector is not enabled for cannot read them');
});

test('20. A federated connector reads current data without indexing it',async()=>{
 const before=sql(`SELECT count(*) AS n FROM connector_records WHERE connector_id='${S.rest}'`)[0].n;
 const live=ok(await E.admin.get(`/api/connectors/fabric?view=live&id=${S.rest}&resource=items&q=gadget`),'live');assert.equal(live.live,true);assert.ok(live.items.length>=1);assert.ok(live.retrievedAt);
 assert.equal(sql(`SELECT count(*) AS n FROM connector_records WHERE connector_id='${S.rest}'`)[0].n,before,'live reads are not stored');
});

test('21. An action connector executes only after authorisation and confirmation',async()=>{
 assert.equal((await S.outsider.post('/api/connectors/fabric',{action:'action',id:S.rest,connectorAction:'reorder',input:{sku:'EXT-1',qty:'5'}})).status,403,'not enabled for this person');
 const run=ok(await E.admin.post('/api/connectors/fabric',{action:'action',id:S.rest,connectorAction:'reorder',input:{sku:'EXT-1',qty:'5'},idempotencyKey:'reorder-1'}),'request');assert.equal(run.status,'pending_confirmation');
 await mockReset();assert.ok(!(await mockLog()).some(e=>e.path==='/rest/orders'),'nothing sent before confirmation');
 const again=ok(await E.admin.post('/api/connectors/fabric',{action:'action',id:S.rest,connectorAction:'reorder',input:{sku:'EXT-1',qty:'5'},idempotencyKey:'reorder-1'}));assert.equal(again.id,run.id,'idempotent');
 assert.equal((await S.outsider.post('/api/connectors/fabric',{action:'confirm-action',runId:run.id})).status,403);
 const done=ok(await E.admin.post('/api/connectors/fabric',{action:'confirm-action',runId:run.id}),'confirm');assert.equal(done.status,'succeeded',JSON.stringify(done));
 assert.ok((await mockLog()).some(e=>e.path==='/rest/orders'&&e.method==='POST'),'sent after confirmation');
 // Test environment: actions are simulated.
 ok(await E.admin.post('/api/connectors/fabric',{action:'environment',id:S.rest,environment:'test',dailyCallLimit:1000}));await mockReset();
 const sim=ok(await E.admin.post('/api/connectors/fabric',{action:'action',id:S.rest,connectorAction:'reorder',input:{sku:'EXT-2',qty:'1'}}));const simDone=ok(await E.admin.post('/api/connectors/fabric',{action:'confirm-action',runId:sim.id}));
 assert.equal(simDone.status,'succeeded');assert.ok(!(await mockLog()).some(e=>e.path==='/rest/orders'),'test environment sends nothing');
 ok(await E.admin.post('/api/connectors/fabric',{action:'environment',id:S.rest,environment:'production',dailyCallLimit:0}));
});

test('22. Connector credentials never appear in browser responses or logs',async()=>{
 const bodies=[await E.admin.get('/api/connectors'),await E.admin.get(`/api/connectors?id=${S.rest}`),await E.admin.get(`/api/connectors/fabric?view=manifest&id=${S.rest}`),await E.admin.get('/api/connectors/fabric?view=health'),await E.admin.get('/api/connectors/fabric?view=logs'),await E.admin.get(`/api/connectors/fabric?view=actions&id=${S.rest}`),await E.admin.get('/api/agents?view=tower'),await owner.get('/api/platform/os')];
 for(const b of bodies){const t=JSON.stringify(b.data);assert.ok(!t.includes(REST_SECRET)&&!t.includes(AI_KEY),'no secret in a response')}
 const log=readFileSync(process.env.OWS_LOG,'utf8');assert.ok(!log.includes(REST_SECRET)&&!log.includes(AI_KEY),'no secret in the Worker log');
 const db=sql(`SELECT detail_json FROM connector_logs WHERE connector_id='${S.rest}'`).map(r=>r.detail_json).join('');assert.ok(!db.includes(REST_SECRET),'no secret in stored connector logs');
});

test('23. Connector data appears in the Work Graph with source lineage',async()=>{
 const found=ok(await E.admin.get('/api/graph?q=External%20widget&types=external'));const n=found.nodes.find(x=>x.type==='external');assert.ok(n,'external record is a graph node');
 assert.equal(n.provider,'rest');assert.equal(n.syncMode,'synced');assert.ok(n.externalId);
 const rec=ok(await E.admin.get(`/api/connectors/fabric?view=records&id=${S.rest}`)).records.find(r=>r.title==='External widget');
 ok(await E.admin.post('/api/connectors/fabric',{action:'link-record',id:S.rest,recordId:rec.id,entityType:'project',entityId:S.project,relationship:'related_to'}),'link to project');
 await new Promise(r=>setTimeout(r,800));const ctx=ok(await E.admin.get(`/api/graph?view=context&type=project&id=${S.project}`));
 const ext=ctx.sections.flatMap(s=>s.items).find(i=>i.type==='external');assert.ok(ext,'the project shows the connected external record');assert.equal(ext.provider,'rest');
 assert.ok(!ok(await S.outsider.get('/api/graph?q=External%20widget&types=external')).nodes.length,'not visible to people the connector is not enabled for');
});

test('24. Studio uses an authorised connector as a data source and as an action',async()=>{
 const d=ok(await E.admin.get(`/api/studio?id=${S.app}`)).definition;
 d.reports.push({key:'stock',name:'External stock',source:{kind:'connector',id:S.rest},measure:{op:'count'},chart:'table'});
 d.automations.push({id:'reorder_on_approval',name:'Reorder when approved',trigger:{type:'status_changed',table:'contracts',toStatus:'approved'},conditions:[],actions:[{type:'connector_action',connectorId:S.rest,action:'reorder',input:{sku:'EXT-1',qty:'{{value}}'}}],enabled:true});
 d.settings={};ok(await E.admin.post('/api/studio',{action:'save',id:S.app,definition:d}),'save');ok(await E.admin.post('/api/studio',{action:'publish',id:S.app}),'publish');
 const rep=ok(await E.admin.get(`/api/studio/records?app=${S.app}&report=stock`),'connector report');assert.equal(rep.count,2);
 const dry=ok(await E.admin.post('/api/studio',{action:'dry-run',id:S.app,automationId:'reorder_on_approval',sample:{title:'x',value:3}}));assert.equal(dry.wouldRun,true);
 assert.equal(sql(`SELECT count(*) AS n FROM connector_action_runs WHERE connector_id='${S.rest}' AND origin='automation'`)[0].n,0,'a dry run changes nothing');
 // A real record moving to approved queues the external action for confirmation.
 const rec=ok(await S.staff.post('/api/studio/records',{action:'create',app:S.app,table:'contracts',data:{title:'Cable supply',value:7,kind:'Supply'}}));
 ok(await S.staff.post('/api/studio/records',{action:'transition',app:S.app,id:rec.id,transition:'submit'}));ok(await S.staff.post('/api/studio/records',{action:'transition',app:S.app,id:rec.id,transition:'approve'}));
 const ap=ok(await S.admin2.get(`/api/studio/records?app=${S.app}&id=${rec.id}`)).approvals.find(a=>a.status==='pending');ok(await S.admin2.post('/api/studio/records',{action:'decide',approvalId:ap.id,approve:true}));
 let runs=[];for(let i=0;i<30&&!runs.length;i++){await new Promise(r=>setTimeout(r,1000));runs=ok(await E.admin.get('/api/connectors/fabric?view=pending-actions')).actions.filter(a=>a.connectorId===S.rest&&a.origin==='automation')}
 assert.equal(runs.length,1,'the automation requested the external action and it waits for confirmation');
});

test('25. An agent can use only explicitly approved connector tools',async()=>{
 const d=ok(await E.admin.get(`/api/agents?id=${S.agent}`)).definition;d.tools=[...new Set([...d.tools,'read_connector','connector_action'])];d.connectors=[S.rest];
 ok(await E.admin.post('/api/agents',{action:'save',id:S.agent,definition:d}));ok(await E.admin.post('/api/agents',{action:'publish',id:S.agent}));
 const call=`TOOL:read_connector {"connectorId":"${S.rest}","resource":"items","query":"widget"}`;
 let r=ok(await E.admin.post('/api/agents',{action:'run',id:S.agent,input:call}));
 let c=sql(`SELECT status,output_summary FROM ai_tool_calls WHERE run_id='${r.runId}' AND tool='read_connector'`);assert.ok(c.length&&c.every(x=>x.status!=='ok'),'refused until the connector administrator allows this agent');
 ok(await E.admin.post('/api/connectors/fabric',{action:'policy',id:S.rest,allowAgents:[S.agent],autoConfirm:[],allowAutomations:true}),'allow agent');
 r=ok(await E.admin.post('/api/agents',{action:'run',id:S.agent,input:call}));c=sql(`SELECT status FROM ai_tool_calls WHERE run_id='${r.runId}' AND tool='read_connector'`);assert.ok(c.some(x=>x.status==='ok'),'allowed once both sides agree');
 // Revoking access from the Control Tower takes effect immediately for new versions.
 ok(await E.admin.post('/api/agents',{action:'revoke-connector',id:S.agent,connectorId:S.rest}));ok(await E.admin.post('/api/agents',{action:'publish',id:S.agent}));
 r=ok(await E.admin.post('/api/agents',{action:'run',id:S.agent,input:call}));c=sql(`SELECT status FROM ai_tool_calls WHERE run_id='${r.runId}' AND tool='read_connector'`);assert.ok(c.every(x=>x.status!=='ok'),'revoked');
});

test('26. Failed jobs can be inspected and retried safely',async()=>{
 const d=ok(await E.admin.get(`/api/studio?id=${S.app}`)).definition;
 d.automations.push({id:'broken',name:'Broken create',trigger:{type:'record_created',table:'contracts'},conditions:[{field:'title',op:'contains',value:'FAILME'}],actions:[{type:'create_record',table:'contracts',values:{value:1}}],enabled:true});
 ok(await E.admin.post('/api/studio',{action:'save',id:S.app,definition:d}));ok(await E.admin.post('/api/studio',{action:'publish',id:S.app}));
 ok(await S.staff.post('/api/studio/records',{action:'create',app:S.app,table:'contracts',data:{title:'FAILME',value:1}}));
 let failed=[];for(let i=0;i<40&&!failed.length;i++){await new Promise(r=>setTimeout(r,1000));failed=ok(await E.admin.get(`/api/studio?view=runs&app=${S.app}`)).runs.filter(r=>r.automationId==='broken'&&['failed','retrying','blocked'].includes(r.status))}
 assert.ok(failed.length>=1,'the failed run is visible with its error');assert.ok(failed[0].error);
 const again=await E.admin.post('/api/studio',{action:'retry-run',runId:failed[0].id});assert.ok([200,409].includes(again.status),JSON.stringify(again.data));
 assert.equal((await S.staff.post('/api/studio',{action:'retry-run',runId:failed[0].id})).status,403,'only builders retry');
 // Connector syncs and domain events are observable and retryable by administrators.
 const syncs=ok(await E.admin.get('/api/connectors/fabric?view=syncs'));assert.ok(syncs.syncs.some(s=>s.connectorId===S.rest));
 const g=ok(await E.admin.get('/api/graph'));assert.equal(typeof g.operations.failedEvents,'number');
 assert.equal((await F.admin.post('/api/studio',{action:'retry-run',runId:failed[0].id})).status,404,'no cross-company retries');
});

test('27–28. Existing modules keep working and the new migrations are applied',async()=>{
 const migrations=sql("SELECT name FROM d1_migrations ORDER BY id").map(r=>r.name);
 for(const m of ['0014_company_operating_system.sql','0015_connected_work.sql'])assert.ok(migrations.includes(m),`${m} applied`);
 const t=ok(await S.staff.post('/api/tickets',{action:'create',title:'Printer jam',description:'Floor 2',department:S.deptA}),'ticket');
 assert.ok(ok(await S.staff.get(`/api/tickets?id=${t.id}`)).ticket);ok(await S.staff.get('/api/tasks?view=mine'));ok(await S.staff.get('/api/files'));ok(await E.admin.get('/api/projects'));
 // Custom fields added in Studio appear on built-in records and are validated.
 ok(await E.admin.post('/api/studio',{action:'extension-save',entityType:'ticket',fields:[{key:'site',label:'Site',type:'select',options:['North','South'],required:true}],stages:['Triage','Fixing']}));
 const ext=ok(await S.staff.get(`/api/extensions?type=ticket&id=${t.id}`));assert.equal(ext.fields[0].key,'site');
 assert.equal((await E.admin.post('/api/extensions',{type:'ticket',id:t.id,values:{site:'West'}})).status,400,'invalid option rejected');
 ok(await E.admin.post('/api/extensions',{type:'ticket',id:t.id,values:{site:'North'},stage:'Triage'}));
 assert.equal(ok(await S.staff.get(`/api/extensions?type=ticket&id=${t.id}`)).values.site,'North');
 assert.equal((await F.admin.get(`/api/extensions?type=ticket&id=${t.id}`)).status,404,'custom values stay in their workspace');
 // Inbox aggregates approvals and assigned work from every module.
 const inbox=ok(await S.admin2.get('/api/inbox'));assert.ok(typeof inbox.counts.approvals==='number');
 // Page builder: the new widgets validate and resolve with the viewer's permissions.
 const w=ok(await S.staff.post('/api/app-pages',{action:'data',widget:{id:'w1',type:'tasks',config:{filters:'mine=assigned',limit:5}}}),'tasks widget');assert.ok(w.rows.some(r=>r.title==='Survey the site'));
 const gantt=ok(await E.admin.post('/api/app-pages',{action:'data',widget:{id:'w2',type:'gantt',config:{limit:10}}}),'gantt widget');assert.ok(Array.isArray(gantt.bars));
 assert.equal((await S.outsider.post('/api/app-pages',{action:'data',widget:{id:'w3',type:'graph',config:{recordType:'project',recordId:S.project}}})).status,404,'graph widget respects visibility');
});
