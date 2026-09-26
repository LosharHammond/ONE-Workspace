import {currentUser,configured,json,failure,all,first,tenantOf,tenantSettings,sameOrigin,readBody,HttpError,idOf,stmt,batch,sessionToken,hash,uid,now} from '../../server/core';
import {permissionMap} from '../../access-policy';
import {enabledModules} from '../../modules';
// Boot payload for the app shell: who you are, the workspace you are acting in (always decided
// on the server), what you can do, and the lightweight lists every picker needs.
export async function GET(req:Request){try{
 const u=await currentUser(req);
 if(!u)return json({mode:'signed-out',ready:configured()});
 if(u.mustChange)return json({mode:'must-change',user:{name:u.name,email:u.email}});
 const t=await tenantOf(u);
 const [people,departments,locations,roles,unread,approvals,tickets,memberships,support,role]=await Promise.all([
  all('SELECT id,name,email,department,title,role,role_id AS roleId,location,active FROM members WHERE tenant_id=? ORDER BY name',u.tenantId),
  all("SELECT id,name,code,head_id AS headId,color,description,parent_id AS parentId,cost_centre AS costCentre,status FROM departments WHERE tenant_id=? ORDER BY name",u.tenantId),
  all('SELECT id,name,path,parent_id AS parentId,kind FROM locations WHERE tenant_id=? ORDER BY path',u.tenantId),
  all('SELECT id,name,base FROM roles WHERE tenant_id=? ORDER BY name',u.tenantId),
  first<{n:number}>('SELECT count(*) AS n FROM notifications WHERE member_id=? AND tenant_id=? AND read_at IS NULL',u.id,u.tenantId),
  first<{n:number}>("SELECT count(*) AS n FROM approvals a JOIN purchase_docs d ON d.id=a.doc_id WHERE a.tenant_id=? AND a.status='Pending' AND d.requester_id!=? AND EXISTS(SELECT 1 FROM json_each(a.approver_ids) j WHERE j.value=?)",u.tenantId,u.id,u.id),
  first<{n:number}>("SELECT count(*) AS n FROM tickets WHERE tenant_id=? AND assignee_id=? AND status NOT IN ('Resolved','Closed')",u.tenantId,u.id),
  // Only memberships of this identity in active workspaces are offered in the switcher.
  all<{id:string,tenantId:string,name:string,brandColor:string}>("SELECT m.id,m.tenant_id AS tenantId,t.name,t.brand_color AS brandColor FROM members m JOIN tenants t ON t.id=m.tenant_id WHERE m.identity_id=? AND m.active=1 AND t.status='active' ORDER BY t.name",u.identityId),
  u.supportSessionId?first('SELECT id,reason,started_at AS startedAt FROM support_sessions WHERE id=?',u.supportSessionId):null,
  u.roleId?first<{default_screen:string}>('SELECT default_screen FROM roles WHERE id=? AND tenant_id=?',u.roleId,u.tenantId):null,
 ]);
 const settings=tenantSettings(t);
 // During support the owner is shown by name even though they are not a member of this workspace.
 if(u.supportSessionId)people.push({id:u.id,name:`${u.name} (Platform support)`,email:u.email,department:'Platform support',title:'Platform Owner',role:'admin',roleId:null,location:'',active:0});
 return json({mode:'live',
  user:{id:u.id,identityId:u.identityId,name:u.name,email:u.email,role:u.role,roleId:u.roleId,department:u.department,title:u.title,location:u.location,platformRole:u.platformRole||null,permissions:permissionMap(u),defaultScreen:role?.default_screen||''},
  tenant:{id:t.id,name:t.name,legalName:t.legal_name,slug:t.slug,brandColor:t.brand_color,currency:t.currency,timezone:t.timezone,domains:t.domains,plan:t.plan,status:t.status,settings,modules:enabledModules(settings)},
  support:support?{...support,tenantName:t.name}:null,
  memberships:u.supportSessionId?[]:memberships,
  people,departments,locations,roles,
  counts:{notifications:unread?.n||0,approvals:approvals?.n||0,tickets:tickets?.n||0}});
 }catch(e){return failure(e)}}

// Switch the active workspace. The target membership must belong to the signed-in identity
// and be active in an active workspace; the browser only names which of its own memberships.
export async function POST(req:Request){try{
 sameOrigin(req);
 const u=await currentUser(req);if(!u)throw new HttpError(401,'Sign in first.');
 if(u.supportSessionId)throw new HttpError(409,'Exit the support session first.');
 const b=await readBody(req);const memberId=idOf(b.memberId,'Workspace');
 const m=await first<{id:string,tenant_id:string}>("SELECT m.id,m.tenant_id FROM members m JOIN tenants t ON t.id=m.tenant_id WHERE m.id=? AND m.identity_id=? AND m.active=1 AND t.status='active'",memberId,u.identityId);
 if(!m)throw new HttpError(404,'Workspace not available.');
 await batch([stmt('UPDATE sessions SET member_id=? WHERE token_hash=? AND identity_id=?',m.id,await hash(sessionToken(req)),u.identityId),stmt('UPDATE identities SET last_member_id=? WHERE id=?',m.id,u.identityId),stmt('INSERT INTO audit(id,action,actor,record_id,department,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)',uid(),'Switched into workspace',m.id,m.id,'',now(),m.tenant_id)]);
 return json({ok:true});
}catch(e){return failure(e)}}
