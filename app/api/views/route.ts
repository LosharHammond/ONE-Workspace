import {route,readBody,HttpError,all,stmt,batch,uid,now,str,idOf} from '../../server/core';
// Saved table views (filters, sort, columns) are personal and scoped to the workspace.
export const GET=route(async(req,u)=>{
 const grid=str(new URL(req.url).searchParams.get('grid'),'Table',60);
 return {views:(await all<{id:string,name:string,state_json:string}>('SELECT id,name,state_json FROM saved_views WHERE tenant_id=? AND member_id=? AND grid_id=? ORDER BY name',u.tenantId,u.id,grid)).map(v=>({id:v.id,name:v.name,state:JSON.parse(v.state_json)}))};
});
export const POST=route(async(req,u)=>{
 const b=await readBody(req,20000);
 if(b.action==='delete'){await batch([stmt('DELETE FROM saved_views WHERE id=? AND tenant_id=? AND member_id=?',idOf(b.id,'View'),u.tenantId,u.id)]);return {ok:true}}
 const state=b.state&&typeof b.state==='object'?b.state:null;if(!state)throw new HttpError(400,'Nothing to save.');
 const json=JSON.stringify(state);if(json.length>8000)throw new HttpError(413,'This view is too large to save.');
 const count=await all('SELECT id FROM saved_views WHERE tenant_id=? AND member_id=?',u.tenantId,u.id);if(count.length>=200)throw new HttpError(409,'Delete some saved views first.');
 const id=uid();await batch([stmt('INSERT INTO saved_views(id,tenant_id,member_id,grid_id,name,state_json,created_at) VALUES(?,?,?,?,?,?,?)',id,u.tenantId,u.id,str(b.grid,'Table',60),str(b.name,'View name',60),json,now())]);
 return {id};
});
