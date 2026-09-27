import {first,stmt,now,parseJson} from './core';
import {defaultPackages,pageCatalog,type CatalogPage,type PagePackage} from '../page-catalog';

// Platform-wide settings owned by the Platform Owner, one JSON document per key.
export async function platformSetting<T>(key:string,fallback:T):Promise<T>{const r=await first<{value_json:string}>('SELECT value_json FROM platform_settings WHERE key=?',key);return r?parseJson<T>(r.value_json,fallback):fallback}
export function platformSettingStatement(key:string,value:unknown,by:string){return stmt('INSERT INTO platform_settings(key,value_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at',key,JSON.stringify(value),by,now())}

// Catalog with the Platform Owner's overrides (status, required plan, platform-only, dependencies) applied.
export type CatalogOverrides={pages?:Record<string,Partial<Pick<CatalogPage,'status'|'plan'|'dependsOn'|'description'>>&{platformOnly?:boolean,updatedAt?:string}>,packages?:PagePackage[]};
export async function effectiveCatalog(){
 const o=await platformSetting<CatalogOverrides>('catalog',{});
 const pages=pageCatalog.map(p=>{const x=o.pages?.[p.id];if(!x||p.kind!=='company')return p;return {...p,...(x.status?{status:x.status}:{}),...(x.plan?{plan:x.plan}:{}),...(x.description?{description:x.description}:{}),...(Array.isArray(x.dependsOn)?{dependsOn:x.dependsOn}:{}),kind:x.platformOnly?'platform' as const:p.kind,modifiedAt:x.updatedAt||null}});
 return {pages,packages:o.packages?.length?o.packages:defaultPackages,overrides:o};
}
