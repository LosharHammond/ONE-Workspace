import {stmt,uid,now} from './core';
import {defaultSteps} from './approvals';

// Starter structure for a brand-new company workspace.
export const starterDepartments=['Administration','Finance','Procurement','IT','Human Resources','Operations','Sales'];
export const starterRoles:[string,string,string,Record<string,Record<string,string>>][]=[
 ['Requester','Raises purchase requisitions and tickets.','employee',{requests:{view:'own',create:'own',update:'own'}}],
 ['Buyer','Converts approved requisitions into purchase orders and manages vendors.','employee',{requests:{view:'all'},procurement:{view:'all',create:'all',update:'all',export:'all'},suppliers:{view:'all',create:'all',update:'all'},receipts:{view:'all',create:'all'}}],
 ['Purchase Head','Approves requisitions and purchase orders company-wide.','manager',{requests:{view:'all',approve:'all',export:'all'},procurement:{view:'all',create:'all',update:'all',approve:'all',export:'all'},suppliers:{view:'all',create:'all',update:'all',export:'all'}}],
 ['Technician','Works tickets and maintains assets.','employee',{maintenance:{view:'all',update:'all'},assets:{view:'all'}}],
 ['Service Desk','Triages, assigns and resolves all tickets.','employee',{maintenance:{view:'all',create:'all',update:'all',assign:'all',export:'all'},assets:{view:'all'}}],
 ['Asset Manager','Registers, assigns and tracks company assets.','employee',{assets:{view:'all',create:'all',update:'all',assign:'all',export:'all'},locations:{view:'all',create:'all',update:'all'}}],
 ['Storekeeper','Receives goods and manages stock.','employee',{inventory:{view:'all',create:'all',update:'all',export:'all'},receipts:{view:'all',create:'all',export:'all'},procurement:{view:'all'}}],
];
export function seedTenant(tenantId:string,adminId:string,companyName:string){
 const t=now();
 return [
  ...starterDepartments.map(d=>stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),tenantId,d,t)),
  ...starterRoles.map(([name,description,base,perms])=>stmt('INSERT OR IGNORE INTO roles(id,tenant_id,name,description,base,permissions_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),tenantId,name,description,base,JSON.stringify(perms),'system',t,'system',t)),
  stmt('INSERT INTO approval_workflows(id,tenant_id,doc_type,name,department,min_amount,steps_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)',uid(),tenantId,'PR','Standard requisition approval','*',0,JSON.stringify(defaultSteps.PR),t,t),
  stmt('INSERT INTO approval_workflows(id,tenant_id,doc_type,name,department,min_amount,steps_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)',uid(),tenantId,'PO','Standard purchase order approval','*',0,JSON.stringify([{name:'Purchase head',type:'role',ref:'Purchase Head'},{name:'Management approval',type:'access',ref:'admin',minAmount:50000}]),t,t),
  stmt('INSERT INTO folders(id,tenant_id,parent_id,name,department,visibility,created_by,created_at) VALUES(?,?,NULL,?,?,?,?,?)',uid(),tenantId,'Policies & procedures','Administration','company',adminId,t),
  stmt('INSERT INTO pages(id,tenant_id,department,kind,title,body,icon,status,pinned,author_id,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),tenantId,'','announcement',`Welcome to ${companyName} on One Workspace`,`This is your company's operating system: people, assets, tickets, purchasing, files and department knowledge in one place.\n\n## Getting started\n1. **Administration → People**: invite your team or import a spreadsheet.\n2. **Administration → Roles & permissions**: tailor what each role can do.\n3. **Administration → Approval workflows**: set who approves requisitions and orders.\n4. Press **Ctrl + K** anywhere to search or jump.`,'sparkles','Published',1,adminId,adminId,t,t),
 ];
}
