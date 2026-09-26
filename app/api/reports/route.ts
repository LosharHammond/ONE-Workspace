import {hasAction} from '../../access-policy';
import {route,all,HttpError,oneOf} from '../../server/core';
import {canSeeAsset,canSeeTicket,canSeeDoc,type AssetRow,type TicketRow,type PurchaseRow} from '../../server/entities';
import type {Member} from '../../server/policy';
import {bookValue} from '../../data';

// Cross-module reports. Every report starts from the workspace's rows and applies the same
// visibility rules as the module itself, so an export never contains another company's or
// another department's records.
type Row=Record<string,string|number|null>;
const reports={
 'tickets-sla':{title:'Ticket SLA by category',page:'maintenance'},
 'tickets-aging':{title:'Open tickets by age',page:'maintenance'},
 'assets-register':{title:'Asset register with depreciation',page:'assets'},
 'assets-by-location':{title:'Assets by location',page:'assets'},
 'purchasing-spend':{title:'Purchase order spend by department & vendor',page:'procurement'},
 'budget-usage':{title:'Budget usage',page:'budgets'},
 'inventory-valuation':{title:'Inventory valuation & reorder list',page:'inventory'},
 'maintenance-costs':{title:'Maintenance cost by asset',page:'schedules'},
 'people-directory':{title:'People by department & status',page:'people'},
 'user-activity':{title:'User activity (last 90 days)',page:'audit'},
} as const;
type ReportId=keyof typeof reports;
const hours=(a:string,b:string)=>Math.round((Date.parse(b)-Date.parse(a))/36e5*10)/10;

async function run(u:Member,id:ReportId):Promise<Row[]>{
 const T=u.tenantId;
 switch(id){
  case 'tickets-sla':case 'tickets-aging':{
   const t=(await all<TicketRow>('SELECT * FROM tickets WHERE tenant_id=?',T)).filter(x=>canSeeTicket(u,x));
   if(id==='tickets-aging'){const open=t.filter(x=>!['Resolved','Closed'].includes(x.status));const b=(d:number)=>d<1?'< 1 day':d<3?'1–3 days':d<7?'3–7 days':d<30?'1–4 weeks':'> 30 days';const m=new Map<string,Row>();for(const x of open){const k=`${x.department}|${b((Date.now()-Date.parse(x.created_at))/864e5)}`;const r=m.get(k)||{Team:x.department,Age:b((Date.now()-Date.parse(x.created_at))/864e5),Open:0,Overdue:0};r.Open=Number(r.Open)+1;if(x.due_at&&Date.parse(x.due_at)<Date.now())r.Overdue=Number(r.Overdue)+1;m.set(k,r)}return [...m.values()]}
   const m=new Map<string,{Category:string,Priority:string,Tickets:number,Resolved:number,'Met SLA':number,Overdue:number,hrs:number[]}>();
   for(const x of t){const k=`${x.category||'Uncategorised'}|${x.priority}`;const r=m.get(k)||{Category:x.category||'Uncategorised',Priority:x.priority,Tickets:0,Resolved:0,'Met SLA':0,Overdue:0,hrs:[]};r.Tickets++;if(x.resolved_at){r.Resolved++;r.hrs.push(hours(x.created_at,x.resolved_at));if(!x.due_at||x.resolved_at<=x.due_at)r['Met SLA']++}else if(x.due_at&&Date.parse(x.due_at)<Date.now())r.Overdue++;m.set(k,r)}
   return [...m.values()].map(({hrs,...r})=>({...r,'SLA %':r.Resolved?Math.round(r['Met SLA']/r.Resolved*100):null,'Avg hours to resolve':hrs.length?Math.round(hrs.reduce((a,b)=>a+b,0)/hrs.length*10)/10:null}));
  }
  case 'assets-register':case 'assets-by-location':{
   const a=(await all<AssetRow&{useful_life_months:number,salvage_value:number,cost_centre:string,subcategory:string}>('SELECT * FROM assets WHERE tenant_id=?',T)).filter(x=>canSeeAsset(u,x));
   if(id==='assets-register')return a.map(x=>({Code:x.code,Name:x.name,Category:x.category,Subcategory:x.subcategory,Status:x.status,Location:x.location,Department:x.department,'Cost centre':x.cost_centre,'Purchase date':x.purchase_date,Cost:x.purchase_cost,'Useful life (months)':x.useful_life_months||null,'Book value':bookValue(x.purchase_cost,x.salvage_value,x.useful_life_months,x.purchase_date),'Warranty until':x.warranty_until}));
   const m=new Map<string,Row>();for(const x of a){const k=x.location||'No location';const r=m.get(k)||{Location:k,Assets:0,'In use':0,'In store':0,Maintenance:0,Value:0};r.Assets=Number(r.Assets)+1;if(r[x.status]!==undefined)r[x.status]=Number(r[x.status])+1;r.Value=Number(r.Value)+x.purchase_cost;m.set(k,r)}return [...m.values()];
  }
  case 'purchasing-spend':{
   const d=(await all<PurchaseRow&{vendor_name:string|null}>("SELECT d.*,v.name AS vendor_name,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d LEFT JOIN vendors v ON v.id=d.vendor_id AND v.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.kind='PO' AND d.status NOT IN ('Draft','Cancelled','Rejected')",T)).filter(x=>canSeeDoc(u,x));
   const m=new Map<string,Row>();for(const x of d){const k=`${x.department}|${x.vendor_name||'—'}|${x.currency}`;const r=m.get(k)||{Department:x.department,'Cost centre':x.cost_centre||'',Vendor:x.vendor_name||'—',Currency:x.currency,Orders:0,Total:0};r.Orders=Number(r.Orders)+1;r.Total=Math.round((Number(r.Total)+x.total)*100)/100;m.set(k,r)}return [...m.values()].sort((a,b)=>Number(b.Total)-Number(a.Total));
  }
  case 'budget-usage':return (await all<Row>("SELECT b.name AS Budget,b.department AS Department,b.cost_centre AS \"Cost centre\",b.period_start AS \"From\",b.period_end AS \"To\",b.currency AS Currency,b.amount AS Amount,coalesce((SELECT sum(total) FROM purchase_docs d WHERE d.tenant_id=b.tenant_id AND d.budget_id=b.id AND d.kind='PO' AND d.status NOT IN ('Draft','Cancelled','Rejected')),0) AS Spent,coalesce((SELECT sum(total) FROM purchase_docs d WHERE d.tenant_id=b.tenant_id AND d.budget_id=b.id AND d.kind='PR' AND d.status IN ('Pending approval','Approved')),0) AS Committed FROM budgets b WHERE b.tenant_id=? ORDER BY b.period_end DESC",T)).map(r=>({...r,Remaining:Number(r.Amount)-Number(r.Spent)-Number(r.Committed)}));
  case 'inventory-valuation':return (await all<Row>('SELECT i.sku AS SKU,i.name AS Item,i.category AS Category,i.unit AS Unit,coalesce((SELECT sum(qty) FROM stock_levels l WHERE l.tenant_id=i.tenant_id AND l.item_id=i.id),0) AS "On hand",i.min_stock AS Minimum,i.reorder_qty AS "Reorder qty",i.unit_cost AS "Unit cost" FROM inventory_items i WHERE i.tenant_id=? ORDER BY i.name',T)).map(r=>({...r,Value:Math.round(Number(r['On hand'])*Number(r['Unit cost'])*100)/100,'Needs reorder':Number(r.Minimum)>0&&Number(r['On hand'])<=Number(r.Minimum)?'Yes':''}));
  case 'maintenance-costs':return all<Row>("SELECT coalesce(a.code,'—') AS Asset,coalesce(a.name,'Not linked to an asset') AS Name,count(w.id) AS \"Work orders\",sum(CASE WHEN w.status='Completed' THEN 1 ELSE 0 END) AS Completed,sum(CASE WHEN w.status NOT IN ('Completed','Cancelled') AND w.due_at<? THEN 1 ELSE 0 END) AS Overdue,round(sum(w.parts_cost),2) AS \"Parts cost\",round(sum(w.labor_cost),2) AS \"Labour cost\" FROM work_orders w LEFT JOIN assets a ON a.id=w.asset_id AND a.tenant_id=w.tenant_id WHERE w.tenant_id=? GROUP BY w.asset_id ORDER BY sum(w.parts_cost+w.labor_cost) DESC",new Date().toISOString(),T);
  case 'people-directory':return all<Row>("SELECT m.department AS Department,sum(CASE WHEN m.active=1 AND c.identity_id IS NOT NULL THEN 1 ELSE 0 END) AS Active,sum(CASE WHEN m.active=1 AND c.identity_id IS NULL THEN 1 ELSE 0 END) AS Invited,sum(CASE WHEN m.active=0 THEN 1 ELSE 0 END) AS Disabled,sum(CASE WHEN m.last_seen_at>? THEN 1 ELSE 0 END) AS \"Active in 30 days\" FROM members m LEFT JOIN credentials c ON c.identity_id=m.identity_id WHERE m.tenant_id=? GROUP BY m.department ORDER BY m.department",new Date(Date.now()-30*864e5).toISOString(),T);
  case 'user-activity':return all<Row>("SELECT m.name AS Person,m.department AS Department,count(a.id) AS Actions,sum(CASE WHEN a.action='Signed in' THEN 1 ELSE 0 END) AS \"Sign-ins\",max(a.created_at) AS \"Last action\" FROM members m LEFT JOIN audit a ON a.actor=m.id AND a.tenant_id=m.tenant_id AND a.created_at>? WHERE m.tenant_id=? GROUP BY m.id ORDER BY count(a.id) DESC",new Date(Date.now()-90*864e5).toISOString(),T);
 }
}
export const GET=route(async(req,u)=>{
 if(!hasAction(u,'reports'))throw new HttpError(403,'Reports are not available to your account.');
 const id=new URL(req.url).searchParams.get('report');
 const list=Object.entries(reports).filter(([,r])=>hasAction(u,r.page)&&(r.page!=='audit'||hasAction(u,'audit'))).map(([id,r])=>({id,title:r.title,page:r.page}));
 if(!id)return {reports:list};
 const rid=oneOf(id,Object.keys(reports) as ReportId[],'report');
 if(!list.some(r=>r.id===rid))throw new HttpError(403,'This report is not available to your account.');
 return {title:reports[rid].title,rows:await run(u,rid),canExport:hasAction(u,'reports','export')};
},{module:'reports'});
