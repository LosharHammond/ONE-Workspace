import {hasAction,departmentKey} from '../access-policy';
import {all,first,stmt,batch,run,uid,now,parseJson,HttpError,auditStatement,str,idOf,nextNumber,date} from './core';
import {canSeeWork,loadWork,type WorkRow} from './work';
import {loadKnowledge} from './knowledge-intel';
import type {Member} from './policy';

// Knowledge actions shared by the Knowledge API, the Universal Inbox and AI tools.
const inboxEvent=(t:string,type:string,id:string)=>stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),t,id,JSON.stringify({type}),now());

// ── Decision register ──
export async function decideDecision(u:Member,id:string,approve:boolean,comment:string){
 const r=await loadWork(u,id);if(r.kind!=='decision')throw new HttpError(400,'This is not a decision.');
 const d=parseJson<Record<string,unknown>>(r.data_json,{});const maker=typeof d.decidedBy==='string'&&d.decidedBy?d.decidedBy:r.owner_id;
 if(maker!==u.id&&u.role!=='admin'){const {actingFor}=await import('./delegation');if(!(await actingFor(u,[maker||''],'knowledge',{itemType:'review',source:{type:'work_record',id:r.id}})).length)throw new HttpError(403,'Only the decision maker approves this decision.')}
 if(!['Proposed','Under review'].includes(r.status))throw new HttpError(409,'This decision is not waiting for approval.');
 if(!approve&&!comment)throw new HttpError(400,'Add a reason.');
 const status=approve?'Approved':'Rejected';const next={...d,approvedBy:u.id,approvedAt:now(),approvalNote:comment};
 await batch([stmt('UPDATE work_records SET status=?,data_json=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',status,JSON.stringify(next),u.id,now(),r.id,u.tenantId),auditStatement(u,`Decision ${status.toLowerCase()}: ${r.title}`,r.id,r.department,{status:r.status},{status,note:comment,approvedBy:u.id}),inboxEvent(u.tenantId,'work_record',r.id)]);
 return {status};
}
// Answers the register's questions from the record, its history, evidence and Work Graph connections.
export async function decisionDossier(u:Member,id:string){
 const r=await loadWork(u,id);if(r.kind!=='decision')throw new HttpError(404,'Decision not found.');
 const d=parseJson<Record<string,unknown>>(r.data_json,{});const names=new Map((await all<{id:string,name:string}>('SELECT id,name FROM members WHERE tenant_id=?',u.tenantId)).map(m=>[m.id,m.name]));
 const history=await all<{action:string,created_at:string,actor:string}>('SELECT action,created_at,actor FROM audit WHERE tenant_id=? AND record_id=? ORDER BY created_at',u.tenantId,r.id);
 const versions=await all<{version:number,snapshot_json:string,edited_by:string,created_at:string}>('SELECT version,snapshot_json,edited_by,created_at FROM work_record_versions WHERE tenant_id=? AND record_id=? ORDER BY version',u.tenantId,r.id);
 const {connectedContext}=await import('./graph-context');const ctx=await connectedContext(u,'decision',r.id).catch(()=>null);
 // Only records linked to the decision itself count as its evidence, affected work or implementation; records that
 // are merely reachable through a person (for example the decision maker's other tasks) are not attributed to it.
 const items=(ctx?.sections||[]).flatMap(s=>s.items.map(i=>({...i,section:s.label}))).filter(i=>i.depth===1);
 const tasks=items.filter(i=>i.type==='task');const taskRows=tasks.length?await all<{id:string,status:string}>(`SELECT id,status FROM tasks WHERE tenant_id=? AND deleted_at IS NULL AND id IN (${tasks.map(()=>'?').join(',')})`,u.tenantId,...tasks.map(t=>t.sourceId)):[];
 const superseded=typeof d.supersededBy==='object'&&Array.isArray(d.supersededBy)&&d.supersededBy.length?await first<WorkRow>('SELECT * FROM work_records WHERE id=? AND tenant_id=?',String((d.supersededBy as string[])[0]),u.tenantId):null;
 const supersedes=(await all<WorkRow>("SELECT * FROM work_records WHERE tenant_id=? AND kind='decision' AND deleted_at IS NULL AND instr(data_json,?)>0",u.tenantId,r.id)).filter(x=>x.id!==r.id&&canSeeWork(u,x)&&(parseJson<{supersededBy?:string[]}>(x.data_json,{}).supersededBy||[]).includes(r.id));
 const approvedBy=typeof d.approvedBy==='string'?names.get(d.approvedBy):history.find(h=>/approved/i.test(h.action))?names.get(history.find(h=>/approved/i.test(h.action))!.actor):null;
 return {decision:{id:r.id,number:r.number,title:r.title,status:r.status,description:r.description,decision:d.decision||'',rationale:d.rationale||'',alternatives:d.alternatives||'',decisionMaker:typeof d.decidedBy==='string'?{id:d.decidedBy,name:names.get(d.decidedBy)||''}:null,participants:(Array.isArray(d.participants)?d.participants as string[]:[]).map(p=>({id:p,name:names.get(p)||''})),date:r.start_date,effectiveDate:d.effectiveDate||null,reviewDate:r.end_date,impactedDepartments:d.impactedDepartments||'',risks:d.risks||'',meetingId:r.parent_id},
  answers:{why:d.rationale||'No rationale recorded.',whoApproved:approvedBy||(r.status==='Approved'||r.status==='Implemented'?'Recorded as approved without a named approver':'Not approved yet'),evidence:items.filter(i=>i.type==='file').map(i=>({title:i.title,url:i.url})),affectedWork:items.filter(i=>['project','task','objective','initiative','budget','key_result','goal'].includes(i.type)).map(i=>({type:i.label,title:i.title,url:i.url})),implemented:r.status==='Implemented'?'Marked implemented':taskRows.length?`${taskRows.filter(t=>t.status==='Done').length} of ${taskRows.length} resulting tasks done`:'No implementation tasks linked',laterChanged:superseded?{by:superseded.title,id:superseded.id}:r.status==='Superseded'?'Superseded':versions.length>1?`Edited ${versions.length-1} time(s) since it was recorded`:'Not changed'},
  supersedes:supersedes.map(x=>({id:x.id,title:x.title})),history:history.map(h=>({action:h.action,at:h.created_at,who:names.get(h.actor)||h.actor})),versions:versions.map(v=>({version:v.version,at:v.created_at,by:names.get(v.edited_by)||'',snapshot:parseJson(v.snapshot_json,{})})),restricted:ctx?.restricted||0};
}

// ── AI suggestions (decisions, action items, relationships, tags): a person approves or rejects each one ──
export async function reviewSuggestion(req:Request,u:Member,id:string,approve:boolean,edits:Record<string,unknown>){
 const s=await first<{id:string,knowledge_id:string|null,kind:string,payload_json:string,citations_json:string,status:string,created_by:string}>('SELECT * FROM knowledge_suggestions WHERE id=? AND tenant_id=?',id,u.tenantId);if(!s)throw new HttpError(404,'Suggestion not found.');
 if(s.status!=='pending')throw new HttpError(409,'This suggestion was already reviewed.');
 if(s.knowledge_id)await loadKnowledge(u,s.knowledge_id);
 const p={...parseJson<Record<string,unknown>>(s.payload_json,{}),...edits};const reviewer=p.reviewerId?String(p.reviewerId):null;
 if(s.kind==='tag'&&u.role!=='admin')throw new HttpError(403,'Taxonomy changes need an administrator.');
 if(reviewer&&reviewer!==u.id&&u.role!=='admin'&&!hasAction(u,'knowledge','update'))throw new HttpError(403,'This suggestion is assigned to someone else.');
 const ts=now();
 if(!approve){await batch([stmt("UPDATE knowledge_suggestions SET status='rejected',reviewed_by=?,reviewed_at=? WHERE id=?",u.id,ts,s.id),auditStatement(u,`AI suggestion rejected (${s.kind})`,s.id,'Knowledge',null,{title:p.title}),inboxEvent(u.tenantId,'suggestion',s.id)]);return {status:'rejected'}}
 const {dispatch}=await import('./dispatch');let result:{type:string,id:string}|null=null;const cites=parseJson<{title:string,link:string,quote:string}[]>(s.citations_json,[]);
 if(s.kind==='decision'){
  // The decision enters the register (Proposed) linked to its meeting/project and the source as evidence.
  const src=s.knowledge_id?await first<{source_type:string,source_id:string}>('SELECT source_type,source_id FROM knowledge_sources WHERE id=?',s.knowledge_id):null;
  const meeting=src?.source_type==='file'?(await first<{entity_id:string}>("SELECT l.entity_id FROM file_links l JOIN work_records w ON w.id=l.entity_id AND w.tenant_id=l.tenant_id WHERE l.tenant_id=? AND l.file_id=? AND w.kind='meeting' LIMIT 1",u.tenantId,src.source_id))?.entity_id:src?.source_type==='work_record'&&(await first<{kind:string}>('SELECT kind FROM work_records WHERE id=?',src.source_id))?.kind==='meeting'?src.source_id:null;
  const r=await dispatch<{id:string}>(req,'business',{action:'save',kind:'decision',title:str(p.title,'Decision',200),status:'Proposed',parentId:meeting||undefined,startDate:now().slice(0,10),data:{decision:String(p.text||p.title),rationale:String(p.rationale||cites.map(c=>`“${c.quote}” — ${c.title}`).join('\n')),decidedBy:p.decidedBy||u.id,...(p.projectId?{affects:[String(p.projectId)]}:{}),...(src?.source_type==='file'?{evidence:[src.source_id]}:{})}});
  result={type:'decision',id:r.id};
 }else if(s.kind==='action_item'){
  const r=await dispatch<{id:string}>(req,'tasks',{action:'save',title:str(p.title,'Task',200),description:`${cites.map(c=>`From ${c.title}${c.quote?`: “${c.quote}”`:''}`).join('\n')}`,dueDate:date(p.due,'Due date'),projectId:p.projectId||undefined,assignees:[String(p.assigneeId||u.id)]});
  result={type:'task',id:r.id};
 }else if(s.kind==='relationship'){
  const g=await import('./graph');const a=await g.findNode(u,String(p.fromType),String(p.fromId));const b=await g.findNode(u,String(p.toType),String(p.toId));const eid=p.reverse?await g.addRelationship(u,b,a,String(p.relationship||'related_to'),'ai',{confidence:0.6}):await g.addRelationship(u,a,b,String(p.relationship||'related_to'),'ai',{confidence:0.6});result={type:'relationship',id:eid};
 }else if(s.kind==='tag'){const tid=uid();await stmt("INSERT INTO knowledge_taxonomy(id,tenant_id,kind,name,status,origin,proposed_by,approved_by,created_at,updated_at) VALUES(?,?,'tag',?,'active','ai',?,?,?,?) ON CONFLICT(tenant_id,kind,name) DO NOTHING",tid,u.tenantId,str(p.name,'Tag',60),s.created_by,u.id,ts,ts).run();result={type:'tag',id:tid}}
 await batch([stmt("UPDATE knowledge_suggestions SET status='accepted',reviewed_by=?,reviewed_at=?,result_type=?,result_id=?,payload_json=? WHERE id=?",u.id,ts,result?.type||null,result?.id||null,JSON.stringify(p),s.id),auditStatement(u,`AI suggestion accepted (${s.kind})`,s.id,'Knowledge',null,{result}),inboxEvent(u.tenantId,'suggestion',s.id)]);
 return {status:'accepted',result};
}

// ── Reviews (stale, expiring, conflicting, broken links, unverified AI) ──
export async function completeReview(u:Member,id:string,b:{outcome:string,notes?:string,supersededBy?:string,nextReviewDays?:number}){
 const r=await first<{id:string,knowledge_id:string,assignee_id:string|null,status:string,reason:string}>('SELECT * FROM knowledge_reviews WHERE id=? AND tenant_id=?',id,u.tenantId);if(!r)throw new HttpError(404,'Review not found.');
 if(r.status!=='open')throw new HttpError(409,'This review is already closed.');
 const k=await loadKnowledge(u,r.knowledge_id);
 if(r.assignee_id!==u.id&&u.role!=='admin'&&!(hasAction(u,'knowledge','update')&&departmentKey(u.department)===departmentKey(k.department))){const {actingFor}=await import('./delegation');if(!(await actingFor(u,[r.assignee_id||''],'knowledge',{itemType:'review'})).length)throw new HttpError(403,'This review is assigned to someone else.')}
 const outcome=['still_accurate','updated','archived','superseded','verified'].includes(b.outcome)?b.outcome:'still_accurate';const ts=now();const days=Math.max(7,Math.min(1095,Number(b.nextReviewDays)||(k.kind==='policy'?180:365)));
 const sup=outcome==='superseded'&&b.supersededBy?idOf(b.supersededBy,'Replacement'):null;if(sup)await loadKnowledge(u,sup);
 await batch([stmt("UPDATE knowledge_reviews SET status='done',outcome=?,resolved_by=?,resolved_at=? WHERE id=?",`${outcome}${b.notes?`: ${String(b.notes).slice(0,300)}`:''}`,u.id,ts,r.id),
  stmt(`UPDATE knowledge_sources SET last_reviewed_at=?,next_review_at=?,verified=CASE WHEN ? IN ('still_accurate','verified','updated') THEN 1 ELSE verified END,superseded_by=coalesce(?,superseded_by),status=CASE WHEN ?='archived' THEN 'expired' ELSE status END,updated_at=? WHERE id=?`,ts,new Date(Date.now()+days*86400000).toISOString(),outcome,sup,outcome,ts,k.id),
  auditStatement(u,`Knowledge reviewed (${outcome.replace(/_/g,' ')})`,k.source_id,k.department,{reason:r.reason},{outcome,nextReviewDays:days}),inboxEvent(u.tenantId,'knowledge_review',r.id)]);
 return {ok:true,outcome};
}

// ── Questions and answers ──
async function loadQuestion(u:Member,id:string){const q=await first<{id:string,asker_id:string,title:string,body:string,department:string,status:string,visibility:string,accepted_answer_id:string|null,escalated_to:string,article_id:string|null,created_at:string}>('SELECT * FROM knowledge_questions WHERE id=? AND tenant_id=?',id,u.tenantId);
 if(!q)throw new HttpError(404,'Question not found.');if(u.role!=='admin'&&q.asker_id!==u.id&&!(q.visibility==='company'||departmentKey(q.department)===departmentKey(u.department)||departmentKey(q.escalated_to)===departmentKey(u.department)))throw new HttpError(404,'Question not found.');return q}
export async function ask(u:Member,b:Record<string,unknown>){
 if(!hasAction(u,'knowledge'))throw new HttpError(403,'Questions are not available to you.');
 const id=uid();const title=str(b.title,'Question',300);await batch([stmt("INSERT INTO knowledge_questions(id,tenant_id,asker_id,title,body,department,status,visibility,created_at,updated_at) VALUES(?,?,?,?,?,?,'unanswered',?,?,?)",id,u.tenantId,u.id,title,str(b.body,'Details',4000,false),str(b.department||u.department,'Department',160),b.visibility==='department'?'department':'company',now(),now()),auditStatement(u,'Question asked',id,u.department,null,{title})]);
 // Verified answers to similar questions are offered first.
 const words=title.toLowerCase().split(/\s+/).filter(w=>w.length>3).slice(0,4);
 const similar=words.length?await all<{id:string,title:string,status:string}>(`SELECT id,title,status FROM knowledge_questions WHERE tenant_id=? AND id<>? AND status IN ('verified','answered') AND (${words.map(()=>'instr(lower(title),?)>0').join(' OR ')}) LIMIT 5`,u.tenantId,id,...words):[];
 return {id,similar};
}
export async function postAnswer(u:Member,questionId:string,body:string,kind:'expert'|'ai'='expert'){
 const q=await loadQuestion(u,questionId);if(!body.trim())throw new HttpError(400,'Write an answer.');
 const expert=u.role==='admin'||hasAction(u,'knowledge','update')||u.role==='manager';if(kind==='expert'&&!expert&&q.asker_id!==u.id)throw new HttpError(403,'Only subject-matter experts post expert answers.');
 const id=uid();await batch([stmt("INSERT INTO knowledge_answers(id,tenant_id,question_id,kind,body,citations_json,author_id,status,created_at) VALUES(?,?,?,?,?,'[]',?,'published',?)",id,u.tenantId,q.id,expert?'expert':'community',body.slice(0,8000),u.id,now()),stmt("UPDATE knowledge_questions SET status=CASE WHEN status IN ('unanswered','escalated') THEN 'answered' ELSE status END,updated_at=? WHERE id=?",now(),q.id),auditStatement(u,'Answer posted',q.id,q.department,null,{kind:expert?'expert':'community'}),inboxEvent(u.tenantId,'question',q.id)]);
 const {notify}=await import('./notify');await notify(u,[q.asker_id],{kind:'mention',title:`New answer: ${q.title}`,link:`#/knowledge/questions/${q.id}`});
 return {id};
}
export async function questionAction(req:Request,u:Member,id:string,action:string,b:Record<string,unknown>){
 const q=await loadQuestion(u,id);const ts=now();
 switch(action){
  case 'accept':{if(q.asker_id!==u.id&&u.role!=='admin')throw new HttpError(403,'Only the person who asked accepts an answer.');const a=await first<{id:string,kind:string}>('SELECT id,kind FROM knowledge_answers WHERE id=? AND tenant_id=? AND question_id=?',idOf(b.answerId,'Answer'),u.tenantId,q.id);if(!a)throw new HttpError(404,'Answer not found.');await batch([stmt("UPDATE knowledge_answers SET status=CASE WHEN id=? THEN 'accepted' ELSE 'published' END WHERE tenant_id=? AND question_id=?",a.id,u.tenantId,q.id),stmt("UPDATE knowledge_questions SET accepted_answer_id=?,status=CASE WHEN status='verified' THEN status ELSE 'answered' END,updated_at=? WHERE id=?",a.id,ts,q.id),auditStatement(u,'Answer accepted',q.id,q.department,null,{answer:a.id,kind:a.kind})]);return {ok:true}}
  case 'verify':{if(u.role!=='admin'&&!hasAction(u,'knowledge','update')&&u.role!=='manager')throw new HttpError(403,'Only subject-matter experts verify answers.');const a=await first<{id:string}>('SELECT id FROM knowledge_answers WHERE id=? AND tenant_id=? AND question_id=?',idOf(b.answerId,'Answer'),u.tenantId,q.id);if(!a)throw new HttpError(404,'Answer not found.');await batch([stmt("UPDATE knowledge_answers SET status='accepted',kind=CASE WHEN kind='ai' THEN 'ai' ELSE kind END,corrections_json=json_insert(corrections_json,'$[#]',json_object('verifiedBy',?,'at',?)) WHERE id=?",u.id,ts,a.id),stmt("UPDATE knowledge_questions SET accepted_answer_id=?,status='verified',updated_at=? WHERE id=?",a.id,ts,q.id),auditStatement(u,'Answer verified by an expert',q.id,q.department,null,{answer:a.id})]);return {ok:true}}
  case 'escalate':{const dept=str(b.department||q.department,'Department',160);await batch([stmt("UPDATE knowledge_questions SET status='escalated',escalated_to=?,updated_at=? WHERE id=?",dept,ts,q.id),auditStatement(u,`Question escalated to ${dept}`,q.id,dept,null,null),inboxEvent(u.tenantId,'question',q.id)]);return {ok:true}}
  case 'feedback':{const a=idOf(b.answerId,'Answer');const helpful=b.helpful===true;await batch([stmt(`UPDATE knowledge_answers SET ${helpful?'helpful=helpful+1':'not_helpful=not_helpful+1'} WHERE id=? AND tenant_id=? AND question_id=?`,a,u.tenantId,q.id),auditStatement(u,`Answer rated ${helpful?'helpful':'not helpful'}`,q.id,q.department,null,{answer:a})]);return {ok:true}}
  case 'correction':{const a=await first<{id:string,author_id:string}>('SELECT id,author_id FROM knowledge_answers WHERE id=? AND tenant_id=? AND question_id=?',idOf(b.answerId,'Answer'),u.tenantId,q.id);if(!a)throw new HttpError(404,'Answer not found.');const text=str(b.text,'Correction',2000);await batch([stmt("UPDATE knowledge_answers SET corrections_json=json_insert(corrections_json,'$[#]',json_object('by',?,'text',?,'at',?)) WHERE id=?",u.id,text,ts,a.id),auditStatement(u,'Correction requested on an answer',q.id,q.department,null,{answer:a.id})]);const {notify}=await import('./notify');await notify(u,[a.author_id.startsWith('agent:')?q.asker_id:a.author_id],{kind:'mention',title:`Correction requested: ${q.title}`,body:text,link:`#/knowledge/questions/${q.id}`});return {ok:true}}
  case 'convert':{const a=q.accepted_answer_id?await first<{body:string,citations_json:string,kind:string}>('SELECT body,citations_json,kind FROM knowledge_answers WHERE id=?',q.accepted_answer_id):null;if(!a)throw new HttpError(409,'Accept or verify an answer first.');const {dispatch}=await import('./dispatch');
   const cites=parseJson<{title:string,url:string}[]>(a.citations_json,[]);const r=await dispatch<{id:string}>(req,'pages',{action:'save',kind:'page',title:q.title,body:`${q.body?`> ${q.body}\n\n`:''}${a.body}${cites.length?`\n\n**Sources**\n${cites.map(c=>`- [${c.title}](${c.url})`).join('\n')}`:''}\n\n_${a.kind==='ai'?'Drafted by AI and accepted by the person who asked.':'Answered by a subject-matter expert.'}_`,department:q.department,acl:{mode:q.visibility==='department'?'departments':'company',departments:[q.department]},publish:false});
   await batch([stmt('UPDATE knowledge_questions SET article_id=?,updated_at=? WHERE id=?',r.id,ts,q.id),auditStatement(u,'Question converted into a knowledge article',q.id,q.department,null,{page:r.id})]);return {pageId:r.id}}
 }
 throw new HttpError(400,'Unknown question action.');
}
// The question's label follows its best answer: verified, then expert, then a cited AI answer; otherwise unanswered.
export function questionState(status:string,escalatedTo:string,answers:{kind:string,cited:boolean}[]){
 if(status==='verified')return 'Verified answer';if(answers.some(a=>a.kind==='expert'))return 'Expert answer';if(answers.some(a=>a.kind==='ai'&&a.cited))return 'AI-generated answer';
 if(status==='escalated')return `Escalated to ${escalatedTo}`;return answers.length?'Answered':'Unanswered';
}
export async function questionDetail(u:Member,id:string){
 const q=await loadQuestion(u,id);const names=new Map((await all<{id:string,name:string}>('SELECT id,name FROM members WHERE tenant_id=?',u.tenantId)).map(m=>[m.id,m.name]));
 const answers=await all<{id:string,kind:string,body:string,citations_json:string,confidence:number|null,author_id:string,status:string,helpful:number,not_helpful:number,corrections_json:string,created_at:string}>('SELECT * FROM knowledge_answers WHERE tenant_id=? AND question_id=? ORDER BY created_at',u.tenantId,q.id);
 // Citations are re-checked: sources the viewer cannot open are removed from AI answers they read.
 const {visibleSources}=await import('./knowledge-intel');
 const out=[];for(const a of answers){const cites=parseJson<{n:number,title:string,url:string}[]>(a.citations_json,[]);let visible=cites;if(cites.length){const rows=await all<Parameters<typeof visibleSources>[1][number]>(`SELECT * FROM knowledge_sources WHERE tenant_id=? AND url IN (${cites.map(()=>'?').join(',')})`,u.tenantId,...cites.map(c=>c.url));const ok=new Set((await visibleSources(u,rows)).map(r=>r.url));visible=cites.filter(c=>ok.has(c.url))}
  out.push({id:a.id,kind:a.kind,label:a.status==='accepted'&&q.status==='verified'&&q.accepted_answer_id===a.id?'Verified answer':a.kind==='ai'?'AI-generated answer':a.kind==='expert'?'Expert answer':'Answer',body:a.body,citations:visible,hiddenCitations:cites.length-visible.length,confidence:a.confidence,author:a.author_id.startsWith('agent:')?'AI agent':a.kind==='ai'?`AI, requested by ${names.get(a.author_id)||'a colleague'}`:names.get(a.author_id)||'',status:a.status,helpful:a.helpful,notHelpful:a.not_helpful,corrections:parseJson(a.corrections_json,[]),createdAt:a.created_at})}
 return {question:{...q,asker:names.get(q.asker_id)||'',state:questionState(q.status,q.escalated_to,answers.map(a=>({kind:a.kind,cited:a.citations_json!=='[]'})))},answers:out,canVerify:u.role==='admin'||hasAction(u,'knowledge','update')||u.role==='manager',canAccept:q.asker_id===u.id||u.role==='admin'};
}
export async function newDecisionNumber(t:string){return nextNumber(t,'DEC',true,['work_records','number'])}
export {run};
