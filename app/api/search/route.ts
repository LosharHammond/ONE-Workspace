import {hasAction} from '../../access-policy';
import {route,all} from '../../server/core';
import {canSeeAsset,canSeeTicket,canSeeDoc,canSeeFile,canSeePage,type AssetRow,type TicketRow,type PurchaseRow,type FileRow,type PageRow} from '../../server/entities';
// One query box across the workspace. Every hit passes the same visibility rules as its module.
export const GET=route(async(req,u)=>{
 const q=(new URL(req.url).searchParams.get('q')||'').trim().slice(0,80);
 if(q.length<2)return {results:[]};
 const like=`%${q.replace(/[%_]/g,'')}%`;
 const [people,assets,tickets,docs,files,pages,vendors]=await Promise.all([
  hasAction(u,'people')?all<{id:string,name:string,email:string,department:string,title:string}>('SELECT id,name,email,department,title FROM members WHERE tenant_id=? AND active=1 AND (name LIKE ? OR email LIKE ? OR title LIKE ?) LIMIT 8',u.tenantId,like,like,like):[],
  all<AssetRow>('SELECT * FROM assets WHERE tenant_id=? AND (name LIKE ? OR code LIKE ? OR serial LIKE ? OR model LIKE ? OR category LIKE ?) LIMIT 40',u.tenantId,like,like,like,like,like),
  all<TicketRow>('SELECT * FROM tickets WHERE tenant_id=? AND (title LIKE ? OR number LIKE ? OR description LIKE ?) ORDER BY created_at DESC LIMIT 40',u.tenantId,like,like,like),
  all<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND (d.title LIKE ? OR d.number LIKE ?) ORDER BY d.created_at DESC LIMIT 40",u.tenantId,like,like),
  all<FileRow>('SELECT * FROM files WHERE tenant_id=? AND (name LIKE ? OR tags LIKE ? OR description LIKE ?) LIMIT 40',u.tenantId,like,like,like),
  all<PageRow>('SELECT * FROM pages WHERE tenant_id=? AND (title LIKE ? OR body LIKE ?) LIMIT 40',u.tenantId,like,like),
  hasAction(u,'suppliers')?all<{id:string,name:string,category:string}>('SELECT id,name,category FROM vendors WHERE tenant_id=? AND name LIKE ? LIMIT 6',u.tenantId,like):[],
 ]);
 const results=[
  ...people.map(p=>({type:'Person',id:p.id,title:p.name,sub:[p.title,p.department,p.email].filter(Boolean).join(' · '),link:`#/people/directory/${p.id}`})),
  ...tickets.filter(t=>canSeeTicket(u,t)).slice(0,8).map(t=>({type:'Ticket',id:t.id,title:t.title,sub:`${t.number} · ${t.status} · ${t.priority}`,link:`#/tickets/${t.id}`})),
  ...docs.filter(d=>canSeeDoc(u,d)).slice(0,8).map(d=>({type:d.kind==='PR'?'Requisition':'Purchase order',id:d.id,title:d.title,sub:`${d.number} · ${d.status}`,link:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`})),
  ...assets.filter(a=>canSeeAsset(u,a)).slice(0,8).map(a=>({type:'Asset',id:a.id,title:a.name,sub:`${a.code} · ${a.status}${a.location?' · '+a.location:''}`,link:`#/assets/${a.id}`})),
  ...pages.filter(p=>canSeePage(u,p)).slice(0,8).map(p=>({type:'Page',id:p.id,title:p.title,sub:p.department||'Company',link:`#/spaces/page/${p.id}`})),
  ...files.filter(f=>canSeeFile(u,f)).slice(0,8).map(f=>({type:'File',id:f.id,title:f.name,sub:f.department||'Company files',link:`#/files/${f.folder_id||'root'}/${f.id}`})),
  ...vendors.map(v=>({type:'Vendor',id:v.id,title:v.name,sub:v.category||'Vendor',link:`#/purchasing/vendors/${v.id}`})),
 ];
 return {results};
});
