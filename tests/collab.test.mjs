// Acceptance tests for Spaces, Files, processing, announcements, projects, tasks, messaging, groups,
// connectors (Outlook via local Microsoft mocks) and AI (scenarios 1–23 of the collaboration spec).
// Runs after platform.test.mjs and saas.test.mjs against the same throwaway database.
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client,BASE,rand,strongPassword,tokenFrom,sql as rawSql,settle} from './helpers.mjs';
const pending=[];const sql=q=>{pending.push(1);return rawSql(q)};
beforeEach(async()=>{if(pending.length){pending.length=0;await settle()}});
const MOCK=process.env.OWS_MOCK,OWNER='losharhammond@gmail.com';
const MS_SECRET='ms-client-secret-DO-NOT-LEAK-789';
const owner=new Client();
const C={slug:'ccorp-'+rand(),domain:`ccorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const D={slug:'dcorp-'+rand(),domain:`dcorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const S={};// shared state between scenarios
const ok=(r,msg)=>assert.ok(r.status===200,`${msg||''} ${r.status} ${JSON.stringify(r.data).slice(0,400)}`);
async function activate(link,pw){const r=await new Client().post('/api/auth/activate',{token:tokenFrom(link),password:pw});assert.equal(r.status,200,'activation')}
async function person(co,name,department,extra={}){const email=`${name.toLowerCase().replace(/\W+/g,'.')}.${rand()}@${co.domain}`;const r=await co.admin.post('/api/people',{action:'create',name,email,department,role:'employee',...extra});ok(r,'invite');const pw=strongPassword();await activate(r.data.link,pw);const c=new Client();await c.login(email,pw);c.id=r.data.id;c.email=email;c.department=department;return c}
async function upload(c,name,content,type,fields={}){const fd=new FormData();fd.set('file',new File([content],name,{type}));for(const [k,v] of Object.entries(fields))fd.set(k,typeof v==='string'?v:JSON.stringify(v));for(let i=0;i<8;i++){const r=await fetch(BASE+'/api/files',{method:'POST',headers:{Origin:BASE,Cookie:c.cookie},body:fd});const text=await r.text();if(r.status===503&&text.includes('restarted mid-request')){await new Promise(x=>setTimeout(x,1000));continue}let data={};try{data=JSON.parse(text)}catch{data={_raw:text}}return {status:r.status,data}}throw Error('upload retries exhausted')}
async function waitFile(c,id,states=['ready','partial','failed','unsupported'],ms=150000){const end=Date.now()+ms;let last;while(Date.now()<end){const r=await c.get(`/api/files?id=${id}`);last=r.data?.file?.processing_status;if(states.includes(last))return r.data;await new Promise(x=>setTimeout(x,2500))}throw Error(`file ${id} still ${last}`)}
async function decideUntil(c,id,status){for(let i=0;i<6;i++){const d=(await c.get(`/api/purchasing?id=${id}`)).data.doc;if(d.status===status)return;const r=await c.post('/api/purchasing',{action:'decide',id,decision:'approve',comment:'ok'});ok(r,'decide')}assert.fail(`${id} never reached ${status}`)}

test('setup. Company C (with staff in two departments and a second administrator) and Company D',async()=>{
 await owner.login(OWNER,process.env.OWS_OWNER_PW);
 for(const [co,name] of [[C,'Charlie Works'],[D,'Delta Group']]){
  const r=await owner.post('/api/platform',{action:'create',name,slug:co.slug,domains:co.domain,adminName:`Admin ${co.slug}`,adminEmail:`admin@${co.domain}`,plan:'business',package:'business',defaults:{departments:true,locations:true,roles:true,workflows:true,folders:true,welcome:true}});
  ok(r,'create company');co.id=r.data.id;await activate(r.data.link,co.pw);await co.admin.login(`admin@${co.domain}`,co.pw);
 }
 const s=(await C.admin.get('/api/session')).data;
 for(const p of ['projects','tasks','messages','documents','knowledge'])assert.ok(s.tenant.pages.includes(p),`page ${p} is entitled`);
 const depts=s.departments.map(d=>d.name);assert.ok(depts.length>=2);
 S.deptA=depts.find(d=>/finance/i.test(d))||depts[0];S.deptB=depts.find(d=>d!==S.deptA&&/^it$|information/i.test(d))||depts.find(d=>d!==S.deptA);
 S.fin=await person(C,'Fiona Finance',S.deptA);S.fin2=await person(C,'Frank Finance',S.deptA);S.it=await person(C,'Ivan Tech',S.deptB);
 S.admin2=await person(C,'Second Admin',S.deptA,{role:'admin'});
 S.adminId=s.user.id;
});

test('1. A staff upload defaults to their department (shown before upload and stored on the file)',async()=>{
 const r=await upload(S.fin,`zephyr-budget-${rand()}.txt`,'Zephyr budget forecast for the finance team. Total 42000.','text/plain');ok(r,'upload');S.finFile=r.data.id;
 const d=(await S.fin.get(`/api/files?id=${S.finFile}`)).data;
 assert.equal(d.file.acl.mode,'department');assert.deepEqual(d.file.acl.departments,[S.deptA]);
 const list=(await S.fin.get('/api/files?view=all')).data;assert.equal(list.defaultAcl.mode,'department','the default audience is sent to the upload dialog');
});

test('2. Staff choose individuals, groups, departments or the company as the audience',async()=>{
 const g=await C.admin.post('/api/groups',{action:'save',name:`Pump crew ${rand()}`,description:'Site team',type:'team',visibility:'company',membershipMode:'static'});ok(g,'group');S.group=g.data.id;
 ok(await C.admin.post('/api/groups',{action:'members',id:S.group,add:[S.it.id]}),'members');
 const toPerson=await upload(S.fin,'for-ivan.txt','Personal note for Ivan','text/plain',{acl:{mode:'people',people:[S.it.id]}});ok(toPerson);
 const toGroup=await upload(S.fin,'for-group.txt','Group note','text/plain',{acl:{mode:'groups',groups:[S.group]}});ok(toGroup);
 const toDept=await upload(S.fin,'for-it.txt','Department note','text/plain',{acl:{mode:'departments',departments:[S.deptB]}});ok(toDept);
 for(const id of [toPerson.data.id,toGroup.data.id,toDept.data.id])assert.equal((await S.it.get(`/api/files?id=${id}`)).status,200,'the chosen audience can open it');
 assert.equal((await S.fin2.get(`/api/files?id=${toPerson.data.id}`)).status,404,'people outside the audience cannot');
 // Company-wide sharing by staff follows the company publishing policy (approval when set to administrators).
 ok(await C.admin.post('/api/files',{action:'policy',companyWidePublishing:'admins'}),'policy');
 const co=await upload(S.fin,'for-all.txt','Everyone note','text/plain',{acl:{mode:'company'}});ok(co);
 const fd=(await S.fin.get(`/api/files?id=${co.data.id}`)).data;assert.notEqual(fd.file.acl.mode,'company','company-wide waits for approval');assert.equal(fd.file.pendingAcl?.mode,'company');
 ok(await C.admin.post('/api/files',{action:'approve-access',id:co.data.id}),'approve');
 assert.equal((await S.it.get(`/api/files?id=${co.data.id}`)).status,200);
});

test('3. Another department cannot discover the file by URL, download, preview, signed link, search or AI',async()=>{
 const id=S.finFile;
 for(const p of [`/api/files?id=${id}`,`/api/files?download=${id}`,`/api/files?preview=${id}`,`/api/files?artifact=${id}&kind=text`])assert.equal((await S.it.get(p)).status,404,p);
 assert.equal((await S.it.post('/api/files',{action:'link-url',id})).status,404,'no signed link');
 const list=(await S.it.get('/api/files?view=all')).data.files||[];assert.ok(!list.some(f=>f.id===id),'not listed');
 const search=(await S.it.get('/api/search?q=zephyr')).data.results||[];assert.ok(!search.some(r=>String(r.link).includes(id)),'not in search');
 // A signed link made for the owner cannot be replayed after tampering, and stops working after deletion checks.
 const link=(await S.fin.post('/api/files',{action:'link-url',id})).data.url;assert.ok(link,'owner gets a short-lived link');
 const good=await fetch(BASE+link);assert.equal(good.status,200);
 const u=new URL(BASE+link);const parts=atob(u.searchParams.get('t')).split('.');parts[6]=String(Number(parts[6])+86400);
 const forged=new URL(u);forged.searchParams.set('t',btoa(parts.join('.')));assert.equal((await fetch(forged)).status,403,'a longer expiry cannot be forged');
 const sig=u.searchParams.get('s');const flipped=new URL(u);flipped.searchParams.set('s',(sig[0]==='A'?'B':'A')+sig.slice(1));assert.equal((await fetch(flipped)).status,403,'an altered signature is refused');
 assert.equal((await fetch(BASE+link,{headers:{}})).status,200,'the link itself needs no cookie but expires in minutes');
 const ai=await S.it.stream('/api/ai',{action:'chat',message:'What is the zephyr budget forecast?'});
 assert.equal(ai.status,200);assert.ok(!ai.answer.includes('zephyr-budget'),'the assistant never sees the file');assert.ok(!(ai.done.citations||[]).some(c=>String(c.link).includes(id)));
});

test('4. A Company Administrator can manage all content in their company',async()=>{
 const d=await C.admin.get(`/api/files?id=${S.finFile}`);ok(d);assert.equal(d.data.canEdit,true);
 ok(await C.admin.post('/api/files',{action:'update',id:S.finFile,description:'Checked by admin',tags:'budget'}),'admin edits metadata');
 ok(await C.admin.post('/api/files',{action:'access',id:S.finFile,acl:{mode:'departments',departments:[S.deptA]}}),'admin changes access');
});

test('5–6. Deletion goes to an audited recycle bin; versions can be listed and restored',async()=>{
 const f=await upload(S.fin,`policy-${rand()}.txt`,'Version one text','text/plain');ok(f);const id=f.data.id;
 const fd=new FormData();fd.set('file',new File(['Version two text'],'policy.txt',{type:'text/plain'}));fd.set('replaceId',id);
 const v2=await fetch(BASE+'/api/files',{method:'POST',headers:{Origin:BASE,Cookie:S.fin.cookie},body:fd});assert.equal(v2.status,200);
 let d=(await S.fin.get(`/api/files?id=${id}`)).data;assert.equal(d.file.version,2);assert.ok(d.versions.some(v=>v.version===1),'version 1 kept');
 assert.equal(await (await fetch(`${BASE}/api/files?download=${id}&v=1`,{headers:{Cookie:S.fin.cookie}})).text(),'Version one text');
 ok(await S.fin.post('/api/files',{action:'restore-version',id,version:1}),'restore version');
 assert.equal(await (await fetch(`${BASE}/api/files?download=${id}`,{headers:{Cookie:S.fin.cookie}})).text(),'Version one text');
 ok(await S.fin.post('/api/files',{action:'delete',id}),'delete');
 assert.equal((await S.fin.get(`/api/files?download=${id}`)).status,404,'deleted files are not downloadable');
 assert.ok(((await S.fin.get('/api/files?view=recycle')).data.files||[]).some(x=>x.id===id),'in the recycle bin');
 ok(await S.fin.post('/api/files',{action:'restore',id}),'restore');
 assert.ok(sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${C.id}' AND record_id='${id}' AND action IN ('File moved to the recycle bin','File restored from the recycle bin')`)[0].n>=2);
});

test('7. Audio processing produces a transcript, captions, a summary and detailed notes',async()=>{
 const r=await upload(S.fin,'standup.mp3',new Uint8Array([0x49,0x44,0x33,3,0,0,0,0,0,10,1,2,3,4,5,6,7,8,9,10]),'audio/mpeg');ok(r);S.audio=r.data.id;
 const d=await waitFile(S.fin,S.audio);assert.equal(d.file.processing_status,'ready',d.file.processing_error);
 const tr=(await S.fin.get(`/api/files?artifact=${S.audio}&kind=transcript`)).data;const segs=JSON.parse(tr.content);assert.ok(segs.length>=2&&segs[1].start>0,'timestamped segments');
 const vtt=await fetch(`${BASE}/api/files?artifact=${S.audio}&kind=vtt&download`,{headers:{Cookie:S.fin.cookie}});assert.ok((await vtt.text()).startsWith('WEBVTT'));
 const sum=JSON.parse((await S.fin.get(`/api/files?artifact=${S.audio}&kind=summary`)).data.content);
 assert.ok(sum.short&&sum.detailed&&sum.actionItems.length&&sum.decisions.length,'summary and detailed notes');
});

test('8. Document processing produces extracted text, a summary and citations',async()=>{
 const r=await upload(S.fin,`capex-${rand()}.txt`,'Capital budget for the pump station.\n\nThe budget covers pumps and pipes.','text/plain');ok(r);S.doc=r.data.id;
 const d=await waitFile(S.fin,S.doc);assert.equal(d.file.processing_status,'ready',d.file.processing_error);
 const text=(await S.fin.get(`/api/files?artifact=${S.doc}&kind=text`)).data.content;assert.ok(text.includes('pump station'));
 const sum=JSON.parse((await S.fin.get(`/api/files?artifact=${S.doc}&kind=summary`)).data.content);assert.ok(sum.short);assert.ok(sum.keyPoints.some(k=>k.ref),'citations to sections');
 // A failed extraction never fabricates content.
 const bad=await upload(S.fin,'fake.pdf','not really a pdf','application/pdf');ok(bad);const bd=await waitFile(S.fin,bad.data.id,['failed','unsupported','ready','partial'],60000);
 assert.notEqual(bd.file.processing_status,'ready');assert.equal((await S.fin.get(`/api/files?artifact=${bad.data.id}&kind=summary`)).status,404);
 // A genuine PNG passes the content scan (regression: byte 0x89 was mis-decoded) and is not quarantined.
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64'));
 const img=await upload(S.fin,'site-photo.png',png,'image/png');ok(img);const id=await waitFile(S.fin,img.data.id,['failed','unsupported','ready','partial'],60000);
 assert.ok(!id.file.deleted_at,'not quarantined');assert.ok(!/does not match/.test(id.file.processing_error||''),id.file.processing_error);
 assert.equal((await fetch(`${BASE}/api/files?preview=${img.data.id}`,{headers:{Cookie:S.fin.cookie}})).status,200,'thumbnail/preview served');
});

test('9. Generated content inherits the original access rules',async()=>{
 for(const kind of ['transcript','summary','text','vtt'])assert.equal((await S.it.get(`/api/files?artifact=${S.audio}&kind=${kind}`)).status,404,kind);
 assert.equal((await S.fin2.get(`/api/files?artifact=${S.audio}&kind=summary`)).status,200,'same department can read it');
});

test('10. Announcements target company, department, role, group, project or individuals',async()=>{
 const targets=[['group',{mode:'groups',groups:[S.group]},S.it,S.fin2],['person',{mode:'people',people:[S.fin2.id]},S.fin2,S.it],['department',{mode:'departments',departments:[S.deptB]},S.it,S.fin]];
 for(const [label,acl,yes,no] of targets){
  const r=await C.admin.post('/api/pages',{action:'save',kind:'announcement',title:`Notice for ${label} ${rand()}`,body:'Please read.',acl,requiresAck:true,priority:'High',publish:true});ok(r,label);
  assert.equal((await yes.get(`/api/pages?id=${r.data.id}`)).status,200,`${label}: target can read`);
  assert.equal((await no.get(`/api/pages?id=${r.data.id}`)).status,404,`${label}: others cannot`);
  if(label==='person'){ok(await yes.post('/api/pages',{action:'ack',id:r.data.id}),'ack');const rc=(await C.admin.get(`/api/pages?id=${r.data.id}`)).data.receipts;assert.equal(rc.acknowledged,1)}
 }
 const everyone=await C.admin.post('/api/pages',{action:'save',kind:'announcement',title:'Company notice',body:'All staff',acl:{mode:'company'},publish:true});ok(everyone);
 for(const c of [S.fin,S.it])assert.equal((await c.get(`/api/pages?id=${everyone.data.id}`)).status,200);
 const roleAcl=await C.admin.post('/api/pages',{action:'save',kind:'announcement',title:'Admins only',body:'x',acl:{mode:'roles',roles:['admin']},publish:true});ok(roleAcl);
 assert.equal((await S.fin.get(`/api/pages?id=${roleAcl.data.id}`)).status,404);assert.equal((await S.admin2.get(`/api/pages?id=${roleAcl.data.id}`)).status,200);
 // Scheduled announcements are invisible to readers until published.
 const later=await C.admin.post('/api/pages',{action:'save',kind:'announcement',title:'Later',body:'x',acl:{mode:'company'},publish:true,publishAt:new Date(Date.now()+86400000).toISOString()});ok(later);
 assert.equal((await S.fin.get(`/api/pages?id=${later.data.id}`)).status,404,'scheduled content is hidden');
});

test('11 & 13. A physical project runs from request and budget through PR, PO, receipt to closure, with real finance',async()=>{
 const p=await C.admin.post('/api/projects',{action:'create',name:`Pump station ${rand()}`,type:'capital',department:S.deptA,description:'Replace the main pump',managerId:S.adminId});ok(p,'project');S.project=p.data.id;
 const move=async(to,extra={})=>{const r=await C.admin.post('/api/projects',{action:'transition',id:S.project,to,...extra});ok(r,`move to ${to}`);return r.data};
 assert.equal((await C.admin.post('/api/projects',{action:'transition',id:S.project,to:'business-case'})).status,400,'required information is enforced');
 ok(await C.admin.post('/api/projects',{action:'update',id:S.project,businessCase:'Old pump fails weekly',approvedBudget:50000,startDate:'2026-10-01',targetDate:'2026-12-31'}));
 await move('business-case');await move('budget-approval');await move('planning');await move('procurement');
 ok(await C.admin.post('/api/projects',{action:'members',id:S.project,add:[S.fin.id],role:'member'}),'team');
 const budget=await C.admin.post('/api/purchasing',{action:'budget',name:'Pump station capex',department:S.deptA,costCentre:'CAPEX',periodStart:'2026-01-01',periodEnd:'2026-12-31',amount:50000,currency:'GHS'});ok(budget,'budget');S.budget=budget.data.id;
 ok(await C.admin.post('/api/projects',{action:'link',id:S.project,type:'budget',recordId:S.budget}),'project budget link');
 // Requisition raised by project staff, approved, converted, approved, issued and received.
 const pr=await S.fin.post('/api/purchasing',{action:'save',kind:'PR',title:'New pump',department:S.deptA,projectId:S.project,budgetId:S.budget,lines:[{description:'Pump',qty:2,unit:'ea',unitPrice:1000,taxRate:0}],submit:true});ok(pr,'PR');
 await decideUntil(C.admin,pr.data.id,'Approved');
 const po=await C.admin.post('/api/purchasing',{action:'convert',id:pr.data.id});ok(po,'convert');
 ok(await C.admin.post('/api/purchasing',{action:'submit',id:po.data.id}),'submit PO');await decideUntil(S.admin2,po.data.id,'Approved');
 ok(await C.admin.post('/api/purchasing',{action:'issue',id:po.data.id}),'issue');
 const lines=(await C.admin.get(`/api/purchasing?id=${po.data.id}`)).data.lines;
 const receipt=await C.admin.post('/api/purchasing',{action:'receive',id:po.data.id,lines:[{lineId:lines[0].id,qty:1,createAssets:1,assetCategory:'Pump'}]});ok(receipt,'receive');
 ok(await C.admin.post('/api/projects',{action:'cost',id:S.project,kind:'expense',description:'Crane hire',amount:500,date:'2026-10-05'}),'expense');
 const f=(await C.admin.get(`/api/projects?id=${S.project}`)).data.finance;
 assert.equal(f.approved,50000);assert.equal(f.requested,2000);assert.equal(f.ordered,2000);assert.equal(f.received,1000);assert.equal(f.committed,1000,'the unreceived part of the order');
 assert.equal(f.actual,1500);assert.equal(f.remaining,47500);assert.equal(f.forecastAtCompletion,2500);assert.equal(f.variance,47500);
 assert.ok(f.documents.some(d=>d.id===po.data.id),'the PO inherited the project link');
 const decision=await C.admin.post('/api/projects',{action:'record',id:S.project,kind:'decision',title:'Use the approved pump specification',body:'The replacement follows the engineering review.'});ok(decision,'project decision');
 const task=await C.admin.post('/api/tasks',{action:'save',projectId:S.project,title:'Install replacement pump',assignees:[S.fin.id]});ok(task,'project task');
 ok(await C.admin.post('/api/files',{action:'link',id:S.finFile,entityType:'project',entityId:S.project}),'project file link');
 const asset=sql(`SELECT id FROM assets WHERE tenant_id='${C.id}' AND purchase_doc_id='${po.data.id}' ORDER BY created_at DESC LIMIT 1`)[0];assert.ok(asset,'receipt created an asset linked to its purchase order');
 const workOrder=await C.admin.post('/api/maintenance',{action:'order',assetId:asset.id,title:'Inspect pump on arrival',department:S.deptA});ok(workOrder,'asset maintenance order');
 const projectGraph=await C.admin.get(`/api/graph?id=${S.project}&type=project&depth=1`);ok(projectGraph,'project graph context');const projectTypes=new Set(projectGraph.data.graph.nodes.map(n=>n.type));
 for(const type of ['person','budget','PR','PO','task','file','decision','asset'])assert.ok(projectTypes.has(type),`project context includes authorized ${type} records`);
 assert.equal((await S.it.get(`/api/graph?id=${S.project}&type=project`)).status,404,'another department cannot discover the project graph');assert.equal((await D.admin.get(`/api/graph?id=${S.project}&type=project`)).status,404,'another workspace cannot open the project graph');
 const assetGraph=await C.admin.get(`/api/graph?id=${asset.id}&type=asset&depth=2`);ok(assetGraph,'asset graph context');const assetTypes=new Set(assetGraph.data.graph.nodes.map(n=>n.type));
 for(const type of ['PO','project','work_order'])assert.ok(assetTypes.has(type),`asset context includes purchase/project/maintenance link: ${type}`);
 await move('execution');await move('handover');await move('closure');
 const d=(await C.admin.get(`/api/projects?id=${S.project}`)).data;assert.equal(d.project.stage,'closure');assert.ok(d.project.actual_end);assert.ok(d.history.length>=8);
 assert.equal((await S.it.get(`/api/projects?id=${S.project}`)).status,404,'other departments cannot see the project');
});

test('12. An internal IT project uses backlog, tasks, milestones, testing and release (with an approval gate)',async()=>{
 const p=await C.admin.post('/api/projects',{action:'create',name:`Portal ${rand()}`,type:'it',methodology:'scrum',department:S.deptB,description:'Customer portal',managerId:S.it.id});ok(p);const id=p.data.id;
 for(const [kind,title] of [['epic','Accounts'],['story','Sign in'],['bug','Crash on logout'],['sprint','Sprint 1'],['test','Login tests'],['release','v1.0'],['deployment','Production checklist']])ok(await S.it.post('/api/projects',{action:'record',id,kind,title}),kind);
 const t1=await S.it.post('/api/tasks',{action:'save',title:'Build sign in',projectId:id,startDate:'2026-10-01',dueDate:'2026-10-05'});ok(t1);
 const t2=await S.it.post('/api/tasks',{action:'save',title:'Release v1.0',projectId:id,milestone:true,startDate:'2026-10-06',dueDate:'2026-10-06'});ok(t2);
 ok(await S.it.post('/api/tasks',{action:'dependency',id:t2.data.id,dependsOn:t1.data.id}));
 assert.equal((await S.it.post('/api/tasks',{action:'dependency',id:t1.data.id,dependsOn:t2.data.id})).status,400,'dependency loops refused');
 assert.equal((await S.it.post('/api/tasks',{action:'status',id:t2.data.id,status:'Done'})).status,409,'blocked by the unfinished dependency');
 const d=(await S.it.get(`/api/projects?id=${id}`)).data;assert.deepEqual(d.criticalPath.taskIds,[t1.data.id,t2.data.id]);
 // The approval stage waits for an approver when the manager is not one.
 ok(await S.it.post('/api/projects',{action:'transition',id,to:'review'}));
 const pend=await S.it.post('/api/projects',{action:'transition',id,to:'approval'});ok(pend);assert.equal(pend.data.pending,true);
 ok(await C.admin.post('/api/projects',{action:'approve-stage',id}),'approved');
 for(const to of ['planning','execution','testing','release'])ok(await S.it.post('/api/projects',{action:'transition',id,to}),to);
 assert.equal((await S.it.get(`/api/projects?id=${id}`)).data.project.stage,'release');
});

test('14. Tasks work in list, board (status), calendar (dates) and project views; staff see only allowed tasks',async()=>{
 const mine=await S.fin.post('/api/tasks',{action:'save',title:`Reconcile ${rand()}`,dueDate:'2026-10-10',checklist:['Bank','Cash']});ok(mine);
 const assigned=await C.admin.post('/api/tasks',{action:'save',title:'Assigned to Fiona',assignees:[S.fin.id],dueDate:'2020-01-01'});ok(assigned);
 const list=(await S.fin.get('/api/tasks?view=mine')).data.tasks;assert.ok(list.some(t=>t.id===mine.data.id)&&list.some(t=>t.id===assigned.data.id));
 assert.ok((await S.fin.get('/api/tasks?view=overdue')).data.tasks.some(t=>t.id===assigned.data.id));
 ok(await S.fin.post('/api/tasks',{action:'status',id:mine.data.id,status:'In progress'}),'board move');
 const cl=(await S.fin.get(`/api/tasks?id=${mine.data.id}`)).data.checklist;ok(await S.fin.post('/api/tasks',{action:'checklist',id:mine.data.id,op:'toggle',itemId:cl[0].id}));
 ok(await S.fin.post('/api/tasks',{action:'time',id:mine.data.id,minutes:30}),'time');
 const proj=(await C.admin.get(`/api/tasks?view=all&project=${S.project}`)).data;assert.ok(Array.isArray(proj.tasks));
 assert.equal((await S.it.get(`/api/tasks?id=${mine.data.id}`)).status,404,'private tasks stay private');
 assert.equal((await S.it.get(`/api/tasks?view=all&project=${S.project}`)).status,404);
 const bulk=await S.it.post('/api/tasks',{action:'bulk',ids:[mine.data.id],op:'status',value:'Done'});assert.equal(bulk.data.results[0].ok,false,'bulk edits respect permissions');
});

test('15. Company, department, project, group and direct messaging',async()=>{
 const chans=async c=>(await c.get('/api/messages')).data.channels;
 const general=(await chans(S.fin)).find(c=>c.kind==='company');const finDept=(await chans(S.fin)).find(c=>c.kind==='department');
 ok(await S.fin.post('/api/messages',{action:'send',channelId:general.id,body:'Hello everyone @Ivan'}),'company');
 assert.ok((await S.it.get(`/api/messages?channel=${general.id}`)).data.messages.some(m=>m.body.includes('Hello everyone')));
 ok(await S.fin.post('/api/messages',{action:'send',channelId:finDept.id,body:'Finance only'}),'department');
 assert.equal((await S.it.get(`/api/messages?channel=${finDept.id}`)).status,404,'other departments cannot read it');
 const proj=await C.admin.post('/api/messages',{action:'create',kind:'project',name:'pump',refId:S.project});ok(proj);
 ok(await S.fin.post('/api/messages',{action:'send',channelId:proj.data.id,body:'Pump arrives Friday'}),'project team member');
 assert.equal((await S.it.get(`/api/messages?channel=${proj.data.id}`)).status,404);
 const grp=await C.admin.post('/api/messages',{action:'create',kind:'group',name:'crew',refId:S.group});ok(grp);
 ok(await S.it.post('/api/messages',{action:'send',channelId:grp.data.id,body:'Crew ready'}),'group member');
 assert.equal((await S.fin.get(`/api/messages?channel=${grp.data.id}`)).status,404);
 const dm=await S.fin.post('/api/messages',{action:'dm',memberId:S.fin2.id});ok(dm);
 const sent=await S.fin.post('/api/messages',{action:'send',channelId:dm.data.id,body:'Lunch?'});ok(sent);
 assert.equal((await S.it.get(`/api/messages?channel=${dm.data.id}`)).status,404,'DMs are private');
 const list2=await chans(S.fin2);assert.ok(list2.find(c=>c.id===dm.data.id).unread>=1,'unread count');
 ok(await S.fin2.post('/api/messages',{action:'send',channelId:dm.data.id,threadId:sent.data.id,body:'Yes'}),'thread reply');
 ok(await S.fin2.post('/api/messages',{messageId:sent.data.id,action:'react',emoji:'👍'}));
 assert.equal((await S.fin2.post('/api/messages',{messageId:sent.data.id,action:'edit',body:'hacked'})).status,403,'only authors edit');
 ok(await S.fin.post('/api/messages',{messageId:sent.data.id,action:'delete'}));
 const after=(await S.fin2.get(`/api/messages?channel=${dm.data.id}`)).data.messages.find(m=>m.id===sent.data.id);assert.equal(after.deleted,true);assert.equal(after.body,'');
 assert.ok(((await S.fin.get('/api/messages?search=Pump%20arrives')).data.results||[]).length>=1,'search');
 // Attachments are re-shared with exactly the channel audience.
 const att=await upload(S.fin,'photo-note.txt','site photo note','text/plain',{acl:{mode:'private'}});ok(att);
 ok(await S.fin.post('/api/messages',{action:'send',channelId:dm.data.id,body:'See file',fileIds:[att.data.id]}));
 assert.equal((await S.fin2.get(`/api/files?id=${att.data.id}`)).status,200);assert.equal((await S.it.get(`/api/files?id=${att.data.id}`)).status,404);
 const ann=await C.admin.post('/api/messages',{action:'create',kind:'announcement',name:'news',members:[S.fin.id]});ok(ann);
 assert.equal((await S.fin.post('/api/messages',{action:'send',channelId:ann.data.id,body:'x'})).status,403,'announcement-only');
});

test('16. Groups are created, edited, archived, restored, used, protected from deletion and replaced',async()=>{
 ok(await C.admin.post('/api/groups',{action:'save',id:S.group,name:'Pump crew (site)',membershipMode:'static',visibility:'company'}),'edit');
 const dyn=await C.admin.post('/api/groups',{action:'save',name:`All ${S.deptA} ${rand()}`,membershipMode:'dynamic',rules:{departments:[S.deptA]}});ok(dyn);
 const m=(await C.admin.get(`/api/groups?id=${dyn.data.id}`)).data.members.map(x=>x.id);assert.ok(m.includes(S.fin.id)&&!m.includes(S.it.id),'dynamic rules');
 const del=await C.admin.post('/api/groups',{action:'delete',id:S.group});assert.equal(del.status,409,'referenced groups cannot be deleted');
 ok(await C.admin.post('/api/groups',{action:'archive',id:S.group}));ok(await C.admin.post('/api/groups',{action:'restore',id:S.group}));
 ok(await C.admin.post('/api/groups',{action:'replace',id:S.group,replacementId:dyn.data.id}),'replace');
 ok(await C.admin.post('/api/groups',{action:'delete',id:S.group}),'now deletable');
 assert.equal((await S.fin.post('/api/groups',{action:'save',name:'Nope'})).status,403,'staff cannot manage groups');
 assert.ok(sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${C.id}' AND action IN ('Group created','Group archived','Group restored','Group deleted','Group replaced in audiences')`)[0].n>=4);
});

test('17–19. Outlook: only granted capabilities, confirmed and audited actions, secrets never exposed',async()=>{
 const reg=await owner.post('/api/connectors',{action:'create',scope:'platform',provider:'microsoft365',name:'Platform Microsoft app',config:{clientId:'mock-client-id'},secrets:{clientSecret:MS_SECRET}});ok(reg,'platform app');
 await fetch(MOCK+'/__ms-grant',{method:'POST',body:JSON.stringify({scope:'offline_access User.Read Mail.Read Calendars.Read'})});
 const c=await S.admin2.post('/api/connectors',{action:'create',provider:'outlook',level:'user',capabilities:['mail.read','mail.send','calendar.read','calendar.write']});ok(c,'personal connector');S.conn=c.data.id;
 const start=await S.admin2.post('/api/connectors',{action:'oauth-start',id:S.conn});ok(start);
 const auth=new URL(start.data.url);assert.ok(auth.searchParams.get('scope').includes('Mail.Send'),'least-privilege scopes requested for the chosen capabilities');assert.ok(!auth.searchParams.get('scope').includes('Contacts'));
 const cb=await fetch(`${BASE}/api/connectors/oauth?code=abc&state=${auth.searchParams.get('state')}`,{redirect:'manual',headers:{Cookie:S.admin2.cookie}});
 assert.equal(cb.status,302);assert.ok(cb.headers.get('location').includes('Connected'),cb.headers.get('location'));
 // The user granted less than requested: sending and meeting changes are not offered.
 const caps=(await S.admin2.get(`/api/mail?connector=${S.conn}&op=capabilities`)).data;assert.deepEqual(caps.capabilities.sort(),['calendar.read','mail.read']);assert.equal(caps.account,'pat@contoso.test');
 assert.equal((await S.admin2.post('/api/mail',{connector:S.conn,action:'send',to:['x@y.test'],subject:'Hi',body:'x',confirm:true})).status,403,'not granted');
 const inbox=(await S.admin2.get(`/api/mail?connector=${S.conn}&op=list`)).data.messages;assert.equal(inbox[0].subject,'Pump project quote');
 assert.equal((await C.admin.get(`/api/mail?connector=${S.conn}&op=list`)).status,404,'personal connections are only for their owner');
 // Reconnect after the user grants sending and calendar writes.
 await fetch(MOCK+'/__ms-grant',{method:'POST',body:JSON.stringify({scope:'offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite'})});
 const again=new URL((await S.admin2.post('/api/connectors',{action:'oauth-start',id:S.conn})).data.url);
 await fetch(`${BASE}/api/connectors/oauth?code=def&state=${again.searchParams.get('state')}`,{redirect:'manual',headers:{Cookie:S.admin2.cookie}});
 const first=await S.admin2.post('/api/mail',{connector:S.conn,action:'send',to:['client@example.test'],subject:'Quote accepted',body:'Thanks'});
 assert.equal(first.data.needsConfirmation,true,'sending needs confirmation');
 const key='idem-'+rand()+rand();
 ok(await S.admin2.post('/api/mail',{connector:S.conn,action:'send',to:['client@example.test'],subject:'Quote accepted',body:'Thanks',confirm:true,idempotencyKey:key}),'send');
 const replay=await S.admin2.post('/api/mail',{connector:S.conn,action:'send',to:['client@example.test'],subject:'Quote accepted',body:'Thanks',confirm:true,idempotencyKey:key});assert.equal(replay.data.replayed,true,'idempotent');
 const mlog=await (await fetch(MOCK+'/__log')).json();assert.equal(mlog.filter(e=>e.path==='/ms-graph/v1.0/me/sendMail').length,1,'sent exactly once');
 assert.equal((await S.admin2.post('/api/mail',{connector:S.conn,action:'event-create',subject:'Site visit',start:'2026-10-02T09:00:00',end:'2026-10-02T10:00:00'})).data.needsConfirmation,true);
 ok(await S.admin2.post('/api/mail',{connector:S.conn,action:'event-create',subject:'Site visit',start:'2026-10-02T09:00:00',end:'2026-10-02T10:00:00',confirm:true}),'meeting');
 assert.ok(sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${C.id}' AND action LIKE 'Connected mailbox:%'`)[0].n>=2,'audited');
 // 19: tokens and secrets never reach the browser, the database in plaintext, or the logs.
 const view=JSON.stringify((await S.admin2.get(`/api/connectors?id=${S.conn}`)).data)+JSON.stringify((await owner.get(`/api/connectors?scope=platform`)).data);
 const secrets=[MS_SECRET,'ms-access-DO-NOT-LEAK','ms-refresh-DO-NOT-LEAK'];
 for(const s of secrets)assert.ok(!view.includes(s),`${s} in an API response`);
 const db=JSON.stringify(sql("SELECT * FROM connectors"));for(const s of secrets)assert.ok(!db.includes(s),'plaintext in the database');
 const log=readFileSync(process.env.OWS_LOG,'utf8');for(const s of secrets)assert.ok(!log.includes(s),'secret in the server log');
});

test('20–21. AI answers authorized questions with citations and cannot reach inaccessible or cross-company data',async()=>{
 const r=await S.fin.stream('/api/ai',{action:'chat',message:'Summarise the capex pump station budget document'});
 assert.equal(r.status,200);assert.ok((r.done.citations||[]).some(c=>String(c.link).includes(S.doc)),JSON.stringify(r.done).slice(0,600));
 const other=await D.admin.stream('/api/ai',{action:'chat',message:'capex pump station budget zephyr'});
 assert.equal(other.status,200);assert.ok(!(other.done.citations||[]).some(c=>String(c.link).includes(S.doc)||String(c.link).includes(S.finFile)),'no cross-company citations');
 const ai=await S.fin.post('/api/ai',{action:'run',id:'project.finance',entityId:S.project});assert.equal(ai.status,200,JSON.stringify(ai.data));
 assert.equal((await S.it.post('/api/ai',{action:'run',id:'project.status',entityId:S.project})).status,404,'no AI access to projects you cannot see');
 assert.equal((await S.it.post('/api/ai',{action:'run',id:'file.summarize',entityId:S.audio})).status,404);
});

test('22–23. Platform Owner works across modules via an audited session; company admins cannot cross companies',async()=>{
 assert.equal((await D.admin.get(`/api/projects?id=${S.project}`)).status,404);assert.equal((await D.admin.get(`/api/files?id=${S.finFile}`)).status,404);
 const dg=(await D.admin.get('/api/groups')).data.groups||[];assert.ok(!dg.some(g=>g.id===S.group));
 ok(await owner.post('/api/platform',{action:'support-start',id:C.id,reason:'Acceptance test support check'}),'support session');
 for(const p of [`/api/projects?id=${S.project}`,`/api/files?id=${S.finFile}`,'/api/messages','/api/tasks?view=all','/api/spaces'])assert.equal((await owner.get(p)).status,200,p);
 ok(await owner.post('/api/platform',{action:'support-end'}));
 assert.ok(sql(`SELECT count(*) AS n FROM support_sessions WHERE tenant_id='${C.id}' AND ended_at IS NOT NULL`)[0].n>=1);
});

test('Spaces hub lists announcements, files, tasks, projects, members and calendar for its members',async()=>{
 const list=(await S.fin.get('/api/spaces')).data.spaces;const dept=list.find(s=>s.kind==='department'&&s.department===S.deptA);assert.ok(dept);
 const hub=(await S.fin.get(`/api/spaces?id=${dept.id}`)).data;for(const k of ['announcements','pages','files','tasks','projects','members','calendar','activity'])assert.ok(Array.isArray(hub[k]),k);
 assert.ok(hub.files.some(f=>f.id===S.doc),'department files appear in the department space');
 const itHub=(await S.it.get(`/api/spaces?id=${dept.id}`));assert.ok(itHub.status===404||!itHub.data.files.some(f=>f.id===S.doc),'no leak through another space');
});

test('Archive, task templates, saved filters and presence',async()=>{
 const f=await upload(S.fin,`old-${rand()}.txt`,'old report','text/plain');ok(f);
 ok(await S.fin.post('/api/files',{action:'archive',id:f.data.id}),'archive');
 assert.ok(!((await S.fin.get('/api/files?view=all')).data.files||[]).some(x=>x.id===f.data.id),'archived files leave everyday lists');
 assert.ok(((await S.fin.get('/api/files?view=archived')).data.files||[]).some(x=>x.id===f.data.id),'and appear under Archived');
 const bulk=await S.fin.post('/api/files',{action:'bulk',op:'unarchive',ids:[f.data.id]});assert.equal(bulk.data.results[0].ok,true);
 assert.equal((await S.it.post('/api/files',{action:'archive',id:S.doc})).status,404,'no archiving what you cannot see');
 const t=await S.fin.post('/api/tasks',{action:'template-save',name:'Month end',payload:{title:'Month-end close',priority:'High',checklist:['Accruals','Bank']}});ok(t);
 assert.equal((await S.fin.post('/api/tasks',{action:'template-save',name:'Shared',shared:true,payload:{title:'x'}})).status,403,'staff cannot share templates');
 const list=(await S.fin.get('/api/tasks?view=templates')).data.templates;assert.ok(list.some(x=>x.id===t.data.id&&x.payload.checklist.length===2));
 assert.ok(!(await S.it.get('/api/tasks?view=templates')).data.templates.some(x=>x.id===t.data.id),'personal templates stay personal');
 ok(await S.fin.post('/api/views',{grid:'tasks',name:'High priority',state:{prio:'High',status:'open'}}),'saved filter');
 assert.ok((await S.fin.get('/api/views?grid=tasks')).data.views.some(v=>v.name==='High priority'));
 const dm=await S.fin.post('/api/messages',{action:'dm',memberId:S.fin2.id});ok(await S.fin2.post('/api/messages',{action:'read',channelId:dm.data.id}));
 const d=(await S.fin.get(`/api/messages?channel=${dm.data.id}`)).data;assert.equal(d.presence,true);assert.equal(d.members.find(m=>m.id===S.fin2.id).online,true,'recently active');
});
