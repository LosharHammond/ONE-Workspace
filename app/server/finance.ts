import {all,first,stmt,batch,uid,now,tenantOf,tenantSettings,run} from './core';

// Financial traceability ledger. Every critical amount is an immutable financial_events row (updates and
// deletes are refused by database triggers). Sources (budgets, requisitions, orders, receipts, invoices,
// payments, project costs, requests) are reconciled into the ledger: for each (source, measure, project,
// budget, request) the ledger sum is brought to the source's current value by appending a signed delta event,
// so every change is recorded and every total can be traced back to its source records.
//
// Measures are defined so linked records are never counted twice:
//  proposed   — the estimated cost of a submitted business request
//  budget     — approved budget amounts (revisions are deltas); contingency — budget contingency
//  requested  — requisitions submitted for approval or approved (value of the requisition)
//  committed  — approved requisition lines not yet ordered + ordered value not yet received (open orders)
//  ordered    — approved purchase orders (value after change orders; cancelled orders drop to zero)
//  received   — value of goods and services received, net of returns
//  invoiced / paid — vendor invoices and payments (for three-way matching and payment status)
//  expense    — direct project expenses; forecast_adjustment — explicit forecast changes
// Actual = received + expense + logged labour (labour from time entries). Forecast = actual + committed +
// forecast adjustments. Remaining = budget − actual − committed. Variance = budget − forecast.
export type Measure='proposed'|'budget'|'contingency'|'requested'|'committed'|'ordered'|'received'|'invoiced'|'paid'|'expense'|'forecast_adjustment';
type Target={measure:Measure,amount:number,projectId:string|null,budgetId:string|null,requestId:string|null,currency:string,lineId?:string|null};
const r2=(n:number)=>Math.round(n*100)/100;

// Appends delta events so the ledger matches `targets` for this source. Targets omitted for a measure are zero.
export async function reconcile(tenantId:string,sourceType:string,sourceId:string,targets:Target[],actor:string,memo:string,measures:Measure[]){
 const cur=await all<{measure:string,project_id:string|null,budget_id:string|null,request_id:string|null,source_line_id:string|null,currency:string,total:number,n:number}>(`SELECT measure,project_id,budget_id,request_id,source_line_id,currency,sum(amount) AS total,count(*) AS n FROM financial_events WHERE tenant_id=? AND source_type=? AND source_id=? AND measure IN (${measures.map(()=>'?').join(',')}) GROUP BY measure,project_id,budget_id,request_id,source_line_id,currency`,tenantId,sourceType,sourceId,...measures);
 const key=(m:string,p:string|null,b:string|null,rq:string|null,l:string|null|undefined,c:string)=>[m,p||'',b||'',rq||'',l||'',c].join('|');
 const want=new Map<string,Target>();for(const t of targets){const k=key(t.measure,t.projectId,t.budgetId,t.requestId,t.lineId,t.currency);const prev=want.get(k);want.set(k,prev?{...prev,amount:prev.amount+t.amount}:t)}
 const have=new Map(cur.map(c=>[key(c.measure,c.project_id,c.budget_id,c.request_id,c.source_line_id,c.currency),c]));
 const total=await first<{n:number}>('SELECT count(*) AS n FROM financial_events WHERE tenant_id=? AND source_type=? AND source_id=?',tenantId,sourceType,sourceId);let seq=total?.n||0;
 const s:D1PreparedStatement[]=[];const ts=now();
 const push=(t:Target,delta:number)=>{seq++;s.push(stmt('INSERT INTO financial_events(id,tenant_id,dedupe_key,event_type,measure,amount,currency,project_id,budget_id,request_id,source_type,source_id,source_line_id,memo,actor,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,dedupe_key) DO NOTHING',uid(),tenantId,`${sourceType}:${sourceId}:${seq}`,delta>=0?`${t.measure}_increase`:`${t.measure}_decrease`,t.measure,r2(delta),t.currency,t.projectId,t.budgetId,t.requestId,sourceType,sourceId,t.lineId||null,memo.slice(0,300),actor,ts))};
 for(const [k,t] of want){const h=have.get(k);const delta=r2(t.amount-(h?.total||0));if(Math.abs(delta)>=0.005)push(t,delta)}
 for(const [k,h] of have)if(!want.has(k)&&Math.abs(h.total)>=0.005)push({measure:h.measure as Measure,amount:0,projectId:h.project_id,budgetId:h.budget_id,requestId:h.request_id,currency:h.currency,lineId:h.source_line_id},-h.total);
 if(s.length)await batch(s);
 return s.length;
}

type Doc={id:string,tenant_id:string,kind:string,status:string,total:number,currency:string,project_id:string|null,budget_id:string|null,request_id:string|null,pr_id:string|null};
type Line={id:string,qty:number,unit_price:number,tax_rate:number,received_qty:number,ordered_qty:number};
const lineValue=(l:Line,q:number)=>q*l.unit_price*(1+l.tax_rate/100);
// A purchase document (and its invoices/payments) → requested/committed/ordered/received/invoiced/paid.
export async function reconcileDoc(tenantId:string,docId:string,actor='system',memo='Purchasing change'){
 const d=await first<Doc>('SELECT id,tenant_id,kind,status,total,currency,project_id,budget_id,request_id,pr_id FROM purchase_docs WHERE id=? AND tenant_id=?',docId,tenantId);if(!d)return 0;
 // Orders inherit the budget and request of their requisition when they carry none themselves.
 let budgetId=d.budget_id,requestId=d.request_id,projectId=d.project_id;
 if(d.kind==='PO'&&d.pr_id&&(!budgetId||!requestId||!projectId)){const pr=await first<{budget_id:string|null,request_id:string|null,project_id:string|null}>('SELECT budget_id,request_id,project_id FROM purchase_docs WHERE id=? AND tenant_id=?',d.pr_id,tenantId);budgetId=budgetId||pr?.budget_id||null;requestId=requestId||pr?.request_id||null;projectId=projectId||pr?.project_id||null}
 const lines=await all<Line>('SELECT id,qty,unit_price,tax_rate,received_qty,ordered_qty FROM purchase_lines WHERE tenant_id=? AND doc_id=?',tenantId,d.id);
 const base={projectId,budgetId,requestId,currency:d.currency};const T:Target[]=[];
 if(d.kind==='PR'){
  if(['Pending approval','Approved','Converted','Partially converted'].includes(d.status))T.push({...base,measure:'requested',amount:d.total});
  if(['Approved','Partially converted'].includes(d.status))T.push({...base,measure:'committed',amount:lines.reduce((n,l)=>n+lineValue(l,Math.max(0,l.qty-l.ordered_qty)),0)});
  return reconcile(tenantId,'PR',d.id,T,actor,memo,['requested','committed']);
 }
 const live=['Approved','Issued','Partially received','Received','Closed'].includes(d.status);
 const received=lines.reduce((n,l)=>n+lineValue(l,Math.max(0,l.received_qty)),0);
 if(live){T.push({...base,measure:'ordered',amount:d.total});T.push({...base,measure:'committed',amount:d.status==='Closed'?0:Math.max(0,d.total-received)})}
 if(received>0)T.push({...base,measure:'received',amount:received});
 const inv=await all<{amount:number,tax:number,paid_amount:number,status:string}>('SELECT amount,tax,paid_amount,status FROM purchase_invoices WHERE tenant_id=? AND po_id=?',tenantId,d.id);
 const invoiced=inv.filter(i=>i.status!=='Cancelled').reduce((n,i)=>n+i.amount+i.tax,0),paid=inv.reduce((n,i)=>n+i.paid_amount,0);
 if(invoiced)T.push({...base,measure:'invoiced',amount:invoiced});if(paid)T.push({...base,measure:'paid',amount:paid});
 return reconcile(tenantId,'PO',d.id,T,actor,memo,['ordered','committed','received','invoiced','paid']);
}
export async function reconcileBudget(tenantId:string,budgetId:string,actor='system',memo='Budget change'){
 const b=await first<{id:string,amount:number,contingency:number,currency:string,status:string,project_id:string|null,request_id:string|null}>('SELECT id,amount,contingency,currency,status,project_id,request_id FROM budgets WHERE id=? AND tenant_id=?',budgetId,tenantId);if(!b)return 0;
 const base={projectId:b.project_id,budgetId:b.id,requestId:b.request_id,currency:b.currency};
 const live=b.status!=='Draft';
 return reconcile(tenantId,'budget',b.id,live?[{...base,measure:'budget',amount:b.amount},...(b.contingency?[{...base,measure:'contingency' as Measure,amount:b.contingency}]:[])]:[],actor,memo,['budget','contingency']);
}
// Project cost lines (expenses and explicit forecast adjustments; invoices/payments recorded against the project).
export async function reconcileProjectCost(tenantId:string,costId:string,actor='system',memo='Project cost'){
 const c=await first<{id:string,project_id:string,kind:string,amount:number,currency:string,status:string}>('SELECT id,project_id,kind,amount,currency,status FROM project_costs WHERE id=? AND tenant_id=?',costId,tenantId);
 // A deleted cost line is reversed in the ledger (never erased).
 if(!c)return reconcile(tenantId,'project_cost',costId,[],actor,'Project cost removed',['expense','forecast_adjustment','invoiced','paid']);
 const p=await first<{request_id:string|null}>('SELECT request_id FROM projects WHERE id=? AND tenant_id=?',c.project_id,tenantId);
 const measure:Measure|null=c.kind==='expense'?'expense':c.kind==='forecast'?'forecast_adjustment':c.kind==='invoice'?'invoiced':c.kind==='payment'?'paid':null;
 const active=c.status!=='Cancelled'&&c.status!=='Rejected';
 return reconcile(tenantId,'project_cost',c.id,measure&&active?[{measure,amount:c.amount,projectId:c.project_id,budgetId:null,requestId:p?.request_id||null,currency:c.currency}]:[],actor,memo,['expense','forecast_adjustment','invoiced','paid']);
}
export async function reconcileRequest(tenantId:string,requestId:string,actor='system',memo='Request change'){
 const r=await first<{id:string,estimated_cost:number,currency:string,status:string,project_id:string|null,budget_id:string|null}>('SELECT id,estimated_cost,currency,status,project_id,budget_id FROM business_requests WHERE id=? AND tenant_id=?',requestId,tenantId);if(!r)return 0;
 const live=!['Draft','Withdrawn','Rejected'].includes(r.status);
 return reconcile(tenantId,'request',r.id,live&&r.estimated_cost?[{measure:'proposed',amount:r.estimated_cost,projectId:r.project_id,budgetId:r.budget_id,requestId:r.id,currency:r.currency}]:[],actor,memo,['proposed']);
}
// One-time backfill of existing data (idempotent: reconciliation only appends missing deltas).
export async function ensureLedger(tenantId:string){
 const t=await tenantOf({tenantId});const s=tenantSettings(t);if(s.ledgerBackfilledAt)return;
 for(const d of await all<{id:string}>('SELECT id FROM purchase_docs WHERE tenant_id=?',tenantId))await reconcileDoc(tenantId,d.id,'system','Ledger backfill');
 for(const b of await all<{id:string}>('SELECT id FROM budgets WHERE tenant_id=?',tenantId))await reconcileBudget(tenantId,b.id,'system','Ledger backfill');
 for(const c of await all<{id:string}>('SELECT id FROM project_costs WHERE tenant_id=?',tenantId))await reconcileProjectCost(tenantId,c.id,'system','Ledger backfill');
 const fresh=await tenantOf({tenantId});await run('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify({...tenantSettings(fresh),ledgerBackfilledAt:now()}),tenantId);
}

export type Scope={projectId?:string|null,budgetId?:string|null,requestId?:string|null};
// Totals for a project, budget or request, with the events behind every measure (traceability).
export async function financeSummary(tenantId:string,scope:Scope,o:{events?:boolean,approvedOverride?:number|null}={}){
 await ensureLedger(tenantId);
 const where:string[]=[];const args:unknown[]=[];
 if(scope.projectId){where.push('project_id=?');args.push(scope.projectId)}if(scope.budgetId){where.push('budget_id=?');args.push(scope.budgetId)}if(scope.requestId){where.push('request_id=?');args.push(scope.requestId)}
 if(!where.length)return null;
 // A row matches once even when it carries several of the requested links (no double counting).
 const rows=await all<{measure:string,total:number}>(`SELECT measure,sum(amount) AS total FROM financial_events WHERE tenant_id=? AND (${where.join(' OR ')}) GROUP BY measure`,tenantId,...args);
 const m=(k:Measure)=>r2(rows.find(r=>r.measure===k)?.total||0);
 const labour=scope.projectId?await first<{cost:number,minutes:number}>('SELECT coalesce(sum(minutes*rate/60.0),0) AS cost,coalesce(sum(minutes),0) AS minutes FROM time_entries WHERE tenant_id=? AND project_id=?',tenantId,scope.projectId):null;
 const budget=o.approvedOverride||m('budget');const actual=r2(m('received')+m('expense')+(labour?.cost||0));const committed=m('committed');
 const forecast=r2(actual+committed+m('forecast_adjustment'));
 const out={proposed:m('proposed'),budget,revisedBudget:m('budget'),contingency:m('contingency'),requested:m('requested'),committed,ordered:m('ordered'),received:m('received'),invoiced:m('invoiced'),paid:m('paid'),expenses:m('expense'),labour:r2(labour?.cost||0),labourMinutes:labour?.minutes||0,actual,forecast,remaining:r2(budget-actual-committed),variance:r2(budget-forecast),method:'Immutable ledger: each linked record contributes once per measure; see events for the source of every amount.'};
 if(!o.events)return {...out,events:undefined};
 const events=await all<{id:string,event_type:string,measure:string,amount:number,currency:string,source_type:string,source_id:string,memo:string,actor:string,occurred_at:string}>(`SELECT id,event_type,measure,amount,currency,source_type,source_id,memo,actor,occurred_at FROM financial_events WHERE tenant_id=? AND (${where.join(' OR ')}) ORDER BY occurred_at DESC LIMIT 500`,tenantId,...args);
 return {...out,events};
}
// Source-by-source breakdown of one measure (e.g. which orders make up "committed").
export async function measureSources(tenantId:string,scope:Scope,measure:Measure){
 const where:string[]=[];const args:unknown[]=[];if(scope.projectId){where.push('project_id=?');args.push(scope.projectId)}if(scope.budgetId){where.push('budget_id=?');args.push(scope.budgetId)}if(scope.requestId){where.push('request_id=?');args.push(scope.requestId)}
 if(!where.length)return [];
 return all<{source_type:string,source_id:string,total:number}>(`SELECT source_type,source_id,sum(amount) AS total FROM financial_events WHERE tenant_id=? AND measure=? AND (${where.join(' OR ')}) GROUP BY source_type,source_id HAVING abs(sum(amount))>=0.005`,tenantId,measure,...args);
}
