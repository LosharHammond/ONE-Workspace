// Product modules are bundles of catalog pages. What a workspace actually receives is its page
// entitlement list (settings.pages). A page outside it is hidden in navigation AND refused by the API:
// every permission on it resolves to "none" on the server (see access-policy.ts), even for administrators.
import {assignablePages,catalogById,defaultPackages} from './page-catalog';
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
 {id:'people',label:'People directory',description:'Directory, org chart and locations.',pages:['people','locations']},
 {id:'ai',label:'AI assistant',description:'Floating assistant and AI actions.',pages:['assistant']},
 {id:'integrations',label:'Connectors',description:'External apps, APIs and MCP servers.',pages:['connectors']},
 {id:'builder',label:'Page builder',description:'Custom pages and widgets.',pages:['app-pages']},
 {id:'data',label:'Data hub',description:'Imported registers.',pages:['company-data']},
 {id:'projects',label:'Projects',description:'Project planning, finance and delivery.',pages:['projects']},
 {id:'tasks',label:'Tasks',description:'Task planner.',pages:['tasks']},
 {id:'messages',label:'Messages',description:'Company messaging.',pages:['messages']},
];
export const moduleIds=modules.map(m=>m.id);
// Modules that existed before page entitlements. Workspaces created then store only settings.modules;
// modules added later count as enabled for them until the Platform Owner sets explicit pages.
export const legacyModules=['tickets','assets','inventory','maintenance','purchasing','spaces','files','operations','reports'];

// The company pages a workspace is entitled to (core pages are always available and not listed).
export function entitledPages(settings:Record<string,unknown>):string[]{
 // Pages added to the catalog later (flag "autoGrant") are included unless the Platform Owner removed them.
 if(Array.isArray(settings.pages)){const excluded=new Set(Array.isArray(settings.pagesExcluded)?settings.pagesExcluded.map(String):[]);const base=settings.pages.map(String).filter(p=>assignablePages.includes(p));return [...base,...assignablePages.filter(p=>!base.includes(p)&&!excluded.has(p)&&catalogById.get(p)?.flags.includes('autoGrant'))]}
 if(!Array.isArray(settings.modules))return [...assignablePages];
 const on=new Set((settings.modules as unknown[]).map(String));
 return modules.filter(m=>on.has(m.id)||!legacyModules.includes(m.id)).flatMap(m=>m.pages).filter(p=>catalogById.get(p)?.status!=='beta');
}
// Pages the workspace does not have: refused everywhere.
export function blockedPages(settings:Record<string,unknown>){const on=new Set(entitledPages(settings));return assignablePages.filter(p=>!on.has(p))}
// Kept for callers that only know module switches.
export function disabledPages(enabled:unknown){return blockedPages({modules:enabled})}
// Modules with at least one entitled page (used for navigation).
export function enabledModules(settings:Record<string,unknown>){const on=new Set(entitledPages(settings));return modules.filter(m=>m.pages.some(p=>on.has(p))).map(m=>m.id)}
export function pagesForModules(ids:string[]){const on=new Set(ids);return modules.filter(m=>on.has(m.id)).flatMap(m=>m.pages)}
export {defaultPackages};

// Plan defaults; a workspace can override limits in its settings.
export type PlanLimits={maxUsers:number,maxStorageMb:number,aiRequestsPerMonth:number,maxConnectors:number};
export const planLimits:Record<string,PlanLimits>={
 starter:{maxUsers:25,maxStorageMb:2048,aiRequestsPerMonth:500,maxConnectors:2},
 business:{maxUsers:250,maxStorageMb:20480,aiRequestsPerMonth:5000,maxConnectors:15},
 enterprise:{maxUsers:5000,maxStorageMb:204800,aiRequestsPerMonth:50000,maxConnectors:100},
};
