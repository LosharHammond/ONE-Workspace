import {canActOn,actionScope,departmentKey,type AccessRule} from '../access-policy';
import {statuses} from '../data';
import type {Item} from '../data';
// A signed-in person acting inside one workspace (tenantId). identityId is the global person;
// id is their membership in this workspace. During a Platform Owner support session, tenantId is the
// workspace being supported, id stays the owner's own membership and supportSessionId is set.
export type Member={id:string,name:string,email:string,role:'admin'|'manager'|'employee'|'viewer',department:string,active:number,tenantId:string,identityId:string,roleId?:string|null,managerId?:string|null,title?:string,phone?:string,location?:string,platformRole?:string|null,lastSeenAt?:string|null,mustChange?:number,rules?:AccessRule[],locations?:string[],disabledPages?:string[],extraDepartments?:string[],assetCategories?:string[],assetStatuses?:string[],assignedOnly?:boolean,rolePages?:string[]|null,supportSessionId?:string|null,homeTenantId?:string};
export function canRead(u:Member,r:Item){return canActOn(u,r.module,'view',r.department,r.createdBy)}
export function canWrite(u:Member,module:string,department:string){return canActOn(u,module,'create',department,u.id)&&(actionScope(u,module,'create')!=='own'||departmentKey(department)===departmentKey(u.department))}
export function canTransition(u:Member,r:Item,next:string){const action=['Approved','Rejected'].includes(next)?'approve':'update';if(!canActOn(u,r.module,action,r.department,r.createdBy))return false;if(!statuses[r.module]?.includes(next)||r.status===next)return false;if(['requests','procurement'].includes(r.module)){if(['Approved','Rejected'].includes(next))return r.status==='Pending'&&r.createdBy!==u.id;return r.status==='Approved'&&next==='Completed'}return true}
export function validDepartment(d:unknown):d is string{return typeof d==='string'&&d.trim().length>0&&d.length<=160}
// Location-restricted roles only see assets under their assigned locations.
export function inLocations(u:Member,location:string){if(u.role==='admin'||!u.locations?.length)return true;const l=(location||'').toLowerCase();return u.locations.some(x=>l.startsWith(x.toLowerCase()))}
// Role-level asset filters: category and status scopes, and "assigned assets only".
export function inAssetScope(u:Member,a:{category:string,status:string,assigned_to:string|null,location:string}){if(u.role==='admin')return true;if(u.assignedOnly&&a.assigned_to!==u.id)return false;if(u.assetCategories?.length&&!u.assetCategories.some(c=>c.toLowerCase()===(a.category||'').toLowerCase()))return false;if(u.assetStatuses?.length&&!u.assetStatuses.includes(a.status))return false;return inLocations(u,a.location)}
