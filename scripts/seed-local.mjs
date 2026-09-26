// Seeds the LOCAL development D1 database with test people and sample records.
// Never run against production. Usage (after `npm run build` and applying migrations locally):
//   node scripts/seed-local.mjs
// All seeded accounts share the test password below and are marked as already changed.
import {pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

export const TEST_PASSWORD='local-dev-Workspace-2026';
const iterations=100000;
const hashFor=pw=>{const salt=randomBytes(32).toString('hex');return {salt,hash:pbkdf2Sync(pw,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex')}};
const q=s=>s===null?'NULL':`'${String(s).replaceAll("'","''")}'`;
const now=new Date().toISOString();
const sql=[];
const people=[
 ['u-admin','Ama Mensah','admin@onews.test','admin','Administration','Operations Director',null,null],
 ['u-fin','Kofi Boateng','kofi@onews.test','manager','Finance','Finance Manager','u-admin',null],
 ['u-proc','Efua Asante','efua@onews.test','manager','Procurement','Purchase Head','u-admin','Purchase Head'],
 ['u-it','Yaw Owusu','yaw@onews.test','employee','IT','Systems Administrator','u-admin','IT Employee'],
 ['u-sales','Akosua Darko','akosua@onews.test','employee','Sales','Regional Sales Rep','u-salesm','PR User'],
 ['u-salesm','Kwame Ofori','kwame@onews.test','manager','Sales','Sales Manager','u-admin',null],
 ['u-buyer','Adjoa Mensah','adjoa@onews.test','employee','Procurement','Buyer','u-proc','PO User'],
];
for(const [id,name,email,role,dept,title,mgr,roleName] of people){
 const {salt,hash}=hashFor(TEST_PASSWORD);
 sql.push(`INSERT OR REPLACE INTO members(id,name,email,role,department,active,created_at,tenant_id,title,manager_id,location,role_id,platform_role) VALUES(${q(id)},${q(name)},${q(email)},${q(role)},${q(dept)},1,${q(now)},'procus',${q(title)},${q(mgr)},'TEMA > HQ',${roleName?`(SELECT id FROM roles WHERE tenant_id='procus' AND name=${q(roleName)})`:'NULL'},NULL);`);
 sql.push(`INSERT OR REPLACE INTO passwords(member_id,username,salt,password_hash,iterations,must_change) VALUES(${q(id)},${q(email)},${q(salt)},${q(hash)},${iterations},0);`);
 sql.push(`INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(${q(randomUUID())},'procus',${q(dept)},${q(now)});`);
}
sql.push(`UPDATE departments SET head_id='u-fin' WHERE tenant_id='procus' AND name='Finance';`,`UPDATE departments SET head_id='u-proc' WHERE tenant_id='procus' AND name='Procurement';`,`UPDATE departments SET head_id='u-salesm',description='Regional sales and distribution across Ghana.' WHERE tenant_id='procus' AND name='Sales';`);
sql.push(`UPDATE pages SET author_id='u-admin',updated_by='u-admin' WHERE tenant_id='procus';`);
sql.push(`INSERT OR IGNORE INTO pages(id,tenant_id,department,kind,title,body,icon,status,pinned,author_id,updated_by,created_at,updated_at) SELECT 'p-welcome','procus','','announcement','Welcome to One Workspace','Press **Ctrl + K** anywhere to search.','','Published',1,'u-admin','u-admin','${now}','${now}' WHERE NOT EXISTS(SELECT 1 FROM pages WHERE tenant_id='procus');`);
for(const l of ['TEMA','TEMA > HQ','TEMA > Unit 1','TEMA > Unit 2','TEMA > Unit 2 > FG Warehouse'])sql.push(`INSERT OR IGNORE INTO locations(id,tenant_id,name,parent_id,path,kind,created_at) VALUES(${q(randomUUID())},'procus',${q(l.split(' > ').pop())},(SELECT id FROM locations WHERE tenant_id='procus' AND path=${q(l.split(' > ').slice(0,-1).join(' > '))}),${q(l)},${q(l.includes('>')?'Unit':'Site')},${q(now)});`);
const assets=[['Dell Latitude 5440','Laptop','IT','Dell','Latitude 5440','In use','u-sales',7800],['HP LaserJet Pro M404','Printer','IT','HP','M404dn','In use',null,3200],['Toyota Hilux GR-2231-24','Vehicle','Vehicle','Toyota','Hilux','Maintenance',null,410000],['Hikvision NVR 32ch','CCTV','IT','Hikvision','DS-7732NI','In use',null,9100],['Packaging line 02','Machinery','Machinery','Bosch','SVE 2510','In use',null,650000],['MacBook Air 13"','Laptop','IT','Apple','M3','In store',null,14500]];
assets.forEach(([name,cat,kind,brand,model,status,to,cost],i)=>sql.push(`INSERT OR IGNORE INTO assets(id,tenant_id,code,name,category,kind,brand,model,serial,status,condition,location,department,assigned_to,purchase_date,purchase_cost,warranty_until,created_by,created_at,updated_at) VALUES('a${i}','procus','AST-${String(i+1).padStart(5,'0')}',${q(name)},${q(cat)},${q(kind)},${q(brand)},${q(model)},'SN${1000+i}',${q(status)},'Good','TEMA > HQ',${q(i===4?'Manufacturing':'IT')},${q(to)},'2025-03-01',${cost},'2026-11-30','u-it','${now}','${now}');`));
sql.push(`INSERT OR REPLACE INTO counters(tenant_id,key,value) VALUES('procus','AST',${assets.length});`);
const tickets=[['Printer on 2nd floor jams on every page','High','Open','IT','u-it','u-sales'],['VPN disconnects every 10 minutes','Urgent','In progress','IT','u-it','u-fin'],['Request access to finance share','Medium','New','IT',null,'u-buyer'],['Air conditioner leaking in HQ meeting room','Low','On hold','Administration',null,'u-salesm'],['Laptop battery swelling','High','Resolved','IT','u-it','u-sales']];
const year=new Date().getUTCFullYear();
tickets.forEach(([t,p,s,d,a,r],i)=>{const created=new Date(Date.now()-(i+1)*26*3600000).toISOString();const due=new Date(Date.parse(created)+({Urgent:4,High:24,Medium:72,Low:120}[p])*3600000).toISOString();sql.push(`INSERT OR IGNORE INTO tickets(id,tenant_id,number,title,description,type,category,priority,status,department,assignee_id,requester_id,location,due_at,resolved_at,created_at,updated_at) VALUES('t${i}','procus','TKT-${year}-${String(i+1).padStart(4,'0')}',${q(t)},'Reported from the local seed.','Incident','Hardware',${q(p)},${q(s)},${q(d)},${q(a)},${q(r)},'TEMA > HQ',${q(due)},${s==='Resolved'?q(now):'NULL'},${q(created)},${q(created)});`)});
sql.push(`INSERT OR REPLACE INTO counters(tenant_id,key,value) VALUES('procus','TKT-${year}',${tickets.length});`);
for(const [n,e,c] of [['Accra Office Supplies Ltd','orders@accra-office.test','Stationery'],['TechHub Ghana','sales@techhub.test','IT hardware'],['Tema Packaging Co.','','Packaging']])sql.push(`INSERT OR IGNORE INTO vendors(id,tenant_id,name,email,category,status,created_by,created_at) VALUES(${q(randomUUID())},'procus',${q(n)},${q(e)},${q(c)},'Active','u-proc',${q(now)});`);
// The platform owner (losharhammond@gmail.com) is not given a password here: set it with
// "Platform owner first-time setup" on the sign-in page and PLATFORM_SETUP_TOKEN in .dev.vars.
// A second company proves tenant isolation locally.
const other=hashFor(TEST_PASSWORD);
sql.push(`INSERT OR IGNORE INTO tenants(id,slug,name,legal_name,domains,status,plan,brand_color,currency,timezone,settings_json,created_at) VALUES('acme','acme-foods','Acme Foods','Acme Foods Ltd','acme.test','active','business','#0E9AA7','GHS','Africa/Accra','{}',${q(now)});`);
sql.push(`INSERT OR REPLACE INTO members(id,name,email,role,department,active,created_at,tenant_id) VALUES('acme-admin','Acme Admin','admin@acme.test','admin','Administration',1,${q(now)},'acme');`);
sql.push(`INSERT OR REPLACE INTO passwords(member_id,username,salt,password_hash,iterations,must_change) VALUES('acme-admin','admin@acme.test',${q(other.salt)},${q(other.hash)},${iterations},0);`);
sql.push(`INSERT OR IGNORE INTO tickets(id,tenant_id,number,title,description,type,priority,status,department,requester_id,created_at,updated_at) VALUES('acme-t1','acme','TKT-${year}-0001','ACME SECRET TICKET','Only Acme may see this.','Incident','High','New','IT','acme-admin',${q(now)},${q(now)});`);

writeFileSync('.wrangler/seed-local.sql',sql.join('\n'));
execFileSync(process.execPath,['--import','./scripts/wrangler-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file','.wrangler/seed-local.sql'],{stdio:'inherit'});
console.log(`Seeded ${people.length} people in Procus Ghana and one admin in Acme Foods (tenant isolation check). Sign in as admin@onews.test with TEST_PASSWORD from this file.`);
