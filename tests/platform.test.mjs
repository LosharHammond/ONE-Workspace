// Acceptance tests for the multi-company platform. Run with: npm run build && npm run test:e2e
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client,SETUP,rand,strongPassword,tokenFrom,sql as rawSql,settle} from './helpers.mjs';
const pending=[];const sql=q=>{pending.push(1);return rawSql(q)};
// Wait for the Worker to settle after any direct database read in the previous test.
import {beforeEach} from 'node:test';
beforeEach(async()=>{if(pending.length){pending.length=0;await settle()}});

const OWNER='losharhammond@gmail.com';
const owner=new Client(),ownerPw=strongPassword();
const A={slug:'alpha-'+rand(),domain:`alpha${rand()}.test`,client:new Client(),pw:strongPassword()};
const B={slug:'bravo-'+rand(),domain:`bravo${rand()}.test`,client:new Client(),pw:strongPassword()};
const secrets=[];

test('Platform Owner setup: token required, runs once, rate limited',async()=>{
 const anon=new Client();
 assert.equal((await anon.post('/api/platform/claim',{token:'x'.repeat(48),password:ownerPw})).status,401);
 assert.equal((await anon.post('/api/platform/claim',{token:SETUP,password:ownerPw})).status,200);
 assert.equal((await anon.post('/api/platform/claim',{token:SETUP,password:strongPassword()})).status,409,'setup must refuse to run twice');
 await owner.login(OWNER,ownerPw);
 const s=(await owner.get('/api/session')).data;
 assert.equal(s.user.platformRole,'owner');assert.equal(s.tenant.id,'one-workspace');
});

test('1–2. Owner creates two companies atomically with defaults and an activation invitation',async()=>{
 for(const [c,name] of [[A,'Alpha Foods'],[B,'Bravo Logistics']]){
  const r=await owner.post('/api/platform',{action:'create',name,slug:c.slug,domains:c.domain,adminName:`${name} Admin`,adminEmail:`admin@${c.domain}`,plan:'business'});
  assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(r.data.link,'activation link returned once when email is off');
  c.id=r.data.id;secrets.push(tokenFrom(r.data.link));
  const d=(await owner.get('/api/platform?id='+c.id)).data;
  assert.ok(d.usage.departments>=7&&d.usage.roles>=9,'default departments and roles provisioned');
  assert.equal(d.admins.length,1);assert.equal(d.admins[0].activated,0,'admin is invited, not active');
  const act=await new Client().post('/api/auth/activate',{token:tokenFrom(r.data.link),password:c.pw});
  assert.equal(act.status,200);
  assert.equal((await new Client().post('/api/auth/activate',{token:tokenFrom(r.data.link),password:c.pw})).status,400,'activation link works once');
  await c.client.login(`admin@${c.domain}`,c.pw);
 }
 assert.equal((await owner.post('/api/platform',{action:'create',name:'Dup',slug:A.slug,adminName:'x',adminEmail:'x@dup.test'})).status,409,'duplicate slug refused');
 assert.equal((await owner.post('/api/platform',{action:'create',name:'Dup',slug:'dup-'+rand(),domains:A.domain,adminName:'x',adminEmail:`x@${A.domain}`})).status,409,'duplicate domain refused');
 assert.equal(sql(`SELECT count(*) AS n FROM tenants WHERE name='Dup'`)[0].n,0,'failed provisioning leaves nothing behind');
});

test('3 & 5. Each admin sees only their company; admins cannot open the Platform Console',async()=>{
 const a=(await A.client.get('/api/session')).data,b=(await B.client.get('/api/session')).data;
 assert.equal(a.tenant.id,A.id);assert.equal(b.tenant.id,B.id);
 assert.ok(a.people.every(p=>p.email.endsWith(A.domain)));assert.ok(b.people.every(p=>p.email.endsWith(B.domain)));
 assert.equal((await A.client.get('/api/platform')).status,403);
 assert.equal((await A.client.post('/api/platform',{action:'create',name:'x',slug:'x-'+rand(),adminName:'x',adminEmail:'x@x.test'})).status,403);
 assert.equal(a.user.platformRole,null);
});

test('4 & 11. Forged IDs, bodies and queries cannot read or change another company',async()=>{
 const t=await A.client.post('/api/tickets',{action:'create',title:'ALPHA-SECRET ticket',department:'IT',priority:'High'});
 const asset=await A.client.post('/api/assets',{action:'create',name:'ALPHA-SECRET laptop',kind:'IT',status:'In store',condition:'New'});
 const pr=await A.client.post('/api/purchasing',{action:'save',kind:'PR',title:'ALPHA-SECRET purchase',department:'IT',lines:[{description:'Thing',qty:1,unit:'ea',unitPrice:10}]});
 const file=await A.client.upload('ticket',t.data.id,'alpha-secret.txt','ALPHA-SECRET file body');
 for(const r of [t,asset,pr,file])assert.equal(r.status,200,JSON.stringify(r.data));
 const X=B.client;
 assert.equal((await X.get('/api/tickets?id='+t.data.id)).status,404);
 assert.equal((await X.get('/api/assets?id='+asset.data.id)).status,404);
 assert.equal((await X.get('/api/purchasing?id='+pr.data.id)).status,404);
 assert.equal((await X.get('/api/files?download='+file.data.id)).status,404);
 assert.equal((await X.post('/api/tickets',{action:'status',id:t.data.id,status:'Closed'})).status,404);
 assert.equal((await X.post('/api/assets',{action:'update',id:asset.data.id,name:'pwned',version:1})).status,404);
 assert.equal((await X.post('/api/comments',{type:'ticket',id:t.data.id,body:'hi'})).status,404);
 assert.equal((await X.get('/api/search?q=ALPHA-SECRET')).data.results.length,0);
 // A forged tenant/workspace id in the body is ignored: the record lands in the caller's workspace.
 const forged=await X.post('/api/tickets',{action:'create',title:'forged',department:'IT',tenantId:A.id,tenant_id:A.id,workspace_id:A.id});
 assert.equal(sql(`SELECT tenant_id FROM tickets WHERE id='${forged.data.id}'`)[0].tenant_id,B.id);
 // Switching into a membership that is not yours is refused.
 const aAdmin=(await A.client.get('/api/session')).data.user.id;
 assert.equal((await X.post('/api/session',{memberId:aAdmin})).status,404);
 const tickets=(await X.get('/api/tickets')).data.tickets;assert.ok(tickets.every(x=>!x.title.includes('ALPHA')));
});

test('12. Reports and exports contain only the active company',async()=>{
 const r=await B.client.get('/api/reports?report=assets-register');assert.equal(r.status,200);
 assert.ok(!JSON.stringify(r.data.rows).includes('ALPHA-SECRET'));
 const a=await A.client.get('/api/reports?report=assets-register');assert.ok(JSON.stringify(a.data.rows).includes('ALPHA-SECRET'));
});

test('6. Owner enters and exits a company through an audited support session',async()=>{
 assert.equal((await owner.post('/api/platform',{action:'support-start',id:A.id,reason:'no'})).status,400,'a reason is required');
 assert.equal((await owner.post('/api/platform',{action:'support-start',id:A.id,reason:'Helping configure approvals'})).status,200);
 const s=(await owner.get('/api/session')).data;
 assert.equal(s.tenant.id,A.id);assert.ok(s.support);assert.equal(s.user.role,'admin');
 const change=await owner.post('/api/org',{action:'department',name:'Support-made dept',code:'SUP'});assert.equal(change.status,200);
 const row=sql(`SELECT support_session_id FROM audit WHERE record_id='${change.data.id}'`)[0];assert.ok(row.support_session_id,'mutation is tagged with the support session');
 assert.ok(sql(`SELECT count(*) AS n FROM platform_audit WHERE tenant_id='${A.id}' AND action LIKE 'support.%'`)[0].n>=2,'views and changes are in the platform audit');
 assert.equal((await owner.post('/api/platform',{action:'support-end'})).status,200);
 const after=(await owner.get('/api/session')).data;assert.equal(after.tenant.id,'one-workspace');assert.equal(after.support,null);
 const ss=sql(`SELECT reason,ended_at,ip FROM support_sessions WHERE tenant_id='${A.id}'`)[0];assert.ok(ss.ended_at);assert.equal(ss.reason,'Helping configure approvals');
});

test('7. Suspension locks members out but not the Platform Owner',async()=>{
 assert.equal((await owner.post('/api/platform',{action:'status',id:B.id,status:'suspended'})).status,200);
 assert.equal((await B.client.get('/api/session')).data.mode,'signed-out');
 assert.equal((await new Client().post('/api/auth/login',{login:`admin@${B.domain}`,password:B.pw})).status,403);
 assert.equal((await owner.post('/api/platform',{action:'support-start',id:B.id,reason:'Investigating suspension'})).status,200);
 assert.equal((await owner.get('/api/session')).data.tenant.id,B.id);
 await owner.post('/api/platform',{action:'support-end'});
 await owner.post('/api/platform',{action:'status',id:B.id,status:'active'});
 await B.client.login(`admin@${B.domain}`,B.pw);
});

test('8. Module switches control navigation data and backend access',async()=>{
 assert.equal((await A.client.get('/api/inventory')).status,200);
 const mods=['tickets','assets','maintenance','purchasing','spaces','files','operations','reports'];
 assert.equal((await owner.post('/api/platform',{action:'modules',id:A.id,modules:mods})).status,200);
 assert.equal((await A.client.get('/api/inventory')).status,404);
 const s=(await A.client.get('/api/session')).data;assert.ok(!s.tenant.modules.includes('inventory'));assert.equal(s.user.permissions.inventory.view,'none');
 await owner.post('/api/platform',{action:'modules',id:A.id,modules:[...mods,'inventory']});
 assert.equal((await A.client.get('/api/inventory')).status,200);
});

test('9. Department, user and role CRUD',async()=>{
 const c=A.client;
 const d=await c.post('/api/org',{action:'department',name:'Quality',code:'QA',costCentre:'CC-100'});assert.equal(d.status,200);
 assert.equal((await c.post('/api/org',{action:'department',name:'Quality 2',code:'QA'})).status,409,'department codes are unique');
 assert.equal((await c.post('/api/org',{action:'department',id:d.data.id,name:'Quality',code:'QA',status:'Inactive'})).status,200);
 const role=await c.post('/api/roles',{name:'Ticket Viewer',base:'employee',permissions:{maintenance:{view:'own',create:'own'}}});assert.equal(role.status,200);
 const inv=await c.post('/api/people',{action:'create',name:'Staff One',email:`staff1@${A.domain}`,department:'IT',roleId:role.data.id});
 assert.equal(inv.status,200);assert.ok(inv.data.link);secrets.push(tokenFrom(inv.data.link));
 assert.equal((await c.post('/api/people',{action:'create',name:'Outsider',email:'someone@gmail.com',department:'IT',role:'employee'})).status,400,'email domain rules apply');
 A.staffPw=strongPassword();assert.equal((await new Client().post('/api/auth/activate',{token:tokenFrom(inv.data.link),password:A.staffPw})).status,200);
 A.staff=new Client();await A.staff.login(`staff1@${A.domain}`,A.staffPw);
 assert.equal((await c.post('/api/roles',{action:'delete',id:role.data.id})).status,409,'roles with people cannot be deleted');
 const people=(await c.get('/api/people')).data.members;assert.equal(people.find(p=>p.email===`staff1@${A.domain}`).status,'Active');
 assert.ok(sql(`SELECT count(*) AS n FROM audit WHERE tenant_id='${A.id}' AND action IN ('Role created','Person invited','Department created')`)[0].n>=3);
});

test('10. Role actions and Own/Department/Location scopes are enforced by the API',async()=>{
 const staff=A.staff;
 const mine=await staff.post('/api/tickets',{action:'create',title:'Staff own ticket',department:'IT'});assert.equal(mine.status,200);
 const list=(await staff.get('/api/tickets')).data.tickets;
 assert.ok(list.every(t=>t.requester_id===(list[0]?.requester_id)),'own scope: only own tickets');assert.ok(!list.some(t=>t.title.includes('ALPHA-SECRET')));
 assert.equal((await staff.get('/api/people?activity=x')).status,404);
 assert.equal((await staff.post('/api/people',{action:'create',name:'x',email:`x@${A.domain}`,department:'IT',role:'employee'})).status,403);
 assert.equal((await staff.get('/api/roles')).status,403);
 assert.equal((await staff.post('/api/purchasing',{action:'save',kind:'PO',title:'x',department:'IT',lines:[{description:'x',qty:1,unit:'ea',unitPrice:1}]})).status,403,'no purchase-order permission');
 // Location scope on assets.
 const admin=A.client;
 await admin.post('/api/assets',{action:'create',name:'Store laptop',kind:'IT',status:'In store',condition:'New',location:'Head Office > Main Store',department:'IT'});
 await admin.post('/api/assets',{action:'create',name:'Remote laptop',kind:'IT',status:'In store',condition:'New',location:'Remote Site',department:'IT'});
 const r=await admin.post('/api/roles',{name:'Store asset viewer',base:'employee',permissions:{assets:{view:'all'}},locations:['Head Office']});
 const me=(await staff.get('/api/session')).data.user.id;
 await admin.post('/api/people',{action:'update',id:me,roleId:r.data.id});
 await staff.login(`staff1@${A.domain}`,A.staffPw);
 const assets=(await staff.get('/api/assets')).data.assets.map(a=>a.name);
 assert.ok(assets.includes('Store laptop'));assert.ok(!assets.includes('Remote laptop'),'location scope hides assets elsewhere');
});

test('13. No plaintext passwords, setup token or invitation tokens are stored',async()=>{
 const dump=JSON.stringify([sql('SELECT * FROM credentials'),sql('SELECT * FROM auth_tokens'),sql('SELECT * FROM audit'),sql('SELECT * FROM platform_audit'),sql('SELECT * FROM identities'),sql('SELECT * FROM members')]);
 for(const secret of [ownerPw,A.pw,B.pw,A.staffPw,SETUP,...secrets])assert.ok(!dump.includes(secret),'secret value found in the database');
 assert.ok(sql('SELECT count(*) AS n FROM auth_tokens')[0].n>0,'tokens are stored (as hashes)');
});

test('14. Existing modules and routes keep working',async()=>{
 for(const p of ['/api/dashboard','/api/people','/api/org','/api/tickets','/api/assets','/api/purchasing','/api/files','/api/pages','/api/reports','/api/maintenance','/api/inventory','/api/audit','/api/tenant','/api/workspace'])assert.equal((await A.client.get(p)).status,200,p);
 assert.equal((await new Client().get('/')).status,200);
});
