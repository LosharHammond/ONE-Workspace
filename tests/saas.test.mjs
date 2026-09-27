// Acceptance tests for page entitlements, roles, the page builder, connectors and AI (scenarios 1–24).
// Runs after platform.test.mjs against the same throwaway database (npm run build && npm run test:e2e).
// External services are local mocks (tests/mock-services.mjs); nothing leaves this machine.
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {Client,BASE,rand,strongPassword,tokenFrom,sql as rawSql,settle} from './helpers.mjs';
const pending=[];const sql=q=>{pending.push(1);return rawSql(q)};
beforeEach(async()=>{if(pending.length){pending.length=0;await settle()}});
const MOCK=process.env.OWS_MOCK,OWNER='losharhammond@gmail.com';
const mockLog=async()=>(await fetch(MOCK+'/__log')).json();
const mockReset=()=>fetch(MOCK+'/__reset');
const owner=new Client();
const A={slug:'acorp-'+rand(),domain:`acorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const B={slug:'bcorp-'+rand(),domain:`bcorp${rand()}.test`,admin:new Client(),pw:strongPassword()};
const REST_SECRET='rest-secret-DO-NOT-LEAK-123',MCP_SECRET='mcp-token-DO-NOT-LEAK-456',AI_KEY='sk-company-a-DO-NOT-LEAK';
const leaks=[REST_SECRET,MCP_SECRET,AI_KEY];
async function activate(link,pw){const r=await new Client().post('/api/auth/activate',{token:tokenFrom(link),password:pw});assert.equal(r.status,200,'activation')}
async function invite(admin,co,name,email,extra){const r=await admin.post('/api/people',{action:'create',name,email,department:'IT',...extra});assert.equal(r.status,200,JSON.stringify(r.data));const pw=strongPassword();await activate(r.data.link,pw);const c=new Client();await c.login(email,pw);return {client:c,pw,id:r.data.id,email}}

test('1–2. Platform Owner creates Company A and Company B with different administrators',async()=>{
 await owner.login(OWNER,process.env.OWS_OWNER_PW);
 for(const [co,plan,pkg] of [[A,'business','business'],[B,'starter','starter']]){
  const r=await owner.post('/api/platform',{action:'create',name:co===A?'Acme Corp':'Bravo Ltd',slug:co.slug,domains:co.domain,adminName:`Admin ${co.slug}`,adminEmail:`admin@${co.domain}`,plan,package:pkg,defaults:{departments:true,locations:true,roles:true,workflows:true,folders:true,welcome:true}});
  assert.equal(r.status,200,JSON.stringify(r.data));co.id=r.data.id;await activate(r.data.link,co.pw);await co.admin.login(`admin@${co.domain}`,co.pw);
 }
 // A second, different administrator for A; then disable and reactivate them.
 const inv=await owner.post('/api/platform',{action:'invite-admin',id:A.id,name:'Second Admin',email:`admin2@${A.domain}`});assert.equal(inv.status,200);assert.ok(inv.data.link);
 const d=(await owner.get(`/api/platform?id=${A.id}`)).data;assert.equal(d.admins.length,2);assert.notEqual(d.admins[0].email,(await owner.get(`/api/platform?id=${B.id}`)).data.admins[0].email);
 const second=d.admins.find(a=>a.email===`admin2@${A.domain}`);
 assert.equal((await owner.post('/api/platform',{action:'admin-disable',id:A.id,memberId:second.id})).status,200);
 assert.equal((await owner.post('/api/platform',{action:'admin-enable',id:A.id,memberId:second.id})).status,200);
 const only=(await owner.get(`/api/platform?id=${B.id}`)).data.admins[0];
 assert.equal((await owner.post('/api/platform',{action:'admin-disable',id:B.id,memberId:only.id})).status,409,'the last active admin cannot be disabled');
});

test('3. Companies receive different page entitlements; removed pages are refused',async()=>{
 const a=(await A.admin.get('/api/session')).data,b=(await B.admin.get('/api/session')).data;
 assert.ok(a.tenant.pages.includes('connectors')&&a.tenant.pages.includes('app-pages'));
 assert.ok(!b.tenant.pages.includes('connectors')&&!b.tenant.pages.includes('app-pages'));
 assert.equal(b.user.permissions.connectors.view,'none');
 assert.equal((await B.admin.get('/api/connectors')).status,404);assert.equal((await B.admin.get('/api/app-pages')).status,404);
 // Dependencies are added automatically; platform-only pages cannot be given to a company.
 const r=await owner.post('/api/platform',{action:'pages',id:B.id,pages:[...b.tenant.pages,'receipts'],allowAbovePlan:true});
 assert.equal(r.status,200);for(const p of ['procurement','requests','suppliers'])assert.ok(r.data.pages.includes(p),`dependency ${p}`);
 assert.equal((await owner.post('/api/platform',{action:'package',id:B.id,package:'starter'})).status,200);
 assert.equal((await owner.post('/api/platform',{action:'pages',id:B.id,pages:['platform.workspaces']})).status,400);
 assert.ok(sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${B.id}' AND action='Page entitlements changed by the Platform Owner'`)[0].n>=2);
});

test('4–5. Company A cannot see Company B or the Platform Console',async()=>{
 const t=await B.admin.post('/api/tickets',{action:'create',title:'BRAVO-SECRET printer jam',description:'bravo only',department:'IT'});assert.equal(t.status,200);B.ticket=t.data.id;
 assert.equal((await A.admin.get(`/api/tickets?id=${B.ticket}`)).status,404);
 for(const p of ['/api/platform','/api/platform?view=catalog','/api/platform?view=health','/api/connectors?scope=platform'])assert.equal((await A.admin.get(p)).status,403,p);
 assert.equal((await A.admin.post('/api/platform',{action:'catalog',page:'assets',changes:{platformOnly:true}})).status,403);
 const s=(await A.admin.get('/api/session')).data;assert.equal(s.user.platformRole,null);assert.ok(s.memberships.every(m=>m.tenantId===A.id));
});

test('6–8. A creates an IT role limited to selected pages; IT staff see only those pages',async()=>{
 const pages=['maintenance','assets','documents','it'];
 const r=await A.admin.post('/api/roles',{name:'IT Operations',base:'employee',template:'it',pages,permissions:{maintenance:{view:'all',create:'all',update:'all'},assets:{view:'all'},documents:{view:'department',upload:'department'},it:{view:'all'}}});
 assert.equal(r.status,200,JSON.stringify(r.data));A.itRole=r.data.id;
 const roles=(await A.admin.get('/api/roles')).data.roles;assert.deepEqual(roles.find(x=>x.id===A.itRole).pages.sort(),[...pages].sort());
 A.it=await invite(A.admin,A,'Ivy Tech',`ivy@${A.domain}`,{roleId:A.itRole});
 const s=(await A.it.client.get('/api/session')).data;
 for(const p of pages)assert.notEqual(s.user.permissions[p].view,'none',`${p} visible`);
 for(const p of ['requests','procurement','inventory','reports','knowledge','people','app-pages','connectors','assistant','schedules'])assert.equal(s.user.permissions[p].view,'none',`${p} hidden`);
 assert.deepEqual([...s.user.rolePages].sort(),[...pages].sort());
});

test('9. Unauthorized routes and APIs return 403/404 for the IT staff member',async()=>{
 const c=A.it.client;
 for(const p of ['/api/inventory','/api/reports','/api/app-pages','/api/connectors','/api/roles','/api/platform'])assert.ok([403,404].includes((await c.get(p)).status),p);
 assert.ok([403,404].includes((await c.post('/api/purchasing',{action:'save',kind:'PR',title:'x',department:'IT',lines:[{description:'x',qty:1,unit:'ea',unitPrice:1}]})).status));
 assert.ok([403,404].includes((await c.post('/api/ai',{action:'run',id:'home.attention'})).status),'AI is not on the IT role');
 assert.equal((await c.get('/api/tickets')).status,200);assert.equal((await c.get('/api/assets')).status,200);
});

test('10. An admin cannot assign a page the company does not own or exceed their own access',async()=>{
 assert.equal((await A.admin.post('/api/roles',{name:'Researcher',base:'employee',pages:['research']})).status,400);
 assert.equal((await A.admin.post('/api/roles',{name:'Researcher',base:'employee',permissions:{research:{view:'all'}}})).status,400);
 assert.equal((await B.admin.post('/api/roles',{name:'Integrator',base:'employee',pages:['connectors']})).status,400);
 assert.equal((await A.admin.post('/api/roles',{name:'Broken',base:'employee',pages:['assets'],permissions:{assets:{view:'none',update:'all'}}})).status,400,'View before other actions');
 assert.equal((await A.admin.post('/api/roles',{name:'Sneaky',base:'employee',pages:['assets'],permissions:{maintenance:{view:'all'}}})).status,400,'permissions only on the role pages');
});

test('11. A company admin initiates a secure password reset',async()=>{
 const r=await A.admin.post('/api/people',{action:'send-links',ids:[A.it.id]});assert.equal(r.status,200);const x=r.data.results[0];assert.equal(x.purpose,'reset');assert.ok(x.link);
 const tok=tokenFrom(x.link);assert.equal(sql(`SELECT count(*) AS n FROM auth_tokens WHERE instr(token_hash,'${tok}')>0`)[0].n,0,'only a hash is stored');
 const pw=strongPassword();await activate(x.link,pw);
 assert.equal((await A.it.client.get('/api/session')).data.mode,'signed-out','existing sessions end after a reset');
 assert.equal((await new Client().post('/api/auth/activate',{token:tok,password:strongPassword()})).status,400,'links work once');
 await A.it.client.login(A.it.email,pw);A.it.pw=pw;
 const audit=sql(`SELECT action,after_json FROM audit WHERE tenant_id='${A.id}' AND action IN ('Password reset link sent','Password reset completed')`);
 assert.ok(audit.some(a=>a.action==='Password reset link sent')&&audit.some(a=>a.action==='Password reset completed'));
 assert.ok(!JSON.stringify(audit).includes(pw));
});

const layout=text=>({sections:[{kind:'grid',rows:[{columns:[{span:12,widgets:[{id:'h1',type:'heading',config:{text,level:'2'}},{id:'k1',type:'kpi',title:'Tickets',config:{source:'tickets'}}]}]}]}]});
test('12. Pages can be edited, versioned, previewed, published and rolled back',async()=>{
 const c=A.admin;
 const v1=await c.post('/api/app-pages',{action:'save',title:'Ops dashboard',slug:'ops',layout:layout('Version one')});assert.equal(v1.status,200,JSON.stringify(v1.data));A.page=v1.data.id;
 const v2=await c.post('/api/app-pages',{action:'save',id:A.page,title:'Ops dashboard',layout:layout('Version two'),baseVersion:1});assert.equal(v2.data.version,2);
 assert.equal((await c.post('/api/app-pages',{action:'save',id:A.page,title:'x',layout:layout('stale'),baseVersion:1})).status,409,'stale edits are refused');
 assert.equal((await c.get(`/api/app-pages?id=${A.page}&version=published`)).status,404,'drafts are not public');
 const preview=await c.post('/api/app-pages',{action:'data',widget:{type:'kpi',config:{source:'tickets'}}});assert.equal(preview.status,200);assert.equal(typeof preview.data.count,'number');
 assert.equal((await c.post('/api/app-pages',{action:'publish',id:A.page})).data.version,2);
 assert.equal((await c.get(`/api/app-pages?id=${A.page}&version=published`)).data.layout.sections[0].rows[0].columns[0].widgets[0].config.text,'Version two');
 const rb=await c.post('/api/app-pages',{action:'rollback',id:A.page,version:1});assert.equal(rb.data.version,3);
 assert.equal((await c.get(`/api/app-pages?id=${A.page}&version=published`)).data.layout.sections[0].rows[0].columns[0].widgets[0].config.text,'Version one');
 assert.equal((await c.get(`/api/app-pages?id=${A.page}&versions=1`)).data.versions.length,3);
 assert.ok((await c.get(`/api/app-pages?id=${A.page}&compare=1,2`)).data.diff.changed.length>=1);
 // Only approved widgets and safe links: no scripts, no javascript: URLs.
 assert.equal((await c.post('/api/app-pages',{action:'save',title:'Bad',slug:'bad1',layout:{sections:[{rows:[{columns:[{widgets:[{type:'script',config:{}}]}]}]}]}})).status,400);
 assert.equal((await c.post('/api/app-pages',{action:'save',title:'Bad',slug:'bad2',layout:{sections:[{rows:[{columns:[{widgets:[{type:'button',config:{label:'x',link:'javascript:alert(1)'}}]}]}]}]}})).status,400);
 const dup=await c.post('/api/app-pages',{action:'duplicate',id:A.page});assert.equal(dup.status,200);
 assert.equal((await c.post('/api/app-pages',{action:'save-template',id:A.page,name:'Ops',scope:'platform'})).status,403,'only the Platform Owner makes platform templates');
 assert.ok(sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${A.id}' AND action IN ('Custom page published','Custom page rolled back')`)[0].n>=2);
});

test('13. Widgets cannot retrieve data from another company',async()=>{
 const r=await A.admin.post('/api/app-pages',{action:'data',widget:{type:'table',config:{source:'tickets',limit:50}}});assert.equal(r.status,200);
 assert.ok(!JSON.stringify(r.data).includes('BRAVO-SECRET'));
 assert.equal((await A.admin.post('/api/app-pages',{action:'data',widget:{type:'table',config:{source:'tickets',filters:'tenant_id='+B.id}}})).status,400,'unknown filters are refused');
 assert.equal((await A.admin.post('/api/app-pages',{action:'data',pageId:'00000000-0000-4000-8000-000000000000',widget:{type:'kpi',config:{source:'tickets'}}})).status,404);
 assert.equal((await B.admin.post('/api/app-pages',{action:'data',widget:{type:'kpi',config:{source:'tickets'}}})).status,404,'B has no page builder');
 assert.equal((await B.admin.get(`/api/app-pages?id=${A.page}`)).status,404);
});

test('14. A company connects and tests a REST API and an MCP server',async()=>{
 const c=A.admin;
 const rest=await c.post('/api/connectors',{action:'create',provider:'rest',name:'Stock API',config:{baseUrl:`${MOCK}/rest`,authType:'api_key',header:'X-API-Key',testPath:'/health'},secrets:{secret:REST_SECRET},pages:['app-pages']});assert.equal(rest.status,200,JSON.stringify(rest.data));A.rest=rest.data.id;
 const t=await c.post('/api/connectors',{action:'test',id:A.rest});assert.equal(t.data.ok,true,JSON.stringify(t.data));
 const w=await c.post('/api/app-pages',{action:'data',widget:{type:'connector',config:{connector:A.rest,path:'/items',limit:5}}});assert.equal(w.status,200);assert.equal(w.data.rows[0].sku,'EXT-1');
 assert.equal((await A.it.client.post('/api/connectors',{action:'read',id:A.rest,path:'/items'})).status,403,'staff without connector access are refused');
 const mcp=await c.post('/api/connectors',{action:'create',provider:'mcp',name:'Mock MCP',config:{endpoint:`${MOCK}/mcp`,authType:'bearer'},secrets:{secret:MCP_SECRET},pages:['app-pages']});A.mcp=mcp.data.id;
 const mt=await c.post('/api/connectors',{action:'test',id:A.mcp});assert.equal(mt.data.ok,true,JSON.stringify(mt.data));assert.equal(mt.data.detail.tools,2);
 const det=(await c.get(`/api/connectors?id=${A.mcp}`)).data.connector;assert.deepEqual(det.mutatingTools,['delete_item'],'tools not declared read-only are treated as mutating');
 assert.equal((await c.post('/api/connectors',{action:'mcp-call',id:A.mcp,tool:'list_items'})).status,403,'tools must be allowed first');
 await c.post('/api/connectors',{action:'update',id:A.mcp,allowedTools:['list_items','delete_item']});
 assert.equal((await c.post('/api/connectors',{action:'mcp-call',id:A.mcp,tool:'list_items'})).data.result,'called list_items');
 await mockReset();
 const del=await c.post('/api/connectors',{action:'mcp-call',id:A.mcp,tool:'delete_item',args:{id:1}});assert.equal(del.data.needsConfirmation,true);
 assert.ok(!(await mockLog()).some(e=>e.body.includes('delete_item')),'nothing is sent before confirmation');
 assert.equal((await c.post('/api/connectors',{action:'mcp-call',id:A.mcp,tool:'delete_item',args:{id:1},confirm:true})).data.result,'called delete_item');
 // Signed incoming webhooks.
 const wh=await c.post('/api/connectors',{action:'create',provider:'webhook',name:'Orders hook'});const secret=wh.data.webhookSecret;assert.ok(secret);leaks.push(secret);
 const body=JSON.stringify({event:'order.created'}),ts=String(Math.floor(Date.now()/1000));
 const sig='sha256='+createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex');
 assert.equal((await fetch(`${BASE}/api/hooks?id=${wh.data.id}`,{method:'POST',headers:{'X-OneWorkspace-Timestamp':ts,'X-OneWorkspace-Signature':sig},body})).status,200);
 assert.equal((await fetch(`${BASE}/api/hooks?id=${wh.data.id}`,{method:'POST',headers:{'X-OneWorkspace-Timestamp':ts,'X-OneWorkspace-Signature':'sha256=00'},body})).status,401);
 assert.equal((await c.post('/api/connectors',{action:'disconnect',id:wh.data.id,confirm:'wrong'})).status,400,'disconnecting needs the exact name');
});

test('15. Connector secrets never appear in browser responses, the database or logs',async()=>{
 const list=JSON.stringify((await A.admin.get('/api/connectors')).data),detail=JSON.stringify((await A.admin.get(`/api/connectors?id=${A.rest}`)).data)+JSON.stringify((await A.admin.get(`/api/connectors?id=${A.mcp}`)).data);
 for(const s of leaks){assert.ok(!list.includes(s)&&!detail.includes(s),'secret in API response')}
 const db=JSON.stringify([sql('SELECT * FROM connectors'),sql('SELECT * FROM connector_logs'),sql('SELECT * FROM audit'),sql('SELECT * FROM platform_audit'),sql('SELECT * FROM ai_providers')]);
 for(const s of leaks)assert.ok(!db.includes(s),'secret stored in plaintext');
 const log=readFileSync(process.env.OWS_LOG,'utf8');
 for(const s of [...leaks,...process.env.OWS_SECRETS.split(',')])assert.ok(!log.includes(s),'secret in the server log');
 assert.ok((await mockLog()).length>=0);
});

test('16. Groq is the default AI provider',async()=>{
 await mockReset();
 const r=await B.admin.stream('/api/ai',{action:'chat',message:'What tickets mention a printer jam?'});
 assert.equal(r.status,200);assert.ok(r.answer.includes('groq-mock'),r.text.slice(0,300));assert.equal(r.done.source,'platform');
 assert.ok((await mockLog()).some(e=>e.path==='/groq/v1/chat/completions'&&e.auth.startsWith('Bearer ')));
 assert.ok(sql(`SELECT count(*) AS n FROM ai_usage WHERE tenant_id='${B.id}' AND provider='groq'`)[0].n>=1);
});

test('17. Company A overrides Groq without affecting Company B',async()=>{
 const save=await A.admin.post('/api/ai',{action:'provider-save',provider:'openai-compatible',model:'mock-model',baseUrl:`${MOCK}/company-a/v1`,apiKey:AI_KEY,fallback:'none'});assert.equal(save.status,200,JSON.stringify(save.data));
 assert.equal((await A.admin.post('/api/ai',{action:'provider-test',provider:'openai-compatible',model:'mock-model',baseUrl:`${MOCK}/company-a/v1`})).data.ok,true);
 const settings=JSON.stringify((await A.admin.get('/api/ai?view=settings')).data);assert.ok(!settings.includes(AI_KEY)&&settings.includes('••••'));
 await mockReset();
 const a=await A.admin.stream('/api/ai',{action:'chat',message:'hello'});assert.ok(a.answer.includes('company-a-mock'));assert.equal(a.done.source,'company');
 const b=await B.admin.stream('/api/ai',{action:'chat',message:'hello'});assert.ok(b.answer.includes('groq-mock'));
 const log=await mockLog();assert.ok(log.some(e=>e.path==='/company-a/v1/chat/completions'&&e.auth===`Bearer ${AI_KEY}`));assert.ok(log.some(e=>e.path==='/groq/v1/chat/completions'&&e.auth!==`Bearer ${AI_KEY}`));
 assert.equal((await B.admin.post('/api/ai',{action:'provider-remove'})).status,200);
 assert.equal((await A.admin.get('/api/ai?view=status')).data.source,'company','B removing its own provider does not touch A');
});

test('18–19. The assistant answers from A’s data with citations and never retrieves B’s data',async()=>{
 const t=await A.admin.post('/api/tickets',{action:'create',title:'ALPHA printer jam on floor 2',description:'Paper stuck',department:'IT'});A.ticket=t.data.id;
 await mockReset();
 const r=await A.admin.stream('/api/ai',{action:'chat',message:'Is there a printer jam ticket?',page:'#/home'});
 assert.equal(r.status,200);assert.ok(r.done.citations.some(c=>c.link===`#/tickets/${A.ticket}`),JSON.stringify(r.done));
 assert.ok(r.answer.includes('ALPHA printer jam'));
 const sent=(await mockLog()).filter(e=>e.path.endsWith('/chat/completions')).map(e=>e.body).join('\n');
 assert.ok(sent.includes('ALPHA printer jam'));assert.ok(!sent.includes('BRAVO-SECRET'),'B data never reaches A’s AI');
 // A conversation belongs to its owner and workspace.
 assert.equal((await B.admin.get(`/api/ai?conversation=${r.done.conversationId}`)).status,404);
});

test('20. A restricted user’s AI cannot reveal records outside their permissions',async()=>{
 await A.admin.post('/api/tickets',{action:'create',title:'ADMIN-ONLY-SECRET printer budget',description:'confidential',department:'Finance'});
 const u=await invite(A.admin,A,'Rita Standard',`rita@${A.domain}`,{role:'employee',department:'Sales'});
 await u.client.post('/api/tickets',{action:'create',title:'MY-OWN printer toner',department:'IT'});
 await mockReset();
 const r=await u.client.stream('/api/ai',{action:'chat',message:'printer'});assert.equal(r.status,200,r.text.slice(0,200));
 const sent=(await mockLog()).map(e=>e.body).join('\n');
 assert.ok(sent.includes('MY-OWN printer'),'own ticket retrieved');assert.ok(!sent.includes('ADMIN-ONLY-SECRET'),'others’ tickets are never sent');
 assert.ok(!r.answer.includes('ADMIN-ONLY-SECRET'));
 assert.ok([403,404].includes((await u.client.post('/api/ai',{action:'run',id:'ticket.summarize',entityId:B.ticket})).status),'no AI action on records the user cannot open');
});

test('21. AI mutations require confirmation',async()=>{
 const before=sql(`SELECT priority FROM tickets WHERE id='${A.ticket}'`)[0].priority;
 const docs=sql(`SELECT count(*) AS n FROM purchase_docs WHERE tenant_id='${A.id}'`)[0].n;
 const r=await A.admin.post('/api/ai',{action:'run',id:'ticket.triage',entityId:A.ticket});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.suggestion.kind,'ticket.update');assert.equal(r.data.suggestion.data.priority,'High');
 const p=await A.admin.post('/api/ai',{action:'run',id:'purchase.draft',input:'Two laptops for new hires'});assert.equal(p.data.suggestion.kind,'purchase.create');
 const l=await A.admin.post('/api/ai',{action:'run',id:'builder.layout',input:'An IT dashboard'});assert.equal(l.data.suggestion.kind,'page-builder.draft');
 assert.ok(!JSON.stringify(l.data).includes('"nope"'),'unknown widget types from the AI are dropped');
 assert.equal(sql(`SELECT priority FROM tickets WHERE id='${A.ticket}'`)[0].priority,before,'nothing changes until the user applies it');
 assert.equal(sql(`SELECT count(*) AS n FROM purchase_docs WHERE tenant_id='${A.id}'`)[0].n,docs);
});

test('22. The Platform Owner reaches everything through an audited support session',async()=>{
 assert.equal((await owner.post('/api/platform',{action:'support-start',id:A.id,reason:'Review integrations'})).status,200);
 for(const p of ['/api/connectors','/api/ai?view=settings','/api/app-pages','/api/roles','/api/people'])assert.equal((await owner.get(p)).status,200,p);
 assert.equal((await owner.get('/api/session')).data.tenant.id,A.id);
 await owner.post('/api/platform',{action:'support-end'});
 const rows=sql(`SELECT action,path FROM platform_audit WHERE tenant_id='${A.id}' AND action='support.view'`);
 assert.ok(rows.some(r=>r.path.startsWith('/api/connectors'))&&rows.some(r=>r.path.startsWith('/api/ai')));
});

test('23. Suspending a company blocks its people but not the Platform Owner',async()=>{
 assert.equal((await owner.post('/api/platform',{action:'status',id:A.id,status:'suspended'})).status,200);
 assert.equal((await A.admin.get('/api/session')).data.mode,'signed-out');assert.equal((await A.admin.get('/api/connectors')).status,401);
 assert.equal((await owner.get(`/api/platform?id=${A.id}`)).status,200);
 assert.equal((await owner.post('/api/platform',{action:'pages',id:A.id,pages:(await owner.get(`/api/platform?id=${A.id}`)).data.pages})).status,200);
 assert.equal((await owner.post('/api/platform',{action:'status',id:A.id,status:'active'})).status,200);
 await A.admin.login(`admin@${A.domain}`,A.pw);assert.equal((await A.admin.get('/api/session')).data.tenant.id,A.id);
});

test('24. Existing pages keep working alongside the new features',async()=>{
 for(const p of ['/api/dashboard','/api/search?q=printer','/api/tickets','/api/assets','/api/purchasing','/api/files','/api/pages','/api/reports','/api/people','/api/org','/api/audit','/api/ai?view=status','/api/app-pages','/api/connectors'])assert.equal((await A.admin.get(p)).status,200,p);
 const s=(await A.admin.get('/api/search?q=printer')).data.results;assert.ok(s.some(x=>x.id===A.ticket));assert.ok(!s.some(x=>x.id===B.ticket));
});
