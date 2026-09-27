import {canActOn,hasAction,departmentKey,actionScope} from '../access-policy';
import {first,HttpError,nextNumber,tenantOf,tenantSettings} from './core';
import {inAssetScope,type Member} from './policy';
import {aclOf,canView,canManage} from './acl';

// Row shapes and "who can see this" rules shared by routes, search and the dashboard.
export type AssetRow={id:string,code:string,name:string,category:string,kind:string,brand:string,model:string,serial:string,status:string,condition:string,location:string,department:string,assigned_to:string|null,purchase_date:string|null,purchase_cost:number,warranty_until:string|null,vendor:string,notes:string,source_id:string|null,created_by:string,created_at:string,updated_at:string,version:number};
export type TicketRow={id:string,number:string,title:string,description:string,type:string,category:string,subcategory:string,impact:string,urgency:string,affected_user_id:string|null,approval_status:string,approver_id:string|null,escalated_at:string|null,priority:string,status:string,department:string,assignee_id:string|null,requester_id:string,asset_id:string|null,location:string,due_at:string|null,resolved_at:string|null,created_at:string,updated_at:string,version:number};
export type PurchaseRow={cost_centre:string,budget_id:string|null,id:string,kind:'PR'|'PO',number:string,title:string,justification:string,department:string,location:string,requester_id:string,vendor_id:string|null,pr_id:string|null,needed_by:string|null,currency:string,subtotal:number,tax:number,total:number,status:string,terms:string,created_by:string,created_at:string,updated_at:string,submitted_at:string|null,version:number,approver_ids?:string|null};
export type FileRow={id:string,folder_id:string|null,name:string,mime:string,bytes:number,file_key:string,department:string,visibility:string,tags:string,description:string,version:number,uploaded_by:string,created_at:string,updated_at:string,acl_json?:string|null,owner_id?:string|null,space_id?:string|null,deleted_at?:string|null,legal_hold?:number,pinned?:number,category?:string,processing_status?:string};
export type PageRow={id:string,department:string,parent_id:string|null,kind:string,title:string,body:string,icon:string,status:string,pinned:number,author_id:string,updated_by:string,created_at:string,updated_at:string,version:number,acl_json?:string|null,space_id?:string|null,publish_at?:string|null,expires_at?:string|null,priority?:string,requires_ack?:number,approval_status?:string,deleted_at?:string|null};

export const canSeeAsset=(u:Member,a:AssetRow)=>!u.disabledPages?.includes('assets')&&(a.assigned_to===u.id||(canActOn(u,'assets','view',a.department,a.created_by)&&inAssetScope(u,a)));
export const canSeeTicket=(u:Member,t:TicketRow)=>t.requester_id===u.id||t.assignee_id===u.id||canActOn(u,'maintenance','view',t.department,t.requester_id);
export const canWorkTicket=(u:Member,t:TicketRow)=>t.assignee_id===u.id||canActOn(u,'maintenance','update',t.department,t.requester_id)&&actionScope(u,'maintenance','update')!=='own';
// Purchase documents: requesters, their department (by scope) and anyone in the approval chain.
export const docPage=(kind:string)=>kind==='PO'?'procurement':'requests';
export const isApprover=(u:Member,d:PurchaseRow)=>!!d.approver_ids&&d.approver_ids.split(',').includes(u.id);
export const canSeeDoc=(u:Member,d:PurchaseRow)=>d.requester_id===u.id||isApprover(u,d)||canActOn(u,docPage(d.kind),'view',d.department,d.requester_id)||(d.kind==='PR'&&hasAction(u,'procurement','create')&&['Approved','Converted'].includes(d.status));
// Files: deleted items are only visible through the recycle bin; otherwise the content ACL decides (legacy
// rows are mapped from their old visibility). The module permission is still required.
export const fileAcl=(f:FileRow)=>aclOf(f.acl_json,{visibility:f.visibility,department:f.department});
export const canSeeFile=(u:Member,f:FileRow)=>!f.deleted_at&&!u.disabledPages?.includes('documents')&&(u.role==='admin'||((f.owner_id||f.uploaded_by)===u.id)||(hasAction(u,'documents')&&canView(u,fileAcl(f),f.owner_id||f.uploaded_by)));
export const canEditFile=(u:Member,f:FileRow)=>!u.disabledPages?.includes('documents')&&(canManage(u,fileAcl(f),f.owner_id||f.uploaded_by)||(!f.acl_json&&canActOn(u,'documents','update',f.department||u.department,f.uploaded_by)));
// Pages and announcements: a content ACL (when set) decides the audience; scheduled items appear from their
// publish time and expired announcements disappear for readers (authors, editors and admins still see them).
export const pageLive=(p:PageRow)=>p.status==='Published'&&(!p.publish_at||p.publish_at<=new Date().toISOString())&&(!p.expires_at||p.expires_at>new Date().toISOString());
export const canSeePage=(u:Member,p:PageRow)=>!p.deleted_at&&hasAction(u,'knowledge')&&(canEditPage(u,p)||(pageLive(p)&&(p.acl_json?canView(u,aclOf(p.acl_json),p.author_id):true)));
export const canEditPage=(u:Member,p:{department:string,author_id:string,acl_json?:string|null})=>u.role==='admin'||p.author_id===u.id||(!!p.acl_json&&canManage(u,aclOf(p.acl_json),p.author_id))||(!!p.department&&canActOn(u,'knowledge','update',p.department,p.author_id))||(!p.department&&actionScope(u,'knowledge','update')==='all');

// Resolves an entity for comments and throws when the person cannot see it.
export async function visibleEntity(u:Member,type:string,id:string){
 let ok=false,link='',title='',notifyIds:(string|null)[]=[];
 if(type==='ticket'){const t=await first<TicketRow>('SELECT * FROM tickets WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!t&&canSeeTicket(u,t);if(t){link=`#/tickets/${t.id}`;title=`${t.number} · ${t.title}`;notifyIds=[t.requester_id,t.assignee_id]}}
 else if(type==='asset'){const a=await first<AssetRow>('SELECT * FROM assets WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!a&&canSeeAsset(u,a);if(a){link=`#/assets/${a.id}`;title=`${a.code} · ${a.name}`;notifyIds=[a.assigned_to]}}
 else if(type==='PR'||type==='PO'){const d=await first<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.id=? AND d.tenant_id=? AND d.kind=?",id,u.tenantId,type);ok=!!d&&canSeeDoc(u,d);if(d){link=`#/purchasing/${type.toLowerCase()}/${d.id}`;title=`${d.number} · ${d.title}`;notifyIds=[d.requester_id,...(d.approver_ids||'').split(',')]}}
 else if(type==='work_order'){const w=await first<{id:string,number:string,title:string,department:string,assignee_id:string|null,created_by:string}>('SELECT id,number,title,department,assignee_id,created_by FROM work_orders WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!w&&(w.assignee_id===u.id||canActOn(u,'schedules','view',w.department||u.department,w.created_by));if(w){link=`#/maintenance/orders/${w.id}`;title=`${w.number} · ${w.title}`;notifyIds=[w.assignee_id]}}
 else if(type==='page'){const p=await first<PageRow>('SELECT * FROM pages WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!p&&canSeePage(u,p);if(p){link=`#/spaces/page/${p.id}`;title=p.title;notifyIds=[p.author_id]}}
 else if(type==='task'||type==='project'){const c=await import('./collab');if(type==='task'){const {task:t}=await c.loadTask(u,id);ok=true;link=`#/tasks/all/${t.id}`;title=t.title;notifyIds=[t.owner_id,...c.assigneesOf(t),...(t.watchers||'').split(',')]}else{const p=await c.loadProject(u,id);ok=true;link=`#/projects/${p.id}`;title=`${p.code} · ${p.name}`;notifyIds=[p.manager_id,p.owner_id]}}
 if(!ok)throw new HttpError(404,'Item not found.');
 return {link,title,notifyIds};
}

// Next continuous asset code for the workspace, e.g. AST-00042.
export async function newAssetCode(u:{tenantId:string}){const t=await tenantOf(u);return nextNumber(u.tenantId,String(tenantSettings(t).assetPrefix||'AST'),false)}
