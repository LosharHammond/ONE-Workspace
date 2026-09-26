// Role baselines offered when provisioning a workspace and when creating a role.
// Each is an access level (base) plus explicit page permissions; anything not listed falls back to
// the base level's baseline, and anything not granted there is denied.
export type RoleTemplate={id:string,name:string,description:string,base:'admin'|'manager'|'employee'|'viewer',permissions:Record<string,Record<string,string>>};
const all=(...actions:string[])=>Object.fromEntries(actions.map(a=>[a,'all']));
export const roleTemplates:RoleTemplate[]=[
 {id:'company_admin',name:'Company Admin',description:'Full control of this workspace (not the platform).',base:'admin',permissions:{}},
 {id:'department_head',name:'Department Head',description:'Manages and approves for their department.',base:'manager',permissions:{requests:{view:'department',approve:'department'},maintenance:{view:'department',assign:'department'},reports:{view:'department',export:'department'}}},
 {id:'standard',name:'Standard User',description:'Raises tickets and requisitions and works their own items.',base:'employee',permissions:{requests:{view:'own',create:'own',update:'own'},maintenance:{view:'own',create:'own',update:'own'}}},
 {id:'technician',name:'Technician',description:'Works tickets, work orders and asset maintenance.',base:'employee',permissions:{maintenance:all('view','update','assign'),schedules:all('view','create','update'),assets:all('view','update'),inventory:{view:'all'}}},
 {id:'approver',name:'Approver',description:'Reviews and approves requisitions and orders.',base:'employee',permissions:{requests:all('view','approve'),procurement:all('view','approve'),budgets:{view:'all'}}},
 {id:'purchasing',name:'Purchasing User',description:'Raises orders, manages vendors, receives goods.',base:'employee',permissions:{requests:{view:'all'},procurement:all('view','create','update','export'),suppliers:all('view','create','update','export'),receipts:all('view','create','export'),inventory:all('view','create','update'),budgets:{view:'all'}}},
 {id:'asset_manager',name:'Asset Manager',description:'Registers, assigns, audits and disposes of assets.',base:'employee',permissions:{assets:all('view','create','update','assign','import','export'),locations:all('view','create','update'),schedules:all('view','create','update')}},
 {id:'storekeeper',name:'Storekeeper',description:'Receives, issues and counts stock.',base:'employee',permissions:{inventory:all('view','create','update','import','export'),receipts:all('view','create','export'),procurement:{view:'all'}}},
 {id:'viewer',name:'Viewer',description:'Read-only access to their department.',base:'viewer',permissions:{}},
];
