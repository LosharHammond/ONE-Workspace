import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,idOf,str,oneOf,all,first,now,stmt,batch,auditStatement} from '../../server/core';
import {browseNodes,context,explainPath,findNode,graphIndexing,graphStats,NODE_LABELS,RELATIONSHIPS,searchNodes,addRelationship,removeRelationship,brokenRelationships,pruneBroken,visibleNodes} from '../../server/graph';
import {connectedContext} from '../../server/graph-context';
import {enqueueStatement,kick} from '../../server/jobs';
import {emitStatement,retryEvent,processEvents} from '../../server/events';

// The Work Graph API. The browser never supplies a tenant identifier: every read and write is bound to the
// authenticated membership (or an audited support session), and every node is re-authorised against its
// source module before it is returned, linked, or used as a stepping stone.
export const GET=route(async(req,u)=>{
 if(!hasAction(u,'graph','view'))throw new HttpError(403,'You do not have access to the Work Graph.');
 const q=new URL(req.url).searchParams;
 const type=q.get('type')||'any';const id=q.get('id');
 // Bring this workspace's pending changes into the graph before answering (bounded).
 await processEvents(20,u.tenantId).catch(()=>0);
 if(q.get('view')==='context'&&id)return connectedContext(u,type,idOf(id,'Record'));
 if(q.get('view')==='relationships')return {relationships:Object.entries(RELATIONSHIPS).map(([k,v])=>({id:k,...v})),types:NODE_LABELS};
 if(q.get('view')==='health'){if(u.role!=='admin'&&!hasAction(u,'graph','export'))throw new HttpError(403,'Only administrators see graph health.');return {stats:await graphStats(u.tenantId),broken:await brokenRelationships(u),events:await all("SELECT id,type,entity_id AS entityId,action,status,attempts,error,created_at AS createdAt FROM domain_events WHERE tenant_id=? AND status IN ('failed','retrying','deferred') ORDER BY created_at DESC LIMIT 100",u.tenantId)}}
 const types=q.getAll('types').flatMap(v=>v.split(',')).map(x=>x.trim()).filter(x=>x in NODE_LABELS).slice(0,20);
 if(id){
  const root=await findNode(u,type,idOf(id,'Record'));
  const from=q.get('from'),to=q.get('to');
  const options={depth:Math.min(3,Math.max(1,Number(q.get('depth'))||1)),types,relationships:q.getAll('relationship').flatMap(v=>v.split(',')).filter(x=>x in RELATIONSHIPS).slice(0,20),from:from?str(from,'Start date',40):undefined,to:to?str(to,'End date',40):undefined,department:q.get('department')?str(q.get('department'),'Department',160):undefined,location:q.get('location')?str(q.get('location'),'Location',200):undefined};
  const graph=await context(u,root,options);
  if(q.has('toId')){const end=await findNode(u,q.get('toType')||'any',idOf(q.get('toId'),'Related record'));return {graph,path:await explainPath(u,root,end)}}
  return {graph};
 }
 const query=(q.get('q')||'').slice(0,240);
 const nodes=query.trim()?await searchNodes(u,query,types,60):await browseNodes(u,types,60);
 return {nodes,indexing:await graphIndexing(u.tenantId),operations:u.role==='admin'?await graphStats(u.tenantId):undefined};
},{module:'graph'});

export const POST=route(async(req,u)=>{
 if(!hasAction(u,'graph','view'))throw new HttpError(403,'You do not have access to the Work Graph.');
 const b=await readBody(req);const action=String(b.action||'');
 if(action==='relate'){
  // People connect records they can see; the relationship is audited and becomes a domain event.
  const from=await findNode(u,str(b.fromType,'Record type',40),idOf(b.fromId,'Record'));
  const to=await findNode(u,str(b.toType,'Related record type',40),idOf(b.toId,'Related record'));
  const type=oneOf(b.relationship||'related_to',Object.keys(RELATIONSHIPS),'relationship');
  const id=await addRelationship(u,from,to,type,'user',{expiresAt:b.expiresAt?str(b.expiresAt,'Expiry',40):null,meta:b.note?{note:str(b.note,'Note',300)}:{}});
  await emitStatement(u.tenantId,'graph.relationship',from.source_id,{type:from.type,relationship:type,to:{type:to.type,id:to.source_id}},u.id,'Relationship added').run();
  return {id};
 }
 if(action==='accept-suggestion'||action==='reject-suggestion'){
  // AI-suggested relationships stay pending (low confidence, marked in metadata) until a person decides.
  const e=await first<{id:string,src_id:string,dst_id:string,meta_json:string}>("SELECT id,src_id,dst_id,meta_json FROM graph_edges WHERE id=? AND tenant_id=? AND origin='ai' AND removed_at IS NULL",idOf(b.id,'Suggestion'),u.tenantId);if(!e)throw new HttpError(404,'Suggestion not found.');
  // Deciding requires seeing both ends, like any other relationship change.
  const ends=await all<import('../../server/graph').GraphNode>('SELECT * FROM graph_nodes WHERE tenant_id=? AND id IN (?,?)',u.tenantId,e.src_id,e.dst_id);const vis=await visibleNodes(u,ends);if(ends.length<2||ends.some(n=>!vis.has(n.id)))throw new HttpError(404,'Suggestion not found.');
  const meta={...JSON.parse(e.meta_json||'{}'),pending:false,decidedBy:u.id,decision:action==='accept-suggestion'?'accepted':'rejected'};
  await batch([stmt(action==='accept-suggestion'?"UPDATE graph_edges SET meta_json=? WHERE id=? AND tenant_id=?":'UPDATE graph_edges SET meta_json=?,removed_at=? WHERE id=? AND tenant_id=?',...(action==='accept-suggestion'?[JSON.stringify(meta),e.id,u.tenantId]:[JSON.stringify(meta),now(),e.id,u.tenantId])),auditStatement(u,action==='accept-suggestion'?'AI relationship suggestion accepted':'AI relationship suggestion rejected',ends[0].source_id,ends[0].department||'',null,{edge:e.id})]);
  return {ok:true};
 }
 if(action==='unrelate'){await removeRelationship(u,idOf(b.edgeId,'Relationship'));return {ok:true}}
 if(u.role!=='admin')throw new HttpError(403,'Only administrators maintain the Work Graph.');
 if(action==='rebuild'){await enqueueStatement(u.tenantId,'graph.rebuild','0:0',{table:0,offset:0},{key:`graph-rebuild:manual:${now().slice(0,16)}`,maxAttempts:5}).run();kick(3);return {queued:true}}
 if(action==='prune'){const r=await pruneBroken(u);return {removed:r.meta.changes}}
 if(action==='retry-event'){await retryEvent(u.tenantId,idOf(b.id,'Event'));kick(3);return {ok:true}}
 throw new HttpError(400,'Unknown action.');
},{module:'graph'});
