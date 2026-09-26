// Switchable product modules. A disabled module is hidden in navigation AND refused by the API:
// every permission page it owns resolves to "none" on the server (see access-policy.ts).
export type ModuleDef={id:string,label:string,description:string,pages:string[]};
export const modules:ModuleDef[]=[
 {id:'tickets',label:'Help desk & tickets',description:'Tickets, SLAs, queues and the board.',pages:['maintenance']},
 {id:'assets',label:'Assets',description:'Asset register, custody, audits and disposal.',pages:['assets']},
 {id:'inventory',label:'Inventory',description:'Stock items, stores, movements and reorder alerts.',pages:['inventory']},
 {id:'maintenance',label:'Schedules & maintenance',description:'Preventive plans and work orders.',pages:['schedules']},
 {id:'purchasing',label:'Purchasing',description:'Requisitions, approvals, orders, vendors, receipts and budgets.',pages:['requests','procurement','suppliers','receipts','budgets']},
 {id:'spaces',label:'Department spaces',description:'Intranet pages and announcements.',pages:['knowledge']},
 {id:'files',label:'Files & documents',description:'Folders, versions and sharing.',pages:['documents']},
 {id:'operations',label:'Operations',description:'IT/CCTV storage and consumer research.',pages:['it','research']},
 {id:'reports',label:'Reports',description:'Cross-module reports and exports.',pages:['reports']},
];
export const moduleIds=modules.map(m=>m.id);
// Pages owned by modules that are switched off for a workspace.
export function disabledPages(enabled:unknown){
 const on=Array.isArray(enabled)?new Set(enabled.map(String)):new Set(moduleIds);
 return modules.filter(m=>!on.has(m.id)).flatMap(m=>m.pages);
}
export function enabledModules(settings:Record<string,unknown>){return Array.isArray(settings.modules)?(settings.modules as string[]).filter(m=>moduleIds.includes(m)):[...moduleIds]}

// Plan defaults; a workspace can override limits in its settings.
export const planLimits:Record<string,{maxUsers:number,maxStorageMb:number}>={starter:{maxUsers:25,maxStorageMb:2048},business:{maxUsers:250,maxStorageMb:20480},enterprise:{maxUsers:5000,maxStorageMb:204800}};
