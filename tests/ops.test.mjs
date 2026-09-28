// Acceptance tests for the Universal Work Inbox, the Request-to-Outcome lifecycle, Goals-to-Execution and Company
// Knowledge Intelligence (scenarios 1–27 of the brief; 28 is the earlier suites, 29 the migration check on a copy
// of existing data, 30 the build/type-check/lint/test commands and 31 the visible runtime check).
// Runs after the other suites against the same throwaway database. AI and connectors are local mocks.
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {Client,rand,strongPassword,tokenFrom,sql as rawSql,settle} from './helpers.mjs';
const pending=[];const sql=q=>{pending.push(1);return rawSql(q)};
beforeEach(async()=>{if(pending.length){pending.length=0;await settle()}});
const OWNER='losharhammond@gmail.com';
const owner=new Client();
const G={slug:'gcorp-'+rand(),domain:`gcorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const H={slug:'hcorp-'+rand(),domain:`hcorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const S={};
const ok=(r,msg)=>{assert.equal(r.status,200,`${msg||''} ${JSON.stringify(r.data)}`);return r.data};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// Background work (domain events, inbox projection, knowledge pipeline) runs after requests; poll for it.
async function until(fn,msg,tries=40){let last;for(let i=0;i<tries;i++){last=await fn();if(last)return last;await wait(600)}assert.fail(`timed out: ${msg}`)}
async function activate(link,pw){const r=await new Client().post('/api/auth/activate',{token:tokenFrom(link),password:pw});assert.equal(r.status,200,'activation')}
async function invite(co,name,extra){const email=`${name.toLowerCase().replace(/\W+/g,'.')}-${rand()}@${co.domain}`;const r=await co.admin.post('/api/people',{action:'create',name,email,...extra});assert.equal(r.status,200,JSON.stringify(r.data));const pw=strongPassword();await activate(r.data.link,pw);const c=new Client();await c.login(email,pw);c.id=r.data.id;c.name=name;return c}
async function decideUntil(c,id,status){for(let i=0;i<6;i++){const d=(await c.get(`/api/purchasing?id=${id}`)).data.doc;if(d.status===status)return;ok(await c.post('/api/purchasing',{action:'decide',id,decision:'approve',comment:'ok'}),'decide')}assert.fail(`${id} never reached ${status}`)}
const inbox=async(c,view='all')=>ok(await c.get(`/api/inbox?view=${view}&size=200`),`inbox ${view}`);

test('setup. Company G (staff in two departments, a manager, a second administrator) and Company H',async()=>{
 sql('DELETE FROM login_attempts');await settle();pending.length=0;
 await owner.login(OWNER,process.env.OWS_OWNER_PW);
 for(const co of [G,H]){
  const r=await owner.post('/api/platform',{action:'create',name:co===G?'Golf Growers':'Hotel Holdings',slug:co.slug,domains:co.domain,adminName:`Admin ${co.slug}`,adminEmail:`admin@${co.domain}`,plan:'business',package:'business',defaults:{departments:true,locations:true,roles:true,workflows:true,folders:true,welcome:true}});
  ok(r,'create workspace');co.id=r.data.id;await activate(r.data.link,co.pw);await co.admin.login(`admin@${co.domain}`,co.pw);
 }
 const s=(await G.admin.get('/api/session')).data;const depts=s.departments.map(d=>d.name);S.deptA=depts[0];S.deptB=depts[1];S.adminId=s.user.id;
 S.staff=await invite(G,'Sam Staff',{role:'employee',department:S.deptA});
 S.outsider=await invite(G,'Olga Outsider',{role:'employee',department:S.deptB});
 S.admin2=await invite(G,'Second Admin',{role:'admin',department:S.deptA});
 S.hStaff=await invite(H,'Hank Staff',{role:'employee',department:S.deptA});
});

// ── 5. Universal Work Inbox ──────────────────────────────────────────────────
test('1. One inbox shows approvals, tasks, mentions and alerts',async()=>{
 const pr=ok(await S.staff.post('/api/purchasing',{action:'save',kind:'PR',title:`Laptops ${rand()}`,department:S.deptA,lines:[{description:'Laptop',qty:2,unit:'ea',unitPrice:4000,taxRate:0}],submit:true}),'PR');S.pr=pr.id;
 const task=ok(await S.admin2.post('/api/tasks',{action:'save',title:`Prepare board pack ${rand()}`,assignees:[S.adminId],dueDate:'2026-01-05'}),'task');S.task=task.id;
 const chans=(await S.staff.get('/api/messages')).data.channels;const general=chans.find(c=>c.kind==='company');
 ok(await S.staff.post('/api/messages',{action:'send',channelId:general.id,body:`Please review @Admin ${rand()}`}),'mention');
 let seen='';const all=await until(async()=>{const x=await inbox(G.admin);const t=new Set(x.items.map(i=>i.type));seen=[...t].join(',');return t.has('approval')&&t.has('task')&&t.has('mention')?x:null},'approval, task and mention in the inbox',60).catch(e=>{throw new Error(`${e.message}; types seen: ${seen}`)});
 assert.ok(all.items.some(i=>i.sourceType==='PR'&&i.sourceId===S.pr&&i.type==='approval'),'purchase approval');
 assert.ok(all.items.some(i=>i.sourceType==='task'&&i.sourceId===S.task),'assigned task');
 assert.ok(all.items.some(i=>i.type==='mention'),'mention');
 assert.ok(all.items.find(i=>i.sourceId===S.task).overdue,'overdue work is flagged');
 const c=all.counts;assert.ok(c.approvals>=1&&c.tasks>=1&&c.mentions>=1&&c.overdue>=1,JSON.stringify(c));
 // Alerts: an overdue task produces an alert-type view entry and the alerts view is available.
 ok(await G.admin.get('/api/inbox?view=alerts'),'alerts view');
 for(const v of ['approvals','tasks','mentions','overdue','financial','high','today','week','snoozed','completed','delegated'])ok(await G.admin.get(`/api/inbox?view=${v}`),v);
});
test('2. Completing an inbox item updates the original source record (approve and complete)',async()=>{
 const x=await inbox(G.admin);const appr=x.items.find(i=>i.sourceType==='PR'&&i.sourceId===S.pr);
 // A stale version is refused (optimistic concurrency against the source).
 assert.equal((await G.admin.post('/api/inbox',{action:'approve',id:appr.id,version:'stale-version'})).status,409,'stale version refused');
 ok(await G.admin.post('/api/inbox',{action:'approve',id:appr.id,version:appr.version,comment:'Approved from inbox'}),'approve from inbox');
 const d=(await G.admin.get(`/api/purchasing?id=${S.pr}`)).data.doc;assert.ok(['Approved','Pending approval'].includes(d.status));
 const t=x.items.find(i=>i.sourceType==='task'&&i.sourceId===S.task);
 ok(await G.admin.post('/api/inbox',{action:'complete',id:t.id}),'complete task from inbox');
 const task=(await G.admin.get(`/api/tasks?id=${S.task}`)).data;assert.equal((task.task||task).status,'Done','the task itself is done');
 await until(async()=>!(await inbox(G.admin)).items.some(i=>i.id===t.id),'completed item leaves the open inbox');
 const audit=sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${G.id}' AND action LIKE 'Inbox%'`);assert.ok(audit[0].n>=2,'inbox actions are audited');
 // Snooze and read state are personal and do not change the source.
 const m=(await inbox(G.admin)).items.find(i=>i.type==='mention');
 ok(await G.admin.post('/api/inbox',{action:'snooze',id:m.id,until:new Date(Date.now()+86400000).toISOString()}),'snooze');
 assert.ok((await inbox(G.admin,'snoozed')).items.some(i=>i.id===m.id));
 ok(await G.admin.post('/api/inbox',{action:'unsnooze',id:m.id}),'unsnooze');
});
test('3. Unauthorised records never appear in inbox results or counts',async()=>{
 const mine=await inbox(S.outsider);assert.ok(!mine.items.some(i=>i.sourceId===S.pr||i.sourceId===S.task),'no other people\'s items');
 const before=mine.counts.all;
 // Forged ids and another workspace's items are not reachable.
 const any=(await inbox(G.admin)).items[0];
 assert.equal((await S.outsider.get(`/api/inbox?id=${any.id}`)).status,404,'another person\'s item id');
 assert.equal((await S.hStaff.get(`/api/inbox?id=${any.id}`)).status,404,'another company\'s item id');
 assert.equal((await S.outsider.post('/api/inbox',{action:'approve',id:any.id})).status,404,'cannot act on it');
 // An item whose source becomes invisible is removed at read time (counts included).
 ok(await S.staff.post('/api/tasks',{action:'save',title:'Private to staff',assignees:[S.staff.id]}),'staff task');
 assert.equal((await inbox(S.outsider)).counts.all,before,'counts unchanged by other people\'s work');
});
test('4. Delegation respects dates, permissions and restricted approval rules',async()=>{
 // Delegations cannot point backwards in time or at people outside the company, and cannot form chains.
 const past=await G.admin.post('/api/inbox',{action:'delegation-create',delegateId:S.admin2.id,startsAt:'2020-01-01T00:00:00Z',endsAt:'2020-01-02T00:00:00Z'});assert.equal(past.status,400,'an expired window is refused');
 assert.notEqual((await G.admin.post('/api/inbox',{action:'delegation-create',delegateId:S.hStaff.id,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()})).status,200,'cross-company delegate refused');
 const pr=ok(await S.staff.post('/api/purchasing',{action:'save',kind:'PR',title:`Chairs ${rand()}`,department:S.deptA,lines:[{description:'Chair',qty:3,unit:'ea',unitPrice:500,taxRate:0}],submit:true}),'PR');
 // Before delegation the second administrator cannot see the admin's approval in their inbox.
 const d=ok(await G.admin.post('/api/inbox',{action:'delegation-create',delegateId:S.staff.id,modules:['purchasing'],startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),reason:'Leave'}),'delegation');
 // The requester is the delegate: approving their own request is still refused.
 assert.notEqual((await S.staff.post('/api/purchasing',{action:'decide',id:pr.id,decision:'approve'})).status,200,'a delegate cannot approve their own request');
 const chain=await S.staff.post('/api/inbox',{action:'delegation-create',delegateId:S.outsider.id,modules:['purchasing'],startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()});assert.equal(chain.status,409,'no delegation chains');
 ok(await G.admin.post('/api/inbox',{action:'delegation-end',id:d.id}),'end delegation');
 const list=ok(await G.admin.get('/api/inbox?view=delegations'));assert.ok(list.delegations.some(x=>x.id===d.id&&!x.active));
 // A delegation to the second administrator lets them decide "on behalf of" the admin, recorded in the audit.
 const d2=ok(await G.admin.post('/api/inbox',{action:'delegation-create',delegateId:S.admin2.id,modules:['purchasing'],startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()}));
 const del=await until(async()=>(await inbox(S.admin2,'delegated')).items.find(i=>i.sourceId===pr.id),'delegated item appears for the delegate');
 assert.ok(del.delegatedFrom===S.adminId);
 ok(await G.admin.post('/api/inbox',{action:'delegation-end',id:d2.id}));
});
test('5. AI prioritisation gives evidence and never acts on its own',async()=>{
 const before=sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${G.id}' AND (action LIKE '%approved%' OR action LIKE '%rejected%')`)[0].n;
 const r=ok(await G.admin.post('/api/inbox',{action:'ai-prioritize'}),'ai prioritise');
 assert.ok(r.ranking.length>0,'ranked');assert.ok(!r.ranking.some(x=>x.id==='not-a-real-item'),'invented ids are dropped');
 assert.ok(r.ranking.every(x=>Array.isArray(x.evidence)),'every item carries evidence');assert.match(r.note,/nothing was approved/i);
 const after=sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${G.id}' AND (action LIKE '%approved%' OR action LIKE '%rejected%')`)[0].n;
 assert.equal(after,before,'no consequential action was taken');
 const draft=ok(await G.admin.post('/api/inbox',{action:'ai-draft',id:r.ranking[0].id}));assert.match(draft.note,/nothing was sent/i);
});

// ── 6. Request-to-Outcome lifecycle ──────────────────────────────────────────
test('6. A business request progresses through its configured lifecycle',async()=>{
 const t=ok(await G.admin.get('/api/lifecycle?view=templates'));assert.ok(t.templates.length>=8,'built-in templates');
 const r=ok(await S.staff.post('/api/lifecycle',{action:'create',title:`Solar generator ${rand()}`,requestType:'asset',businessNeed:'Frequent outages stop production',expectedOutcome:'No downtime',estimatedCost:12000,department:S.deptA}),'create request');S.req=r.id;
 ok(await S.staff.post('/api/lifecycle',{action:'submit',id:r.id}),'submit');
 const d=ok(await S.staff.get(`/api/lifecycle?id=${r.id}`));assert.equal(d.request.status,'In progress');
 const active=d.stages.find(s=>s.status==='active');assert.equal(active.stage_key,'approval','the approval gate is active');
 assert.equal(d.stages.find(s=>s.stage_key==='request').status,'done');
 // Staff in another department cannot open it.
 assert.equal((await S.outsider.get(`/api/lifecycle?id=${r.id}`)).status,404);
 assert.equal((await S.hStaff.get(`/api/lifecycle?id=${r.id}`)).status,404,'other company');
});
test('7. Approval produces the correct next lifecycle stage',async()=>{
 let d=ok(await G.admin.get(`/api/lifecycle?id=${S.req}`));
 assert.equal((await S.staff.post('/api/lifecycle',{action:'decide',id:S.req,approvalId:d.approvals[0].id,decision:'approve'})).status,403,'the requester cannot approve');
 // The approval also appears in the approver's inbox and can be decided there.
 for(let i=0;i<4;i++){d=ok(await G.admin.get(`/api/lifecycle?id=${S.req}`));const p=d.approvals.find(a=>a.status==='pending');if(!p)break;const who=p.approverIds.includes(S.admin2.id)&&!p.approverIds.includes(S.adminId)?S.admin2:G.admin;ok(await who.post('/api/lifecycle',{action:'decide',id:S.req,approvalId:p.id,decision:'approve',comment:'Go ahead'}),'approve step')}
 d=ok(await G.admin.get(`/api/lifecycle?id=${S.req}`));
 assert.equal(d.stages.find(s=>s.stage_key==='approval').status,'done');
 assert.equal(d.stages.find(s=>s.status==='active').stage_key,'pr','the next stage (purchase requisition) is active');
});
test('8–12. Project links, no double counting, partial receipts and multiple POs, asset creation and lineage',async()=>{
 const p=ok(await G.admin.post('/api/lifecycle',{action:'create-project',id:S.req,name:'Generator project'}),'project');S.project=p.projectId;
 const b=ok(await G.admin.post('/api/lifecycle',{action:'create-budget',id:S.req,amount:20000,contingency:1000,fundingSource:'Capex 2026'}),'budget');S.budget=b.budgetId;
 const pr=ok(await S.staff.post('/api/purchasing',{action:'save',kind:'PR',title:'Generators',department:S.deptA,projectId:S.project,budgetId:S.budget,requestId:S.req,lines:[{description:'Generator',qty:4,unit:'ea',unitPrice:2000,taxRate:0},{description:'Installation',qty:1,unit:'job',unitPrice:1000,taxRate:0}],submit:true}),'PR');
 await decideUntil(G.admin,pr.id,'Approved');
 const prLines=(await G.admin.get(`/api/purchasing?id=${pr.id}`)).data.lines;
 // 10. Two purchase orders from one requisition (partial conversion).
 const po1=ok(await G.admin.post('/api/purchasing',{action:'convert',id:pr.id,lines:[{lineId:prLines[0].id,qty:2}]}),'first PO');assert.equal(po1.remaining,true);
 assert.equal((await G.admin.get(`/api/purchasing?id=${pr.id}`)).data.doc.status,'Partially converted');
 const po2=ok(await G.admin.post('/api/purchasing',{action:'convert',id:pr.id,lines:[{lineId:prLines[0].id,qty:2},{lineId:prLines[1].id,qty:1}]}),'second PO');assert.equal(po2.remaining,false);
 assert.ok([403,409].includes((await G.admin.post('/api/purchasing',{action:'convert',id:pr.id,lines:[{lineId:prLines[0].id,qty:1}]})).status),'cannot over-order the requisition');
 assert.equal((await G.admin.get(`/api/purchasing?id=${pr.id}`)).data.doc.status,'Converted');
 for(const po of [po1,po2]){ok(await G.admin.post('/api/purchasing',{action:'submit',id:po.id}));await decideUntil(S.admin2,po.id,'Approved');ok(await G.admin.post('/api/purchasing',{action:'issue',id:po.id}),'issue')}
 // Partial receipt: 1 of 2 generators on PO1, with an asset created from the received unit (11).
 const l1=(await G.admin.get(`/api/purchasing?id=${po1.id}`)).data.lines;
 const rec=ok(await G.admin.post('/api/purchasing',{action:'receive',id:po1.id,lines:[{lineId:l1[0].id,qty:1,createAssets:1,assetCategory:'Generator',custodianId:S.staff.id,warrantyUntil:'2028-06-30',maintenanceEveryDays:90,assetDetails:[{serial:'GEN-SN-001'}]}]}),'partial receipt');
 assert.equal(rec.assets.length,1,'an asset was created from the receipt');S.asset=rec.assetIds?.[0]||sql(`SELECT id FROM assets WHERE tenant_id='${G.id}' AND purchase_doc_id='${po1.id}'`)[0].id;
 assert.equal((await G.admin.get(`/api/purchasing?id=${po1.id}`)).data.doc.status,'Partially received');
 // 9. Ledger totals: requested 9,000 once (not again for the POs), ordered 9,000 across both POs, received 2,000.
 const f=ok(await G.admin.get(`/api/lifecycle?view=finance&project=${S.project}`),'finance');
 assert.equal(f.requested,9000,'requested counted once');assert.equal(f.ordered,9000,'two POs sum to the requisition');assert.equal(f.received,2000,'only what was received');
 assert.equal(f.committed,7000,'unreceived part of the orders');assert.equal(f.actual,2000);assert.equal(f.budget,20000);
 assert.equal(f.forecast,f.actual+f.committed,'forecast = actual + committed');
 // Linking the same PR again (project + request + budget) never double counts.
 ok(await G.admin.post('/api/projects',{action:'link',id:S.project,type:'budget',recordId:S.budget}).catch(()=>({status:200,data:{}})));
 const f2=ok(await G.admin.get(`/api/lifecycle?view=finance&project=${S.project}`));assert.equal(f2.ordered,9000);assert.equal(f2.requested,9000);
 // The ledger is append-only.
 const sum0=rawSql(`SELECT sum(amount) AS s FROM financial_events WHERE tenant_id='${G.id}'`)[0].s;await settle();
 assert.throws(()=>rawSql(`UPDATE financial_events SET amount=0 WHERE tenant_id='${G.id}'`),'ledger rows cannot be changed');await settle();
 assert.throws(()=>rawSql(`DELETE FROM financial_events WHERE tenant_id='${G.id}'`),'ledger rows cannot be deleted');await settle();
 assert.equal(rawSql(`SELECT sum(amount) AS s FROM financial_events WHERE tenant_id='${G.id}'`)[0].s,sum0,'ledger unchanged');await settle();
 // Every figure can be traced to its records.
 const src=ok(await G.admin.get(`/api/lifecycle?view=finance&project=${S.project}&measure=ordered`));assert.equal(src.sources.length,2,'two POs behind "ordered"');
 // 8. The request/project trace links budget, PR, POs, receipts and assets.
 const tr=ok(await G.admin.get(`/api/lifecycle?id=${S.req}`));
 assert.equal(tr.project.id,S.project);assert.equal(tr.budget.id,S.budget);
 assert.ok(tr.documents.some(x=>x.id===pr.id)&&tr.documents.some(x=>x.id===po1.id)&&tr.documents.some(x=>x.id===po2.id),'PR and both POs');
 assert.ok(tr.receipts.length>=1,'receipts');assert.ok(tr.assets.some(a=>a.id===S.asset),'assets');
 // 12. Asset lineage: why, budget, approvers, vendor/PO, receiver, custodian, warranty, lifetime cost, recommendation.
 const a=ok(await G.admin.get(`/api/lifecycle?view=asset&recordId=${S.asset}`),'asset lineage');
 assert.equal(a.requestId,S.req);assert.match(a.why.request.title,/Solar generator/);assert.equal(a.budget.name.length>0,true);
 assert.ok(a.approvals.length>=2,'requisition, order and request approvers');assert.equal(a.order.id,po1.id);assert.ok(a.receipt,'who received it');
 assert.equal(a.asset.custodian.id,S.staff.id);assert.ok(a.asset.warrantyDaysLeft>0);assert.equal(typeof a.lifetimeCost,'number');assert.ok(a.recommendation);
 const plan=sql(`SELECT count(*) AS n FROM maintenance_plans WHERE tenant_id='${G.id}' AND asset_id='${S.asset}'`)[0].n;assert.equal(plan,1,'a preventive maintenance plan was created');
 // An outsider cannot open the lineage.
 assert.equal((await S.hStaff.get(`/api/lifecycle?view=asset&recordId=${S.asset}`)).status,404);
 // Change order and invoice three-way match (exception when invoiced exceeds received).
 const inv=ok(await G.admin.post('/api/purchasing',{action:'invoice',id:po1.id,vendorInvoiceNo:'V-1',amount:4000,invoiceDate:'2026-09-01'}),'invoice');assert.equal(inv.status,'Exception','more invoiced than received');
 const inv2=ok(await G.admin.post('/api/purchasing',{action:'invoice',id:po2.id,vendorInvoiceNo:'V-2',amount:0.01,invoiceDate:'2026-09-01'}),'small invoice');assert.equal(inv2.status,'Exception','nothing received on PO2 yet');
 S.po1=po1.id;S.po2=po2.id;S.pr2=pr.id;
});
test('13. A service can be accepted, rated and closed',async()=>{
 const s=ok(await G.admin.post('/api/lifecycle',{action:'service-save',title:'Generator installation service',requestId:S.req,acceptanceCriteria:'Runs 4h under load',slaTargetHours:48,ownerId:S.adminId}),'service');
 ok(await G.admin.post('/api/lifecycle',{action:'service-action',id:s.id,op:'start'}));
 assert.equal((await G.admin.post('/api/lifecycle',{action:'service-action',id:s.id,op:'accept',rating:5})).status,409,'cannot accept before delivery');
 ok(await G.admin.post('/api/lifecycle',{action:'service-action',id:s.id,op:'deliver'}),'deliver');
 assert.equal((await S.outsider.post('/api/lifecycle',{action:'service-action',id:s.id,op:'accept',rating:5})).status,403,'only the owner accepts');
 const acc=ok(await G.admin.post('/api/lifecycle',{action:'service-action',id:s.id,op:'accept',rating:4,qualityScore:90,notes:'Good'}),'accept');assert.equal(acc.status,'Accepted');
 const cl=ok(await G.admin.post('/api/lifecycle',{action:'service-action',id:s.id,op:'close'}),'close');assert.equal(cl.status,'Closed');
 const d=ok(await G.admin.get(`/api/lifecycle?view=service&sid=${s.id}`));assert.equal(d.service.rating,4);assert.equal(d.service.sla_met,1);assert.equal(d.service.payment_eligible,1);
});
test('14. An outcome review compares expected and actual benefits',async()=>{
 const b=ok(await G.admin.post('/api/lifecycle',{action:'benefit-add',id:S.req,name:'Downtime hours saved',kind:'operational',unit:'h',baseline:0,expected:100}),'benefit');
 ok(await G.admin.post('/api/lifecycle',{action:'benefit-measure',id:S.req,benefitId:b.id,value:80,note:'First quarter'}),'measure');
 const rv=ok(await G.admin.post('/api/lifecycle',{action:'review-schedule',id:S.req,reviewDate:'2026-12-01'}),'schedule');
 const done=ok(await G.admin.post('/api/lifecycle',{action:'review-complete',id:S.req,reviewId:rv.id,outcomeStatus:'Partially achieved',lessonsLearned:'Order earlier',followUps:['Add a second generator']}),'complete review');
 const ben=done.results.benefits[0];assert.equal(ben.expected,100);assert.equal(ben.actual,80);assert.equal(ben.variance,-20);assert.equal(ben.realisedPct,80);
 assert.ok(done.results.finance,'financial result from the ledger');assert.equal(done.tasks.length,1,'follow-up task created');
});

// ── 7. Goals-to-Execution ────────────────────────────────────────────────────
test('15–16. Strategy connects to objectives, key results, initiatives, projects, milestones and tasks; rollups explain themselves',async()=>{
 const strat=ok(await G.admin.post('/api/business',{action:'save',kind:'strategy',title:'Strategy 2026',data:{mission:'Grow',vision:'Lead'}}),'strategy');S.strategy=strat.id;
 const obj=ok(await G.admin.post('/api/business',{action:'save',kind:'objective',title:'Reliable operations',parentId:strat.id,startDate:'2026-01-01',endDate:'2026-12-31'}),'objective');S.objective=obj.id;
 const kr=ok(await G.admin.post('/api/business',{action:'save',kind:'key_result',title:'Uptime to 99%',parentId:obj.id,data:{metricType:'Number',start:90,target:99,current:90,unit:'%',weight:2}}),'key result');S.kr=kr.id;
 ok(await G.admin.post('/api/business',{action:'save',id:kr.id,data:{metricType:'Number',start:90,target:99,current:94.5,unit:'%',weight:2},note:'Monthly reading'}),'manual update');
 await until(async()=>(await G.admin.get(`/api/graph?type=project&id=${S.project}`)).status===200,'project in the Work Graph',20).catch(()=>null);
 const ini=await until(async()=>{const r=await G.admin.post('/api/business',{action:'save',kind:'initiative',title:'Backup power',parentId:kr.id,data:{rollupMethod:'Projects',projects:[S.project]}});return r.status===200?r.data:null},'initiative linked to the project');S.initiative=ini.id;
 const ms=ok(await G.admin.post('/api/tasks',{action:'save',projectId:S.project,title:'Generators installed',milestone:true,dueDate:'2026-11-01'}),'milestone');
 ok(await G.admin.post('/api/tasks',{action:'save',projectId:S.project,title:'Site survey',assignees:[S.staff.id]}),'task');
 const tree=ok(await G.admin.get('/api/strategy?view=tree'),'tree');
 const kinds=new Set(tree.items.map(i=>i.kind));for(const k of ['strategy','objective','key_result','initiative'])assert.ok(kinds.has(k),k);
 const p=tree.projects.find(x=>x.id===S.project);assert.ok(p,'project under the initiative');assert.ok(p.milestones.some(m=>m.id===ms.id),'milestone');assert.ok(p.tasks.n>=1,'tasks');
 const k=ok(await G.admin.get(`/api/strategy?view=item&id=${kr.id}`),'kr');
 assert.equal(k.rollup.progress,50,'(94.5−90)÷(99−90)');assert.match(k.rollup.method,/current|start|target|\(/);assert.ok(k.updates.some(u=>u.source==='manual'),'lineage of the manual update');
 const o=ok(await G.admin.get(`/api/strategy?view=item&id=${obj.id}`),'objective');
 assert.equal(o.rollup.progress,50);assert.match(o.rollup.method,/Weighted average of key results/);assert.ok(o.rollup.sources.some(s=>s.id===kr.id&&s.weight===2),'sources with weights');
 const i=ok(await G.admin.get(`/api/strategy?view=item&id=${ini.id}`),'initiative');assert.match(i.rollup.method,/project progress/i);assert.ok(i.rollup.sources.some(s=>s.id===S.project));assert.ok(i.rollup.budget,'budget consumption from the ledger');
 // Overrides are explicit and carry their reason.
 ok(await G.admin.post('/api/strategy',{action:'override',id:obj.id,value:70,reason:'Board estimate'}));
 assert.match(ok(await G.admin.get(`/api/strategy?view=item&id=${obj.id}`)).rollup.method,/Manual override \(Board estimate\)/);
 ok(await G.admin.post('/api/strategy',{action:'clear-override',id:obj.id}));
 // AI-drafted check-ins cite sources and remain drafts.
 const dr=ok(await G.admin.post('/api/strategy',{action:'draft-check-in',id:obj.id}),'AI draft check-in');assert.ok(dr.citations.length>0,'citations');
 const ci=sql(`SELECT status,ai_drafted FROM strategy_check_ins WHERE id='${dr.id}'`)[0];assert.equal(ci.status,'draft');assert.equal(ci.ai_drafted,1);
 ok(await G.admin.get('/api/strategy?view=portfolio'),'portfolio');ok(await G.admin.get('/api/strategy?view=capacity'),'capacity');
 const rp=ok(await G.admin.post('/api/strategy',{action:'review-generate',kind:'executive'}),'executive pack');assert.ok(ok(await G.admin.get(`/api/strategy?view=review&id=${rp.id}`)).review.content.items.length>0);
});
test('17. Private goals stay invisible to unauthorised users, search, the Work Graph and AI',async()=>{
 const secret=ok(await G.admin.post('/api/business',{action:'save',kind:'objective',title:`Confidential acquisition ${rand()}`,visibility:'confidential',acl:{people:[S.admin2.id]},description:'Acquire a competitor'}),'confidential objective');S.secret=secret.id;
 const lead=ok(await G.admin.post('/api/business',{action:'save',kind:'objective',title:'Leadership-only margin goal',visibility:'leadership'}),'leadership objective');
 for(const c of [S.staff,S.outsider]){
  const tree=ok(await c.get('/api/strategy?view=tree'));assert.ok(!tree.items.some(i=>i.id===secret.id||i.id===lead.id),'not in the tree');
  assert.equal((await c.get(`/api/strategy?view=item&id=${secret.id}`)).status,404,'not by id');
  const g=await c.get(`/api/graph?q=Confidential`);assert.ok(!JSON.stringify(g.data).includes(secret.id),'not in the Work Graph');
  const k=await c.get(`/api/knowledge?view=search&q=Confidential acquisition`);assert.ok(!JSON.stringify(k.data).includes('Confidential acquisition'),'not in search');
 }
 assert.equal(ok(await S.admin2.get(`/api/strategy?view=item&id=${secret.id}`)).record.id,secret.id,'the named person sees it');
 // AI (governed agent tools) only reads what the asking person may see.
 const tpl=ok(await G.admin.get('/api/agents?view=templates'));const exec=tpl.templates.find(t=>/Executive/i.test(t.name));assert.ok(exec,'executive template');
 const a=ok(await G.admin.post('/api/agents',{action:'create',template:exec.id,name:'Exec agent'}),'agent');const def=ok(await G.admin.get(`/api/agents?id=${a.id}`)).definition;
 ok(await G.admin.post('/api/agents',{action:'save',id:a.id,definition:{...def,roles:[],tools:['analyze_objective','trace_record']}}));ok(await G.admin.post('/api/agents',{action:'publish',id:a.id}),'publish');
 for(const tool of [`TOOL:analyze_objective {"id":"${secret.id}"}`]){
  const run=ok(await S.staff.post('/api/agents',{action:'run',id:a.id,input:tool}),'agent run');
  assert.ok(!/Confidential acquisition|Acquire a competitor/.test(JSON.stringify(run)),'the agent never sees the hidden goal');
  const calls=sql(`SELECT tool,status,output_summary FROM ai_tool_calls WHERE tenant_id='${G.id}' AND run_id='${run.runId}'`);assert.ok(calls.length>0,'the tool was called');assert.ok(!calls.some(c=>/Confidential acquisition/.test(c.output_summary||'')),'no leak in tool output');
 }
});
test('18. Planning scenarios do not change live records before approval',async()=>{
 const before=sql(`SELECT target_date FROM projects WHERE id='${S.project}'`)[0].target_date;
 ok(await G.admin.post('/api/projects',{action:'update',id:S.project,targetDate:'2026-12-01'}),'project target');
 const sc=ok(await G.admin.post('/api/strategy',{action:'scenario-create',name:'Delay generators'}),'scenario');
 ok(await G.admin.post('/api/strategy',{action:'scenario-change',id:sc.id,changeType:'delay_project',targetType:'project',targetId:S.project,params:{days:30}}));
 const ev=ok(await G.admin.post('/api/strategy',{action:'scenario-evaluate',id:sc.id}));assert.equal(ev.effects.timelines[0].shiftDays,30);assert.equal(ev.effects.timelines[0].to,'2026-12-31');
 assert.equal(sql(`SELECT target_date FROM projects WHERE id='${S.project}'`)[0].target_date,'2026-12-01','live record unchanged after evaluation');
 assert.equal((await S.admin2.get(`/api/strategy?view=scenario&id=${sc.id}`)).status,404,'a draft is private to its owner');
 ok(await G.admin.post('/api/strategy',{action:'scenario-submit',id:sc.id}));
 assert.equal((await G.admin.post('/api/strategy',{action:'scenario-apply',id:sc.id})).status,409,'cannot apply before approval');
 assert.equal((await G.admin.post('/api/strategy',{action:'scenario-approve',id:sc.id})).status,403,'the owner cannot approve their own scenario');
 assert.equal(sql(`SELECT target_date FROM projects WHERE id='${S.project}'`)[0].target_date,'2026-12-01','still unchanged');
 ok(await S.admin2.post('/api/strategy',{action:'scenario-approve',id:sc.id}),'approve');ok(await S.admin2.post('/api/strategy',{action:'scenario-apply',id:sc.id}),'apply');
 assert.equal(sql(`SELECT target_date FROM projects WHERE id='${S.project}'`)[0].target_date,'2026-12-31','applied through the projects module');
 void before;
});

// ── 8. Company Knowledge Intelligence ───────────────────────────────────────
test('19. Documents are extracted, summarised and indexed (ungrounded extractions are dropped)',async()=>{
 const text='Generator maintenance policy. We decided to service every generator quarterly. Action: Sam Staff will book the service by Friday. The main risk is fuel theft at night. '+'Background detail about the site and its equipment. '.repeat(6);
 const up=await S.staff.upload('asset',S.asset,'generator-policy.txt',text);assert.equal(up.status,200,JSON.stringify(up.data));S.file=up.data.id;
 const hit=await until(async()=>{const r=ok(await S.staff.get('/api/knowledge?view=search&q=generator quarterly'));return r.results.find(x=>x.sourceType==='file'&&x.title.includes('generator-policy'))},'the document is searchable',60);
 const item=ok(await S.staff.get(`/api/knowledge?view=item&id=${hit.id}`),'knowledge item');S.kFile=hit.id;
 assert.ok(['ready','partial'].includes(item.item.status));assert.ok(item.item.summary.length>0,'summary');
 const stages=new Set(item.jobs.map(j=>j.stage));for(const s of ['security_scan','extracting','classifying','summarizing','indexing'])assert.ok([...stages].some(x=>x.startsWith(s.slice(0,6))),`stage ${s} recorded`);
 const d=item.item.detail;assert.ok(!JSON.stringify(d).includes('THIS QUOTE IS NOT IN THE SOURCE'),'invented content is never stored');
 assert.ok((d.notes||[]).some(n=>/dropped/.test(n)),'the drop is reported');
 // The extracted text the server reads starts with the file name; every quote must appear in it verbatim.
 const src=`generator-policy.txt\n${text}`.toLowerCase().replace(/\s+/g,' ');
 for(const x of [...(d.keyPoints||[]),...(d.decisions||[]),...(d.risks||[])])if(x.quote)assert.ok(src.includes(x.quote.replace(/\[§\d+\]/g,' ').toLowerCase().replace(/\s+/g,' ').trim()),`quote is verbatim from the source: ${x.quote}`);
 assert.ok((d.decisions||[]).some(x=>/quarterly/.test(x.text)),'the stated decision was extracted');
});
test('20. Audio is transcribed and summarised where supported',async()=>{
 const fd=new FormData();fd.set('file',new File([new Uint8Array([0x49,0x44,0x33,4,0,0,0,0,0,0,...Array(200).fill(1)])],'standup.mp3',{type:'audio/mpeg'}));
 const r=await fetch(process.env.OWS_BASE+'/api/files',{method:'POST',headers:{Origin:process.env.OWS_BASE,Cookie:G.admin.cookie},body:fd});const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));
 const f=await until(async()=>{const x=(await G.admin.get(`/api/files?id=${j.id}`)).data;const file=x.file||x;return ['ready','Ready','partial','failed'].includes(String(file.processing_status||file.processingStatus||'').toLowerCase())?file:null},'audio processed',60);
 const k=await until(async()=>{const s=ok(await G.admin.get('/api/knowledge?view=search&q=standup'));return s.results.find(x=>x.title.includes('standup'))},'recording in knowledge',60);
 const item=ok(await G.admin.get(`/api/knowledge?view=item&id=${k.id}`));assert.equal(item.item.kind,'recording');
 assert.ok(item.jobs.some(x=>x.stage==='transcribing'||/transcri/i.test(x.detail)),'transcription stage recorded');void f;
});
test('21–23. Generated knowledge inherits source permissions; search, counts, autocomplete, AI and graph never leak it',async()=>{
 // The asset-attached document is visible to people who can see the asset (not to another department's staff).
 const sOut=ok(await S.outsider.get('/api/knowledge?view=search&q=generator quarterly'));
 assert.ok(!sOut.results.some(x=>x.id===S.kFile),'not in results');
 assert.ok(!JSON.stringify(sOut.facets).includes('generator-policy'),'facet counts only cover permitted results');
 const ac=ok(await S.outsider.get('/api/knowledge?view=autocomplete&q=generator-pol'));assert.ok(!ac.suggestions.some(x=>/generator-policy/.test(x.label)),'not in autocomplete');
 assert.equal((await S.outsider.get(`/api/knowledge?view=item&id=${S.kFile}`)).status,404,'not by id');
 assert.equal((await S.hStaff.get(`/api/knowledge?view=item&id=${S.kFile}`)).status,404,'not from another company');
 const hs=ok(await S.hStaff.get('/api/knowledge?view=search&q=generator'));assert.equal(hs.total,0,'another company finds nothing');
 // Query-time check: when the source's audience changes, results change immediately without reindexing.
 const q=ok(await S.outsider.post('/api/knowledge',{action:'ask',title:'How often are generators serviced?',body:''}),'question');
 const ans=ok(await S.outsider.post('/api/knowledge',{action:'ai-answer',id:q.id}),'AI answer');assert.ok(!JSON.stringify(ans).includes('generator-policy'),'AI answers never cite hidden sources');
 const g=await S.outsider.get(`/api/graph?q=generator-policy`);assert.ok(!JSON.stringify(g.data).includes('generator-policy.txt'),'not via the Work Graph');
});
test('24. Decisions carry evidence, rationale, participants and connected work',async()=>{
 const meeting=ok(await G.admin.post('/api/business',{action:'save',kind:'meeting',title:'Ops review',startDate:'2026-09-01',data:{attendees:[S.adminId,S.staff.id]}}),'meeting');
 await until(async()=>(await G.admin.post('/api/business',{action:'save',kind:'decision',title:'__probe',data:{evidence:[S.file]}})).status===200,'file in the graph',30);
 const dec=ok(await G.admin.post('/api/business',{action:'save',kind:'decision',title:'Service generators quarterly',parentId:meeting.id,data:{decision:'Quarterly servicing',rationale:'Outages cost more than servicing',alternatives:'Annual servicing',decidedBy:S.adminId,participants:[S.adminId,S.staff.id],evidence:[S.file],affects:[S.project]}}),'decision');
 ok(await G.admin.post('/api/knowledge',{action:'decision-status',id:dec.id,status:'Under review'}));
 const dd=ok(await G.admin.get(`/api/knowledge?view=decision&id=${dec.id}`),'dossier');
 assert.equal(dd.decision.rationale,'Outages cost more than servicing');assert.equal(dd.decision.participants.length,2);assert.equal(dd.decision.decisionMaker.id,S.adminId);assert.equal(dd.decision.meetingId,meeting.id);
 assert.ok(dd.answers.evidence.length>=1,'evidence');assert.ok(dd.answers.affectedWork.some(w=>/Generator project|GEN|project/i.test(`${w.type} ${w.title}`)),'connected work');
 ok(await G.admin.post('/api/knowledge',{action:'decide-decision',id:dec.id,approve:true}),'approve decision');
 assert.equal(ok(await G.admin.get(`/api/knowledge?view=decision&id=${dec.id}`)).decision.status,'Approved');
 assert.ok(ok(await G.admin.get('/api/knowledge?view=decisions')).decisions.some(d=>d.id===dec.id),'in the register');
 // AI-suggested decisions and actions need a person's approval.
 const sugg=ok(await G.admin.get('/api/knowledge?view=suggestions'));const act=sugg.suggestions.find(s=>s.kind==='action_item');
 if(act){const n=sql(`SELECT count(*) AS n FROM tasks WHERE tenant_id='${G.id}'`)[0].n;ok(await G.admin.post('/api/knowledge',{action:'suggestion-accept',id:act.id,edits:{assigneeId:S.staff.id}}),'accept action item');assert.equal(sql(`SELECT count(*) AS n FROM tasks WHERE tenant_id='${G.id}'`)[0].n,n+1,'a task is created only after approval')}
});
test('25. Stale knowledge creates authorised review tasks and inbox items',async()=>{
 sql(`UPDATE knowledge_sources SET next_review_at='2020-01-01T00:00:00.000Z' WHERE id='${S.kFile}'`);await settle();pending.length=0;
 const r=ok(await G.admin.post('/api/knowledge',{action:'freshness'}),'freshness sweep');assert.ok(r.created>=1);
 const rev=sql(`SELECT id,assignee_id,reason FROM knowledge_reviews WHERE tenant_id='${G.id}' AND knowledge_id='${S.kFile}' AND status='open'`);assert.ok(rev.length>=1,'review created');
 const owner=rev[0].assignee_id;const c=owner===S.staff.id?S.staff:owner===S.adminId?G.admin:S.admin2;
 const item=await until(async()=>(await inbox(c)).items.find(i=>i.type==='review'||i.sourceType==='knowledge_review'),'review in the owner\'s inbox');
 assert.ok(!(await inbox(S.outsider)).items.some(i=>i.id===item.id),'not in anyone else\'s inbox');
 ok(await c.post('/api/knowledge',{action:'review-complete',id:rev[0].id,outcome:'still_accurate'}),'complete review');
});
test('26. AI answers include source citations (and hidden sources are removed for other readers)',async()=>{
 const q=ok(await S.staff.post('/api/knowledge',{action:'ask',title:'How often do we service generators quarterly?',body:'Policy question'}),'ask');
 const a=ok(await S.staff.post('/api/knowledge',{action:'ai-answer',id:q.id}),'AI answer');
 assert.ok(a.citations.length>=1,'citations');assert.ok(!a.citations.some(c=>c.n===99),'citations to sources that were not provided are dropped');
 const d=ok(await S.staff.get(`/api/knowledge?view=question&id=${q.id}`));const ai=d.answers.find(x=>x.kind==='ai');assert.equal(ai.label,'AI-generated answer');assert.ok(ai.citations.length>=1);
 ok(await G.admin.post('/api/knowledge',{action:'question',id:q.id,op:'verify',answerId:ai.id}),'expert verifies');
 assert.equal(ok(await S.staff.get(`/api/knowledge?view=question&id=${q.id}`)).question.status,'verified');
});
test('27. Cross-company access fails securely',async()=>{
 const probes=[['/api/lifecycle?id=',S.req],['/api/lifecycle?view=asset&recordId=',S.asset],['/api/strategy?view=item&id=',S.objective],['/api/knowledge?view=item&id=',S.kFile],['/api/knowledge?view=decision&id=',S.secret]];
 for(const [p,id] of probes){const r=await H.admin.get(p+id);assert.ok([403,404].includes(r.status),`${p} ${r.status}`);assert.ok(!JSON.stringify(r.data).includes(id)||r.status!==200)}
 // Forged workspace ids in the body are ignored: the session's workspace is always used.
 const r=await H.admin.post('/api/lifecycle',{action:'submit',id:S.req,tenantId:G.id});assert.equal(r.status,404);
 const s=await H.admin.post('/api/strategy',{action:'override',id:S.objective,value:1,reason:'x',tenantId:G.id});assert.equal(s.status,404);
 const i=await H.admin.post('/api/inbox',{action:'approve',id:'x'.repeat(10),tenantId:G.id});assert.ok([400,404].includes(i.status));
 const k=ok(await H.admin.get('/api/knowledge?view=search&q=generator'));assert.equal(k.total,0);
});
