import {currentUser,configured,json,failure,all,first,tenantOf,tenantSettings} from '../../server/core';
import {permissionMap} from '../../access-policy';
// Boot payload for the app shell: who you are, your company, what you can do,
// and the lightweight lists every picker needs.
export async function GET(req:Request){try{
 const u=await currentUser(req);
 if(!u)return json({mode:'signed-out',ready:configured()});
 if(u.mustChange)return json({mode:'must-change',user:{name:u.name,email:u.email}});
 const t=await tenantOf(u);
 const [people,departments,locations,roles,unread,approvals,tickets]=await Promise.all([
  all('SELECT id,name,email,department,title,role,role_id AS roleId,location,active FROM members WHERE tenant_id=? ORDER BY name',u.tenantId),
  all('SELECT id,name,code,head_id AS headId,color,description FROM departments WHERE tenant_id=? ORDER BY name',u.tenantId),
  all('SELECT id,name,path,parent_id AS parentId,kind FROM locations WHERE tenant_id=? ORDER BY path',u.tenantId),
  all('SELECT id,name,base FROM roles WHERE tenant_id=? ORDER BY name',u.tenantId),
  first<{n:number}>('SELECT count(*) AS n FROM notifications WHERE member_id=? AND read_at IS NULL',u.id),
  first<{n:number}>("SELECT count(*) AS n FROM approvals a JOIN purchase_docs d ON d.id=a.doc_id WHERE a.tenant_id=? AND a.status='Pending' AND d.requester_id!=? AND EXISTS(SELECT 1 FROM json_each(a.approver_ids) j WHERE j.value=?)",u.tenantId,u.id,u.id),
  first<{n:number}>("SELECT count(*) AS n FROM tickets WHERE tenant_id=? AND assignee_id=? AND status NOT IN ('Resolved','Closed')",u.tenantId,u.id),
 ]);
 const settings=tenantSettings(t);
 return json({mode:'live',
  user:{id:u.id,name:u.name,email:u.email,role:u.role,roleId:u.roleId,department:u.department,title:u.title,location:u.location,platformRole:u.platformRole||null,permissions:permissionMap(u)},
  tenant:{id:t.id,name:t.name,legalName:t.legal_name,slug:t.slug,brandColor:t.brand_color,currency:t.currency,timezone:t.timezone,domains:t.domains,plan:t.plan,settings},
  people,departments,locations,roles,
  counts:{notifications:unread?.n||0,approvals:approvals?.n||0,tickets:tickets?.n||0}});
 }catch(e){return failure(e)}}
