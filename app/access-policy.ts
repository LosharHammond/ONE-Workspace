// Shared by the browser and the server. The server is the source of truth;
// the browser uses the same map only to hide actions a person cannot take.
export type Scope='none'|'own'|'department'|'all';
export type AccessRule={id?:string,subject_type:string,subject_id:string,department:string,page:string,action:string,effect:string,scope:Scope};
// disabledPages: pages of modules switched off for the workspace (always denied, even for admins).
// extraDepartments: "selected departments" granted by a custom role; they count as the person's department.
// rolePages: when a custom role lists its pages, every other page is denied (deny by default).
export type AccessUser={id:string,role:string,department:string,active:number,roleId?:string|null,rules?:AccessRule[],disabledPages?:string[],extraDepartments?:string[],rolePages?:string[]|null};

export const baseRoles=['admin','manager','employee','viewer'] as const;
export const baseRoleLabels:Record<string,string>={admin:'Company Admin',manager:'Department Head',employee:'Standard User',viewer:'Viewer'};

export const pageActions:Record<string,string[]>={
 overview:['view'],
 people:['view','create','update','delete','import','export'],
 knowledge:['view','create','update','delete','publish'],
 locations:['view','create','update','delete','export'],
 assets:['view','create','update','delete','assign','import','export'],
 maintenance:['view','create','update','delete','assign','approve','export'],
 schedules:['view','create','update','delete','assign','export'],
 requests:['view','create','update','approve','export'],
 procurement:['view','create','update','approve','export'],
 suppliers:['view','create','update','delete','import','export'],
 inventory:['view','create','update','delete','import','export'],
 receipts:['view','create','export'],
 budgets:['view','create','update','export'],
 documents:['view','create','update','delete','upload','download','export'],
 reports:['view','export'],
 research:['view','upload','process','download'],
 it:['view','create','manage_devices','export'],
 'company-data':['view'],
 audit:['view'],
 settings:['view','manage_members','configure'],
 assistant:['view','run_ai'],
 connectors:['view','configure','use_connectors'],
 'app-pages':['view','create','update','delete','publish'],
 projects:['view','create','update','delete','approve','assign','export','configure'],
 tasks:['view','create','update','delete','assign','export'],
 messages:['view','create','moderate','export'],
 graph:['view','export'],
 business:['view','create','update','delete','export'],
 studio:['view','create','update','delete','publish','configure'],
 agents:['view','run','create','update','approve','configure'],
};
// Pages every role keeps (the home page); other pages must be on a strict role's page list.
export const alwaysPages=['overview'];
export const pageLabels:Record<string,string>={business:'Goals & customers',graph:'Work Graph',studio:'Workspace Studio',agents:'AI workforce',overview:'Home',schedules:'Schedules & maintenance',reports:'Reports',people:'People directory',knowledge:'Department spaces',locations:'Locations',assets:'Assets',maintenance:'Tickets',requests:'Purchase requisitions',procurement:'Purchase orders',suppliers:'Vendors',inventory:'Inventory',receipts:'Goods receipts',budgets:'Budgets',documents:'Files & documents',research:'Consumer research',it:'IT & CCTV storage','company-data':'Data hub',audit:'Activity log',settings:'Administration',assistant:'ONE (AI assistant)',connectors:'Connectors','app-pages':'Custom pages',projects:'Projects',tasks:'Tasks',messages:'Messages'};

export function departmentKey(value:string){const v=(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');const groups:Record<string,string[]>={it:['it','itdepartment','informationtechnology','informationtechnologydepartment'],hr:['hr','hrandadmin','humanresource','humanresources','humanresourcemanagement','peopleculture','peopleandculture'],finance:['finance','accounting','accounts'],research:['consumerinsights','consumerinsightsresearch','consumerinsightsandresearch','consumerresearch','researchdevelopment','researchanddevelopment','rd'],warehouse:['warehouse','fgwarehouse','stores','store','itstore','unit4warehouse','shitowarehouse'],sales:['sales','salesdistribution','salesanddistribution','businessstrategistsales','export','businessstrategy'],quality:['quality','qualityassurance','microbiology'],production:['manufacturing','production','groundnut','shito','shitospices','spices','inprocess'],logistics:['logistics','supplychainlogistics','supplychainandlogistics'],procurement:['procurement','purchase','purchasing','purchasedepartment']};return Object.keys(groups).find(k=>groups[k].includes(v))||v}

export const departmentPages:Record<string,string[]>={it:['assets','inventory','maintenance','it','schedules'],hr:['people','locations'],finance:['procurement','receipts','budgets','suppliers'],procurement:['procurement','receipts','budgets','suppliers','inventory'],warehouse:['inventory','receipts','assets'],logistics:['inventory','receipts','assets'],maintenance:['assets','maintenance','inventory','schedules'],research:['research'],marketing:['research'],sales:['inventory'],quality:['maintenance','inventory'],production:['assets','inventory','maintenance','schedules'],operations:['assets','inventory','maintenance','locations','schedules'],administration:['people','locations','assets'],security:['assets','maintenance'],healthsafety:['maintenance','assets'],safety:['maintenance','assets']};

// Pages every active member can use at least for their own work.
const everyone=['documents','requests','maintenance','knowledge','people','locations'];

export function defaultScope(u:AccessUser,page:string,action:string):Scope{
 if(!u.active||!baseRoles.includes(u.role as typeof baseRoles[number])||!pageActions[page]?.includes(action))return 'none';
 if(u.role==='admin')return 'all';
 if(['overview','settings'].includes(page)&&action==='view')return 'own';
 // AI works only on what the person can already open, so everyone may use it for themselves.
 if(page==='assistant')return 'own';
 // Connectors: people see the connectors enabled for them and their own personal connections.
 if(page==='connectors'){if(action==='view')return u.role==='viewer'?'none':'own';if(action==='use_connectors')return u.role==='manager'?'department':'none';return 'none'}
 if(page==='app-pages')return action==='view'?'all':'none';
 // Projects: people see their department's projects (and any project they are on); heads create and approve.
 if(page==='projects'){if(action==='view')return 'department';if(u.role==='viewer')return 'none';if(['create','update','assign','export'].includes(action))return u.role==='manager'?'department':action==='export'?'department':'none';if(action==='approve')return u.role==='manager'?'department':'none';return 'none'}
 // Tasks: everyone plans their own work; heads assign within their department.
 if(page==='tasks'){if(action==='view')return 'department';if(u.role==='viewer')return 'none';if(action==='assign'||action==='export')return u.role==='manager'?'department':action==='export'?'own':'none';return 'own'}
 // Messages: channel membership decides who reads what; heads moderate their department's channels.
 // Work Graph: everyone explores what they can already see (every node is re-checked); exports for managers.
 // Goals, customers, contracts, services, meetings and decisions: everyone reads what each record's visibility allows; staff record their own; heads export.
 if(page==='business')return action==='view'?'all':u.role==='viewer'?'none':action==='export'?(u.role==='manager'?'department':'none'):action==='delete'?(u.role==='manager'?'department':'own'):'department';
 if(page==='graph')return action==='view'?'all':u.role==='manager'?'department':'none';
 // Workspace Studio: everyone may use published apps (each app has its own role list); building is for administrators.
 if(page==='studio')return action==='view'?'all':'none';
 // AI workforce: staff may run agents published to them; building, approving and policies are administrator tasks.
 if(page==='agents')return action==='view'||(action==='run'&&u.role!=='viewer')?'all':action==='approve'&&u.role==='manager'?'department':'none';
 if(page==='messages'){if(action==='view'||action==='create')return u.role==='viewer'&&action==='create'?'none':'all';if(action==='moderate')return u.role==='manager'?'department':'none';return 'none'}
 if(page==='settings'&&action==='manage_members')return u.role==='manager'?'department':'none';
 if(page==='audit')return u.role==='manager'?'department':'none';
 if(page==='company-data'||(page==='it'&&u.role==='viewer'))return 'none';
 // Workspace configuration and bulk import/delete are administrator tasks unless a role grants them.
 if(action==='configure')return 'none';
 if(page==='reports')return u.role==='manager'?'department':'none';
 // Company directory and locations are readable by all staff.
 if(['people','locations'].includes(page)&&action==='view')return 'all';
 // Department knowledge: everyone reads published pages; staff draft in their department; heads publish.
 if(page==='knowledge'){if(action==='view')return 'all';if(u.role==='viewer')return 'none';if(action==='publish')return u.role==='manager'?'department':'none';return 'department'}
 const deptPages=departmentPages[departmentKey(u.department)]||[];
 const relevant=deptPages.includes(page)||(u.role==='manager'&&['people','locations','budgets','assets','requests'].includes(page));
 // Anyone may raise and follow their own tickets; teams that own maintenance work their department's queue.
 if(page==='maintenance'&&!relevant){if(u.role==='viewer')return action==='view'?'own':'none';return ['view','create','update'].includes(action)?'own':'none'}
 if(!relevant&&!everyone.includes(page))return 'none';
 if(!relevant&&['people','locations'].includes(page))return 'none';
 const scope:Scope=['it','research'].includes(page)?'all':'department';
 if(action==='view')return page==='requests'&&u.role!=='manager'?'own':scope;
 if(u.role==='viewer')return action==='download'?scope:'none';
 if(u.role==='manager')return action==='import'&&['people'].includes(page)?'none':scope;
 if(['approve','manage_devices','assign','delete','import'].includes(action))return 'none';
 if(page==='requests')return ['create','update'].includes(action)?'own':'none';
 if(action==='update'&&['people','procurement'].includes(page))return 'none';
 return scope;
}

const rank=(r:AccessRule)=>r.subject_type==='user'?(r.department==='*'?40:45):r.subject_type==='customrole'?35:r.subject_type==='role'&&r.department!=='*'?30:r.subject_type==='department'?(r.department==='*'?20:25):10;

export function actionScope(u:AccessUser,page:string,action:string):Scope{
 if(u.disabledPages?.includes(page))return 'none';
 if(u.role!=='admin'&&u.rolePages&&!alwaysPages.includes(page)&&!u.rolePages.includes(page)&&!(page==='settings'&&action==='view'))return 'none';
 if(!u.active||!baseRoles.includes(u.role as typeof baseRoles[number])||!pageActions[page]?.includes(action))return 'none';
 if(u.role==='admin')return 'all';
 const candidates=(u.rules||[]).filter(r=>r.page===page&&r.action===action&&(r.department==='*'||departmentKey(r.department)===departmentKey(u.department))&&((r.subject_type==='user'&&r.subject_id===u.id)||(r.subject_type==='customrole'&&r.subject_id===u.roleId)||(r.subject_type==='role'&&r.subject_id===u.role)||(r.subject_type==='department'&&departmentKey(r.subject_id)===departmentKey(u.department))));
 candidates.sort((a,b)=>rank(b)-rank(a));
 const rule=candidates[0];
 const scope=rule?(rule.effect==='deny'?'none':rule.scope):defaultScope(u,page,action);
 if(['it','research','company-data'].includes(page)&&scope!=='all')return 'none';
 if(page==='settings'&&action==='manage_members'&&scope!=='none')return scope==='all'&&u.role==='manager'?'all':'department';
 return scope;
}
export function hasAction(u:AccessUser,page:string,action='view'){return actionScope(u,page,'view')!=='none'&&actionScope(u,page,action)!=='none'}
export function inScope(u:AccessUser,scope:Scope,department:string,creator?:string|null){if(scope==='all')return true;if(scope==='own')return !!creator&&creator===u.id;if(scope!=='department'||!department||departmentKey(department)==='unassigned')return false;const d=departmentKey(department);return d===departmentKey(u.department)||!!u.extraDepartments?.some(x=>departmentKey(x)===d)}
export function canActOn(u:AccessUser,page:string,action:string,department:string,creator?:string|null){return hasAction(u,page,action)&&inScope(u,actionScope(u,page,'view'),department,creator)&&inScope(u,actionScope(u,page,action),department,creator)}
export function permissionMap(u:AccessUser){return Object.fromEntries(Object.entries(pageActions).map(([p,actions])=>[p,Object.fromEntries(actions.map(a=>[a,hasAction(u,p,a)?actionScope(u,p,a):'none']))]))}
// Custom roles are stored as {page:{action:scope}} and become rules ranked above base-role defaults.
export function roleRules(roleId:string,permissionsJson:string):AccessRule[]{let p:Record<string,Record<string,string>>={};try{p=JSON.parse(permissionsJson||'{}')}catch{}return Object.entries(p).flatMap(([page,acts])=>Object.entries(acts||{}).filter(([action,scope])=>pageActions[page]?.includes(action)&&['none','own','department','all'].includes(scope)).map(([action,scope])=>({subject_type:'customrole',subject_id:roleId,department:'*',page,action,effect:scope==='none'?'deny':'allow',scope:(scope==='none'?'own':scope) as Scope})))}
