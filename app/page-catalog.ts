// Central Page Catalog. Every page a company can be given has a stable id (the same id the permission
// matrix uses), metadata for the Platform Console, the actions it supports, the plan it needs and the pages
// it depends on. Entitlements (which pages a workspace receives) and role page lists are validated against
// this catalog on the server; the browser uses it only for display.
import {pageActions,pageLabels} from './access-policy';

export type PagePlan='starter'|'business'|'enterprise';
export type PageKind='core'|'company'|'platform';
export type CatalogPage={id:string,name:string,description:string,icon:string,route:string,module:string,actions:string[],plan:PagePlan,status:'stable'|'beta',kind:PageKind,dependsOn:string[],connectors:string[],flags:string[],version:string};

const P=(id:string,description:string,icon:string,route:string,module:string,plan:PagePlan,extra:Partial<CatalogPage>={}):CatalogPage=>({id,name:pageLabels[id]||id,description,icon,route,module,actions:pageActions[id]||['view'],plan,status:'stable',kind:'company',dependsOn:[],connectors:[],flags:[],version:'1.0',...extra});

export const pageCatalog:CatalogPage[]=[
 // Core pages: every workspace has them; they cannot be removed.
 P('overview','Personal home: focus queue, pulse and announcements.','House','home','core','starter',{kind:'core'}),
 P('settings','Company settings, numbering, roles and Manage users.','Settings2','admin/company','core','starter',{kind:'core'}),
 P('audit','Workspace activity and security log.','History','admin/activity','core','starter',{kind:'core'}),
 // Company-assignable pages.
 P('people','People directory and org chart.','Contact','people/directory','people','starter'),
 P('locations','Sites, buildings, stores and the location tree.','MapPin','people/locations','people','starter'),
 P('maintenance','Help desk: tickets, SLAs, queues and the board.','LifeBuoy','tickets','tickets','starter'),
 P('assets','Asset register, custody, audits and disposal.','Boxes','assets/all','assets','starter'),
 P('schedules','Preventive plans and work orders.','Wrench','maintenance/orders','maintenance','business',{dependsOn:['assets']}),
 P('inventory','Stock items, stores, movements and reorder alerts.','Package','inventory/items','inventory','business'),
 P('requests','Purchase requisitions and the approvals inbox.','ClipboardList','purchasing/pr','purchasing','business'),
 P('procurement','Purchase orders and quotations.','FileText','purchasing/po','purchasing','business',{dependsOn:['requests','suppliers']}),
 P('suppliers','Vendor register.','Store','purchasing/vendors','purchasing','business'),
 P('receipts','Goods receipts and returns.','Truck','purchasing/po','purchasing','business',{dependsOn:['procurement']}),
 P('budgets','Budgets and cost-centre spend.','PiggyBank','purchasing/budgets','purchasing','business',{dependsOn:['requests']}),
 P('knowledge','Department spaces, wiki pages and announcements.','LibraryBig','spaces','spaces','starter'),
 P('documents','Files, folders, versions and sharing.','FolderClosed','files','files','starter'),
 P('reports','Cross-module reports and CSV exports.','ChartColumn','reports','reports','business'),
 P('it','IT & CCTV storage monitoring.','HardDrive','ops/it','operations','business'),
 P('research','Consumer research recordings and AI summaries.','FlaskConical','ops/research','operations','enterprise'),
 P('company-data','Data hub: imported registers and promotion to live records.','DatabaseZap','admin/data','data','enterprise'),
 P('assistant','Floating AI assistant and AI actions on every page.','Sparkles','home','ai','starter'),
 P('connectors','Connector Center: Microsoft, Google, REST, webhooks and MCP servers.','Link','admin/connectors','integrations','business'),
 P('app-pages','Custom pages built with the visual page and widget builder.','LayoutGrid','pages','builder','business'),
 // Platform-only pages: never assignable to a company.
 {id:'platform.workspaces',name:'Workspaces',description:'Create, configure, suspend and enter company workspaces.',icon:'Building',route:'platform/workspaces',module:'platform',actions:['view'],plan:'enterprise',status:'stable',kind:'platform',dependsOn:[],connectors:[],flags:[],version:'1.0'},
 {id:'platform.catalog',name:'Page catalog',description:'All pages, packages and entitlements.',icon:'LayoutGrid',route:'platform/catalog',module:'platform',actions:['view'],plan:'enterprise',status:'stable',kind:'platform',dependsOn:[],connectors:[],flags:[],version:'1.0'},
 {id:'platform.connectors',name:'Platform connectors',description:'Global connectors and the default AI provider.',icon:'Link',route:'platform/connectors',module:'platform',actions:['view'],plan:'enterprise',status:'stable',kind:'platform',dependsOn:[],connectors:[],flags:[],version:'1.0'},
 {id:'platform.audit',name:'Platform audit',description:'Every platform action and support-session request.',icon:'ScrollText',route:'platform/audit',module:'platform',actions:['view'],plan:'enterprise',status:'stable',kind:'platform',dependsOn:[],connectors:[],flags:[],version:'1.0'},
];
export const catalogById=new Map(pageCatalog.map(p=>[p.id,p]));
export const corePages=pageCatalog.filter(p=>p.kind==='core').map(p=>p.id);
export const assignablePages=pageCatalog.filter(p=>p.kind==='company').map(p=>p.id);
export const planRank:Record<PagePlan,number>={starter:0,business:1,enterprise:2};

// Default packages. The Platform Owner can edit these and add more (stored in platform settings).
export type PagePackage={id:string,name:string,description:string,pages:string[]};
const starter=['people','locations','maintenance','assets','knowledge','documents','assistant'];
const business=[...starter,'schedules','inventory','requests','procurement','suppliers','receipts','budgets','reports','it','connectors','app-pages'];
export const defaultPackages:PagePackage[]=[
 {id:'starter',name:'Starter',description:'Help desk, assets, people, spaces, files and the AI assistant.',pages:starter},
 {id:'business',name:'Business',description:'Starter plus purchasing, inventory, maintenance, reports, connectors and the page builder.',pages:business},
 {id:'enterprise',name:'Enterprise',description:'Every company page.',pages:[...assignablePages]},
];

// Adds the pages a selection depends on (e.g. purchase orders need requisitions and vendors).
export function withDependencies(pages:string[]){const out=new Set(pages.filter(p=>catalogById.get(p)?.kind==='company'));let grew=true;while(grew){grew=false;for(const p of [...out])for(const d of catalogById.get(p)?.dependsOn||[])if(!out.has(d)){out.add(d);grew=true}}return [...out]}
