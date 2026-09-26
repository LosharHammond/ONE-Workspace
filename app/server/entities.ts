import {canActOn,hasAction,departmentKey,actionScope} from '../access-policy';
import {first,HttpError,nextNumber,tenantOf,tenantSettings} from './core';
import {inAssetScope,type Member} from './policy';

// Row shapes and "who can see this" rules shared by routes, search and the dashboard.
export type AssetRow={id:string,code:string,name:string,category:string,kind:string,brand:string,model:string,serial:string,status:string,condition:string,location:string,department:string,assigned_to:string|null,purchase_date:string|null,purchase_cost:number,warranty_until:string|null,vendor:string,notes:string,source_id:string|null,created_by:string,created_at:string,updated_at:string,version:number};
export type TicketRow={id:string,number:string,title:string,description:string,type:string,category:string,subcategory:string,impact:string,urgency:string,affected_user_id:string|null,approval_status:string,approver_id:string|null,escalated_at:string|null,priority:string,status:string,department:string,assignee_id:string|null,requester_id:string,asset_id:string|null,location:string,due_at:string|null,resolved_at:string|null,created_at:string,updated_at:string,version:number};
export type PurchaseRow={cost_centre:string,budget_id:string|null,id:string,kind:'PR'|'PO',number:string,title:string,justification:string,department:string,location:string,requester_id:string,vendor_id:string|null,pr_id:string|null,needed_by:string|null,currency:string,subtotal:number,tax:number,total:number,status:string,terms:string,created_by:string,created_at:string,updated_at:string,submitted_at:string|null,version:number,approver_ids?:string|null};
export type FileRow={id:string,folder_id:string|null,name:string,mime:string,bytes:number,file_key:string,department:string,visibility:string,tags:string,description:string,version:number,uploaded_by:string,created_at:string,updated_at:string};
export type PageRow={id:string,department:string,parent_id:string|null,kind:string,title:string,body:string,icon:string,status:string,pinned:number,author_id:string,updated_by:string,created_at:string,updated_at:string,version:number};

export const canSeeAsset=(u:Member,a:AssetRow)=>!u.disabledPages?.includes('assets')&&(a.assigned_to===u.id||(canActOn(u,'assets','view',a.department,a.created_by)&&inAssetScope(u,a)));
export const canSeeTicket=(u:Member,t:TicketRow)=>t.requester_id===u.id||t.assignee_id===u.id||canActOn(u,'maintenance','view',t.department,t.requester_id);
export const canWorkTicket=(u:Member,t:TicketRow)=>t.assignee_id===u.id||canActOn(u,'maintenance','update',t.department,t.requester_id)&&actionScope(u,'maintenance','update')!=='own';
// Purchase documents: requesters, their department (by scope) and anyone in the approval chain.
export const docPage=(kind:string)=>kind==='PO'?'procurement':'requests';
export const isApprover=(u:Member,d:PurchaseRow)=>!!d.approver_ids&&d.approver_ids.split(',').includes(u.id);
export const canSeeDoc=(u:Member,d:PurchaseRow)=>d.requester_id===u.id||isApprover(u,d)||canActOn(u,docPage(d.kind),'view',d.department,d.requester_id)||(d.kind==='PR'&&hasAction(u,'procurement','create')&&['Approved','Converted'].includes(d.status));
export const canSeeFile=(u:Member,f:FileRow)=>u.role==='admin'||f.uploaded_by===u.id||(hasAction(u,'documents')&&(f.visibility==='company'||(f.visibility==='department'&&(departmentKey(f.department)===departmentKey(u.department)||actionScope(u,'documents','view')==='all'))));
export const canEditFile=(u:Member,f:FileRow)=>u.role==='admin'||f.uploaded_by===u.id||canActOn(u,'documents','update',f.department||u.department,f.uploaded_by);
export const canSeePage=(u:Member,p:PageRow)=>hasAction(u,'knowledge')&&(p.status==='Published'||p.author_id===u.id||canEditPage(u,p));
export const canEditPage=(u:Member,p:{department:string,author_id:string})=>u.role==='admin'||p.author_id===u.id||(!!p.department&&canActOn(u,'knowledge','update',p.department,p.author_id))||(!p.department&&actionScope(u,'knowledge','update')==='all');

// Resolves an entity for comments and throws when the person cannot see it.
export async function visibleEntity(u:Member,type:string,id:string){
 let ok=false,link='',title='',notifyIds:(string|null)[]=[];
 if(type==='ticket'){const t=await first<TicketRow>('SELECT * FROM tickets WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!t&&canSeeTicket(u,t);if(t){link=`#/tickets/${t.id}`;title=`${t.number} · ${t.title}`;notifyIds=[t.requester_id,t.assignee_id]}}
 else if(type==='asset'){const a=await first<AssetRow>('SELECT * FROM assets WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!a&&canSeeAsset(u,a);if(a){link=`#/assets/${a.id}`;title=`${a.code} · ${a.name}`;notifyIds=[a.assigned_to]}}
 else if(type==='PR'||type==='PO'){const d=await first<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.id=? AND d.tenant_id=? AND d.kind=?",id,u.tenantId,type);ok=!!d&&canSeeDoc(u,d);if(d){link=`#/purchasing/${type.toLowerCase()}/${d.id}`;title=`${d.number} · ${d.title}`;notifyIds=[d.requester_id,...(d.approver_ids||'').split(',')]}}
 else if(type==='work_order'){const w=await first<{id:string,number:string,title:string,department:string,assignee_id:string|null,created_by:string}>('SELECT id,number,title,department,assignee_id,created_by FROM work_orders WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!w&&(w.assignee_id===u.id||canActOn(u,'schedules','view',w.department||u.department,w.created_by));if(w){link=`#/maintenance/orders/${w.id}`;title=`${w.number} · ${w.title}`;notifyIds=[w.assignee_id]}}
 else if(type==='page'){const p=await first<PageRow>('SELECT * FROM pages WHERE id=? AND tenant_id=?',id,u.tenantId);ok=!!p&&canSeePage(u,p);if(p){link=`#/spaces/page/${p.id}`;title=p.title;notifyIds=[p.author_id]}}
 if(!ok)throw new HttpError(404,'Item not found.');
 return {link,title,notifyIds};
}

// Next continuous asset code for the workspace, e.g. AST-00042.
export async function newAssetCode(u:{tenantId:string}){const t=await tenantOf(u);return nextNumber(u.tenantId,String(tenantSettings(t).assetPrefix||'AST'),false)}
