import {hasAction} from '../../../access-policy';
import {route,readBody,HttpError,all,str,idOf,parseJson,auditStatement} from '../../../server/core';
import {roleMatch,runtime,tableOf,listRecords,loadRecord,saveRecord,deleteRecord,transition,decide,available,shapeRecord,runReport,myApprovals} from '../../../server/studio';
import type {Cond} from '../../../studio-def';

// Records of published Studio apps (or the draft, for builders previewing with ?preview=1). Every call is
// scoped to the tenant, the app's role list, the table's permissions and record scope, and field read/write roles.
export const GET=route(async(req,u)=>{
 if(!hasAction(u,'studio','view'))throw new HttpError(403,'Workspace Studio is not available to you.');
 const q=new URL(req.url).searchParams;
 if(q.get('view')==='approvals')return {approvals:await myApprovals(u)};
 const {app,def,preview}=await runtime(u,idOf(q.get('app'),'Application'),q.get('preview')==='1');
 if(q.get('report')){const rep=def.reports.find(r=>r.key===q.get('report'));if(!rep)throw new HttpError(404,'Report not found.');const filters=parseJson<Cond[]>(q.get('filters'),[]);return {report:{key:rep.key,name:rep.name,chart:rep.chart,groupBy:rep.groupBy,column:rep.column,measure:rep.measure,source:rep.source},...await runReport(u,app,def,rep,Array.isArray(filters)?filters.slice(0,10):[])}}
 const id=q.get('id');
 if(id){
  const {r,t}=await loadRecord(u,app,def,idOf(id,'Record'));const wf=def.workflows.find(w=>w.key===t.workflow);
  const [versions,approvals,history]=await Promise.all([
   all('SELECT version,status,edited_by AS editedBy,created_at AS createdAt FROM studio_record_versions WHERE tenant_id=? AND record_id=? ORDER BY version DESC LIMIT 50',u.tenantId,r.id),
   all<{id:string,stage:number,stage_name:string,status:string,approver_ids:string,mode:string,quorum:number,decisions_json:string,created_at:string,decided_at:string|null}>('SELECT * FROM studio_approvals WHERE tenant_id=? AND record_id=? ORDER BY created_at,stage',u.tenantId,r.id),
   all('SELECT a.action,a.created_at AS createdAt,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor AND m.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 50',u.tenantId,r.id),
  ]);
  return {record:shapeRecord(u,t,wf,r),table:t.key,transitions:available(u,t,wf,r),workflow:wf?{states:wf.states,current:r.status}:null,versions,approvals:approvals.map(a=>({id:a.id,stage:a.stage,name:a.stage_name,status:a.status,mode:a.mode,quorum:a.quorum,approvers:JSON.parse(a.approver_ids),decisions:parseJson<{decisions:unknown[]}>(a.decisions_json,{decisions:[]}).decisions,createdAt:a.created_at,decidedAt:a.decided_at})),history,preview};
 }
 const t=tableOf(def,str(q.get('table'),'Table',40));
 const filters=parseJson<Cond[]>(q.get('filters'),[]);
 const r=await listRecords(u,app,def,t,{q:q.get('q')||'',status:q.get('status')||'',sort:q.get('sort')||'',dir:q.get('dir')||'desc',page:Number(q.get('page'))||1,size:Number(q.get('size'))||50,filters:Array.isArray(filters)?filters.slice(0,10):[],mine:q.get('mine')==='1'});
 // Table metadata for rendering, limited to fields and forms this person may read.
 const fields=t.fields.filter(x=>roleMatch(u,x.readRoles));const keys=new Set(fields.map(x=>x.key));
 const forms=def.forms.filter(x=>x.table===t.key&&roleMatch(u,x.roles)).map(x=>({...x,sections:x.sections.map(sec=>({...sec,fields:sec.fields.filter(k=>keys.has(k))}))}));
 return {app:{id:app.id,slug:app.slug,name:app.name},table:{key:t.key,name:t.name,titleField:t.titleField,workflow:t.workflow||null,fields,forms},...r,preview};
},{module:'studio'});

export const POST=route(async(req,u)=>{
 if(!hasAction(u,'studio','view'))throw new HttpError(403,'Workspace Studio is not available to you.');
 const b=await readBody(req,400000);const action=str(b.action,'Action',24);
 if(action==='decide'){return decide(u,idOf(b.approvalId,'Approval'),b.approve===true,str(b.comment,'Comment',1000,false))}
 const {app,def,version}=await runtime(u,idOf(b.app,'Application'),b.preview===true);
 const input=(b.data&&typeof b.data==='object'&&!Array.isArray(b.data)?b.data:{}) as Record<string,unknown>;
 switch(action){
  case 'create':{const t=tableOf(def,str(b.table,'Table',40));return {ok:true,...await saveRecord(u,app,def,version,t,input,{draft:b.draft===true,formKey:b.form?str(b.form,'Form',40):undefined})}}
  case 'update':{const t=tableOf(def,str(b.table,'Table',40));return {ok:true,...await saveRecord(u,app,def,version,t,input,{id:idOf(b.id,'Record'),draft:b.draft===true,baseVersion:b.baseVersion!==undefined?Number(b.baseVersion):undefined})}}
  case 'delete':{await deleteRecord(u,app,def,idOf(b.id,'Record'));return {ok:true}}
  case 'transition':{const {r,t}=await loadRecord(u,app,def,idOf(b.id,'Record'));return transition(u,app,def,t,r,str(b.transition,'Step',60),{comment:str(b.comment,'Comment',1000,false)})}
  case 'export-report':{const rep=def.reports.find(r=>r.key===b.report);if(!rep)throw new HttpError(404,'Report not found.');const res=await runReport(u,app,def,rep);if(!res.canExport)throw new HttpError(403,'Exporting this report is not allowed for your role.');await auditStatement(u,`Report exported: ${rep.name}`,app.id,'Workspace Studio',null,{rows:res.rows.length}).run();return {rows:res.rows}}
 }
 throw new HttpError(400,'Unsupported action.');
},{module:'studio'});
