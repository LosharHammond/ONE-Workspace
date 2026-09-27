import {stmt,uid,now} from './core';
import {defaultSteps} from './approvals';
import {roleTemplates} from '../role-templates';

// Starter structure for a brand-new company workspace. The Platform Owner chooses which parts to create.
export type SeedOptions={departments:boolean,locations:boolean,roles:boolean,workflows:boolean,welcome:boolean,folders:boolean};
export const defaultSeedOptions:SeedOptions={departments:true,locations:true,roles:true,workflows:true,welcome:true,folders:true};
export const starterDepartments:[string,string][]=[['Administration','ADM'],['Finance','FIN'],['Procurement','PRC'],['IT','IT'],['Human Resources','HR'],['Operations','OPS'],['Sales','SAL']];
export const starterSettings={prPrefix:'PR',poPrefix:'PO',ticketPrefix:'TKT',assetPrefix:'AST',woPrefix:'WO',ticketCategories:'Hardware, Software, Network, Email, Access, Facilities, Electrical, Plumbing, Vehicle, Other',assetCategories:'Laptop, Desktop, Monitor, Printer, Phone, Network, Server, CCTV, Vehicle, Furniture, Machinery, Tools',inventoryCategories:'Consumables, Spare parts, Packaging, Raw materials, Stationery',poTerms:'Payment within 30 days of invoice. Deliver to the location stated above.'};

export function seedTenant(tenantId:string,adminMemberId:string,companyName:string,o:SeedOptions=defaultSeedOptions){
 const t=now();const s:D1PreparedStatement[]=[];
 if(o.departments)for(const [name,code] of starterDepartments)s.push(stmt("INSERT OR IGNORE INTO departments(id,tenant_id,name,code,status,created_by,created_at) VALUES(?,?,?,?,'Active',?,?)",uid(),tenantId,name,code,adminMemberId,t));
 else s.push(stmt("INSERT OR IGNORE INTO departments(id,tenant_id,name,code,status,created_by,created_at) VALUES(?,?,'Administration','ADM','Active',?,?)",uid(),tenantId,adminMemberId,t));
 if(o.locations){const hq=uid();s.push(stmt("INSERT INTO locations(id,tenant_id,name,parent_id,path,kind,created_at) VALUES(?,?,'Head Office',NULL,'Head Office','Site',?)",hq,tenantId,t),stmt("INSERT INTO locations(id,tenant_id,name,parent_id,path,kind,created_at) VALUES(?,?,'Main Store',?,'Head Office > Main Store','Store',?)",uid(),tenantId,hq,t))}
 if(o.roles)for(const r of roleTemplates)s.push(stmt('INSERT OR IGNORE INTO roles(id,tenant_id,name,description,base,permissions_json,template,pages_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',uid(),tenantId,r.name,r.description,r.base,JSON.stringify(r.permissions),r.id,r.pages?JSON.stringify(r.pages):null,'system',t,'system',t));
 if(o.workflows){
  s.push(stmt('INSERT INTO approval_workflows(id,tenant_id,doc_type,name,department,min_amount,steps_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)',uid(),tenantId,'PR','Standard requisition approval','*',0,JSON.stringify(defaultSteps.PR),t,t));
  s.push(stmt('INSERT INTO approval_workflows(id,tenant_id,doc_type,name,department,min_amount,steps_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)',uid(),tenantId,'PO','Standard purchase order approval','*',0,JSON.stringify([{name:'Approver',type:'role',ref:'Approver'},{name:'Management approval',type:'access',ref:'admin',minAmount:50000}]),t,t));
 }
 if(o.folders)s.push(stmt("INSERT INTO folders(id,tenant_id,parent_id,name,department,visibility,created_by,created_at) VALUES(?,?,NULL,'Policies & procedures','Administration','company',?,?)",uid(),tenantId,adminMemberId,t));
 if(o.welcome)s.push(stmt("INSERT INTO pages(id,tenant_id,department,kind,title,body,icon,status,pinned,author_id,updated_by,created_at,updated_at) VALUES(?,?,'','announcement',?,?,'','Published',1,?,?,?,?)",uid(),tenantId,`Welcome to ${companyName} on One Workspace`,`This is your company's operating system: people, assets, tickets, purchasing, files and department knowledge in one place.\n\n## Getting started\n1. **People → Manage users**: invite your team or import a spreadsheet.\n2. **Admin → Roles & permissions**: tailor what each role can do.\n3. **Purchasing → Approval workflows**: set who approves requisitions and orders.\n4. Press **Ctrl + K** anywhere to search or jump.`,adminMemberId,adminMemberId,t,t));
 return s;
}
