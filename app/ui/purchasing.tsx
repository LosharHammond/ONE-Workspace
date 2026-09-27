'use client';
import {useEffect,useMemo,useState} from 'react';
import {api,useApi,go,money,dateOnly,dateTime,ago,cx} from './lib';
import {KV,useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,LocationInput,PersonSelect,Who,Thread,Timeline,Tabs,Segmented,ErrorNote,Skeleton,Empty,Card,Icon,Note,Avatar,Stat,type Col} from './kit';

type Doc={id:string,kind:'PR'|'PO',number:string,title:string,justification:string,department:string,location:string,requester_id:string,vendor_id:string|null,pr_id:string|null,needed_by:string|null,currency:string,subtotal:number,tax:number,total:number,status:string,terms:string,created_by:string,created_at:string,updated_at:string,submitted_at:string|null,version:number,pending_step?:string|null,awaitingMe?:boolean,involved?:boolean};
type Line={inventory_item_id?:string|null,returned_qty?:number,id?:string,line_no?:number,description:string,item_code:string,qty:number,unit:string,unit_price:number,tax_rate:number,received_qty?:number};
type Vendor={id:string,name:string,email:string,phone:string,address:string,tax_id:string,category:string,status:string,notes:string,orders?:number,spend?:number};

export default function Purchasing({parts}:{parts:string[]}){
 const [a,b,c]=parts;
 if(a==='pr'||a==='po'){const kind=a.toUpperCase() as 'PR'|'PO';if(b==='new')return <Editor kind={kind}/>;if(b&&c==='edit')return <Editor kind={kind} id={b}/>;if(b)return <DocView kind={kind} id={b}/>;return <DocList kind={kind}/>}
 if(a==='vendors')return <Vendors openId={b}/>;
 if(a==='budgets')return <Budgets/>;
 if(a==='workflows')return <Workflows/>;
 return <Inbox/>;
}

function useDocs(kind?:string){return useApi<{docs:Doc[],canCreatePR:boolean,canCreatePO:boolean}>('/api/purchasing'+(kind?`?kind=${kind}`:''))}
function docCols(person:(id?:string|null)=>{name:string}|undefined,kind?:string):Col<Doc>[]{return [
 {key:'number',label:'Number',width:140,render:d=><span className="mono">{d.number}</span>},
 {key:'title',label:'Title',render:d=><div className="cell-title"><b>{d.title}</b><small>{d.department}{d.pending_step?` · waiting on ${d.pending_step}`:''}</small></div>},
 ...(kind?[]:[{key:'kind',label:'Type',width:80} as Col<Doc>]),
 {key:'status',label:'Status',width:150,render:d=><Chip>{d.status}</Chip>},
 {key:'requester',label:kind==='PO'?'Buyer':'Requester',width:170,render:d=><Who id={d.requester_id}/>,value:d=>person(d.requester_id)?.name||''},
 {key:'total',label:'Total',width:140,align:'right',render:d=><b className="num">{money(d.total,d.currency)}</b>,value:d=>d.total},
 {key:'needed_by',label:'Needed by',width:120,render:d=>d.needed_by?dateOnly(d.needed_by):<span className="muted">—</span>,hide:kind==='PO'},
 {key:'created_at',label:'Created',width:120,render:d=><span className="muted">{dateOnly(d.created_at)}</span>},
]}

function Inbox(){
 const {person,s}=useApp();const {data,error,reload}=useDocs();
 const mine=(data?.docs||[]).filter(d=>d.awaitingMe);const involved=(data?.docs||[]).filter(d=>d.involved&&!d.awaitingMe&&d.requester_id!==s.user.id).slice(0,50);
 return <div className="page">
  <Header icon="Stamp" tone="green" title="Approvals inbox" subtitle="Requisitions and purchase orders waiting for your decision, in the order they were submitted."/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<>
   {!mine.length?<Card><Empty icon="Stamp" title="No approvals waiting">When a document reaches a step you approve, it appears here and you get a notification.</Empty></Card>:
   <div className="approval-cards">{mine.sort((x,y)=>String(x.submitted_at).localeCompare(String(y.submitted_at))).map(d=><a key={d.id} href={`#/purchasing/${d.kind.toLowerCase()}/${d.id}`} className="approval-card"><div className="approval-top"><span className={`kind-badge k-${d.kind}`}>{d.kind}</span><span className="mono muted">{d.number}</span><span className="muted small">{ago(d.submitted_at)}</span></div><h3>{d.title}</h3><div className="approval-amount">{money(d.total,d.currency)}</div><div className="approval-foot"><span className="who"><Avatar name={person(d.requester_id)?.name} size={22}/><span>{person(d.requester_id)?.name}<small>{d.department}</small></span></span><Chip tone="amber">{d.pending_step}</Chip></div></a>)}</div>}
   {involved.length>0&&<><h2 className="section-title">Recently in your approval chain</h2><Grid id="inbox-involved" rows={involved} cols={docCols(person)} onOpen={d=>go(`purchasing/${d.kind.toLowerCase()}/${d.id}`)}/></>}
  </>}
 </div>;
}

function DocList({kind}:{kind:'PR'|'PO'}){
 const {person,s,can}=useApp();const {data,error,reload}=useDocs(kind);const [scope,setScope]=useState(kind==='PR'?'mine':'all');const [status,setStatus]=useState('');
 const rows=useMemo(()=>(data?.docs||[]).filter(d=>(scope==='all'||d.requester_id===s.user.id)&&(!status||d.status===status)),[data,scope,status,s.user.id]);
 const statuses=[...new Set((data?.docs||[]).map(d=>d.status))];
 const totals=useMemo(()=>({count:rows.length,value:rows.reduce((t,d)=>t+d.total,0),pending:rows.filter(d=>d.status==='Pending approval').length}),[rows]);
 const canCreate=kind==='PR'?can('requests','create'):can('procurement','create');
 return <div className="page">
  <Header icon={kind==='PR'?'ClipboardList':'FileText'} tone="green" title={kind==='PR'?'Purchase requisitions':'Purchase orders'} subtitle={kind==='PR'?'Ask for what your team needs. Each requisition follows its approval chain automatically.':'Orders raised from approved requisitions, issued to vendors and received into stores.'} actions={<>{<Segmented value={scope} onChange={setScope} items={[{id:'mine',label:kind==='PR'?'Mine':'Raised by me'},{id:'all',label:'All I can see'}]}/>}{canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`purchasing/${kind.toLowerCase()}/new`)}>{kind==='PR'?'New requisition':'New order'}</Btn>}</>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {data&&<div className="stats compact"><Stat label="Documents" value={totals.count}/><Stat label="Total value" value={money(totals.value,s.tenant.currency,0)}/><Stat label="Pending approval" value={totals.pending}/></div>}
  {!data?<Skeleton/>:<Grid id={'docs-'+kind} rows={rows} cols={docCols(person,kind)} exportName={kind==='PR'?'requisitions':'purchase-orders'} onOpen={d=>go(`purchasing/${kind.toLowerCase()}/${d.id}`)}
   toolbar={<select className="grid-select" value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{statuses.map(x=><option key={x}>{x}</option>)}</select>}
   empty={<Empty icon={kind==='PR'?'ClipboardList':'FileText'} title={kind==='PR'?'No requisitions yet':'No purchase orders yet'} action={canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`purchasing/${kind.toLowerCase()}/new`)}>{kind==='PR'?'Raise a requisition':'Create an order'}</Btn>}>{kind==='PO'?'Orders are usually created by converting an approved requisition.':undefined}</Empty>}/>}
 </div>;
}

// ── Document view ───────────────────────────────────────────────────────────
function DocView({kind,id}:{kind:'PR'|'PO',id:string}){
 const {s,toast,ask,person,can}=useApp();const {data,error,reload}=useApi<any>('/api/purchasing?id='+encodeURIComponent(id));
 const [busy,setBusy]=useState(''),[tab,setTab]=useState('comments'),[dialog,setDialog]=useState<''|'convert'|'issue'|'receive'|'return'|'quote'>('');
 const d:Doc|undefined=data?.doc;const lines:Line[]=data?.lines||[];
 async function act(action:string,extra:Record<string,unknown>={},msg='Done'){setBusy(action);try{const r=await api<any>('/api/purchasing',{action,id,...extra});toast(msg);if(r.emailError)toast(r.emailError,'error');await reload();return r}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}}
 async function decide(decision:'approve'|'reject'){const v=await ask({title:decision==='approve'?`Approve ${d!.number}?`:`Reject ${d!.number}?`,body:decision==='approve'?<>You are approving <b>{money(d!.total,d!.currency)}</b> at step <b>{data.approvals.find((x:any)=>x.status==='Pending')?.stepName}</b>.{!data.isAssignedApprover&&<><br/><br/>You are not the assigned approver: this will be recorded as an administrator override.</>}</>:'The requester is notified with your reason and can edit and resubmit.',confirm:decision==='approve'?'Approve':'Reject',danger:decision==='reject',input:{label:decision==='approve'?'Comment (optional)':'Reason',required:decision==='reject',multiline:true}});if(v===false)return;await act('decide',{decision,comment:v},decision==='approve'?'Approved':'Rejected')}
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!d)return <div className="page"><Skeleton rows={10}/></div>;
 const back=`purchasing/${kind.toLowerCase()}`;
 return <div className="page doc-page">
  <div className="doc-top no-print"><Btn variant="ghost" icon="ArrowLeft" onClick={()=>history.length>1?history.back():go(back)}>Back</Btn><div className="grow"/><Btn variant="ghost" icon="Printer" onClick={()=>window.print()}>Print</Btn></div>
  <div className="doc-layout">
   <article className="paper">
    <header className="paper-head"><div><span className="paper-company">{s.tenant.legalName||s.tenant.name}</span>{s.tenant.settings.address&&<small>{s.tenant.settings.address}</small>}</div><div className="paper-id"><span>{kind==='PR'?'Purchase requisition':'Purchase order'}</span><b>{d.number}</b><Chip>{d.status}</Chip></div></header>
    <h1 className="paper-title">{d.title}</h1>
    <div className="paper-meta">
     <div><small>{kind==='PR'?'Requested by':'Buyer'}</small><b>{person(d.requester_id)?.name||'—'}</b></div>
     <div><small>Department</small><b>{d.department}</b></div>
     <div><small>{kind==='PR'?'Needed by':'Delivery date'}</small><b>{d.needed_by?dateOnly(d.needed_by):'—'}</b></div>
     <div><small>Deliver to</small><b>{d.location||'—'}</b></div>
     {kind==='PO'&&<div className="span2"><small>Vendor</small><b>{data.vendor?.name||'Not selected'}</b>{data.vendor&&<small>{[data.vendor.email,data.vendor.phone,data.vendor.address].filter(Boolean).join(' · ')}</small>}</div>}
     <div><small>Created</small><b>{dateOnly(d.created_at)}</b></div>
    </div>
    <table className="lines"><thead><tr><th>#</th><th>Description</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Tax</th><th className="r">Amount</th>{kind==='PO'&&['Issued','Partially received','Received','Closed'].includes(d.status)&&<th className="r">Received</th>}</tr></thead>
     <tbody>{lines.map(l=><tr key={l.id}><td className="muted">{l.line_no}</td><td>{l.description}{l.item_code&&<small className="mono"> · {l.item_code}</small>}</td><td className="r">{l.qty.toLocaleString()} {l.unit}</td><td className="r">{money(l.unit_price,d.currency)}</td><td className="r muted">{l.tax_rate?`${l.tax_rate}%`:'—'}</td><td className="r"><b>{money(l.qty*l.unit_price,d.currency)}</b></td>{kind==='PO'&&['Issued','Partially received','Received','Closed'].includes(d.status)&&<td className="r">{(l.received_qty||0).toLocaleString()} / {l.qty.toLocaleString()}</td>}</tr>)}</tbody>
     <tfoot><tr><td colSpan={5} className="r">Subtotal</td><td className="r">{money(d.subtotal,d.currency)}</td></tr><tr><td colSpan={5} className="r">Tax</td><td className="r">{money(d.tax,d.currency)}</td></tr><tr className="grand"><td colSpan={5} className="r">Total</td><td className="r">{money(d.total,d.currency)}</td></tr></tfoot>
    </table>
    {d.justification&&<section className="paper-section"><h3>{kind==='PR'?'Justification':'Notes'}</h3><p>{d.justification}</p></section>}
    {d.terms&&<section className="paper-section"><h3>Terms</h3><p>{d.terms}</p></section>}
    {data.approvals.some((a:any)=>a.status==='Approved')&&<section className="paper-section print-only"><h3>Approvals</h3>{data.approvals.filter((a:any)=>a.status==='Approved').map((a:any)=><p key={a.id}>{a.stepName}: {person(a.decidedBy)?.name} · {dateTime(a.decidedAt)}</p>)}</section>}
   </article>
   <aside className="doc-side no-print">
    <Card title="Actions">
     <div className="action-list">
      {data.canDecide&&<div className="decide"><Btn variant="primary" icon="Check" busy={busy==='decide'} onClick={()=>decide('approve')}>Approve</Btn><Btn variant="danger" icon="X" onClick={()=>decide('reject')}>Reject</Btn></div>}
      {data.canEdit&&<Btn icon="Pencil" onClick={()=>go(`purchasing/${kind.toLowerCase()}/${id}/edit`)}>Edit</Btn>}
      {data.canSubmit&&<Btn variant="primary" icon="Send" busy={busy==='submit'} onClick={()=>act('submit',{},'Submitted for approval')}>Submit for approval</Btn>}
      {data.canRecall&&<Btn icon="Undo2" busy={busy==='recall'} onClick={()=>act('recall',{},'Recalled to draft')}>Recall to draft</Btn>}
      {data.canConvert&&<Btn variant="primary" icon="ArrowRightLeft" onClick={()=>setDialog('convert')}>Convert to purchase order</Btn>}
      {data.canIssue&&<Btn variant="primary" icon="Send" onClick={()=>setDialog('issue')}>Issue to vendor</Btn>}
      {data.canReceive&&<Btn variant="primary" icon="PackageCheck" onClick={()=>setDialog('receive')}>Receive goods</Btn>}
      {d.kind==='PO'&&['Partially received','Received','Closed'].includes(d.status)&&(can('receipts','create')||can('procurement','update'))&&<Btn icon="Undo2" onClick={()=>setDialog('return')}>Return to vendor</Btn>}
      {data.canClose&&<Btn icon="Archive" busy={busy==='close'} onClick={()=>act('close',{},'Order closed')}>Close order</Btn>}
      {data.canCancel&&<Btn variant="ghost" icon="Ban" onClick={async()=>{const v=await ask({title:`Cancel ${d.number}?`,confirm:'Cancel document',danger:true,input:{label:'Reason (optional)'}});if(v!==false)act('cancel',{comment:v},'Cancelled')}}>Cancel</Btn>}
      {!data.canDecide&&!data.canEdit&&!data.canSubmit&&!data.canRecall&&!data.canConvert&&!data.canIssue&&!data.canReceive&&!data.canClose&&<p className="muted small">No actions for you at this stage.</p>}
     </div>
    </Card>
    <Card title="Approval chain">
     {data.approvals.length?<ol className="chain">{data.approvals.map((a:any)=><li key={a.id} className={`step st-${a.status.toLowerCase()}`}><span className="step-dot"><Icon name={a.status==='Approved'?'Check':a.status==='Rejected'?'X':a.status==='Pending'?'Hourglass':a.status==='Skipped'?'SkipForward':'Circle'} size={13} stroke={2.4}/></span><div><b>{a.stepName}</b><small>{a.status==='Approved'||a.status==='Rejected'?<>{a.status} by {person(a.decidedBy)?.name||'—'} · {ago(a.decidedAt)}</>:a.status==='Skipped'?a.comment:(a.approverIds as string[]).map(x=>person(x)?.name).filter(Boolean).join(', ')||'—'}</small>{a.comment&&!['Skipped'].includes(a.status)&&<q>{a.comment}</q>}</div></li>)}</ol>:
      data.workflowPreview?<><p className="muted small">When submitted, this goes through <b>{data.workflowPreview.name}</b>:</p><ol className="chain preview">{data.workflowPreview.steps.map((st:any,i:number)=><li key={i} className={cx('step',st.minAmount&&d.total<st.minAmount&&'st-skipped')}><span className="step-dot">{i+1}</span><div><b>{st.name}</b><small>{st.minAmount?(d.total<st.minAmount?`Skipped below ${money(st.minAmount,d.currency,0)}`:`Above ${money(st.minAmount,d.currency,0)}`):stepLabel(st)}</small></div></li>)}</ol></>:<p className="muted small">No approvals recorded.</p>}
    </Card>
    {(data.quotations.length>0||data.canQuote)&&<Card title="Quotations" actions={data.canQuote&&<Btn size="sm" icon="Plus" onClick={()=>setDialog('quote')}>Add</Btn>}>{!data.quotations.length?<p className="muted small">Collect vendor quotes and mark the chosen one; converting to a purchase order uses its vendor.</p>:<div className="mini-list">{data.quotations.map((q:any)=><div key={q.id} className="mini-row"><span>{q.vendor_name}<small>{q.valid_until?`valid to ${dateOnly(q.valid_until)}`:''}{q.notes?` · ${q.notes}`:''}</small></span><b>{money(q.amount,q.currency)}</b>{q.selected?<Chip tone="green">Selected</Chip>:data.canQuote&&<Btn size="sm" variant="ghost" onClick={()=>act('quote-select',{quoteId:q.id},'Quotation selected')}>Select</Btn>}</div>)}</div>}</Card>}
    {data.budget&&<Card title="Budget"><KV items={[['Budget',data.budget.name],['Amount',money(data.budget.amount,data.budget.currency)],['Spent',money(data.budget.spent,data.budget.currency)],['Committed',money(data.budget.committed,data.budget.currency)],['Remaining',<b key="r" className={data.budget.remaining<0?'text-red':''}>{money(data.budget.remaining,data.budget.currency)}</b>]]}/></Card>}
    {data.related.length>0&&<Card title="Linked documents"><div className="mini-list">{data.related.map((r:any)=><a key={r.id} href={`#/purchasing/${r.kind.toLowerCase()}/${r.id}`}><span className={`kind-badge k-${r.kind}`}>{r.kind}</span><span>{r.number}</span><Chip>{r.status}</Chip></a>)}</div></Card>}
    <Card pad={false}><div className="card-tabs"><Tabs value={tab} onChange={setTab} items={[{id:'comments',label:'Comments',count:data.comments.length},{id:'activity',label:'Activity'}]}/></div><div className="card-pad">{tab==='comments'?<Thread comments={data.comments} onPost={async body=>{await api('/api/comments',{type:kind,id,body});await reload()}}/>:<Timeline events={data.history}/>}</div></Card>
   </aside>
  </div>
  {dialog==='convert'&&<ConvertDialog doc={d} onClose={()=>setDialog('')}/>}
  {dialog==='issue'&&<Modal open onClose={()=>setDialog('')} title={`Issue ${d.number}`} subtitle={data.vendor?.name||'No vendor selected'} footer={<><Btn variant="ghost" onClick={()=>setDialog('')}>Cancel</Btn><Btn busy={busy==='issue'} onClick={async()=>{await act('issue',{email:false},'Order issued');setDialog('')}}>Mark as issued</Btn>{data.emailReady&&data.vendor?.email&&<Btn variant="primary" icon="Mail" busy={busy==='issue'} onClick={async()=>{const r=await act('issue',{email:true},'Order issued');if(r?.emailed)toast(`Emailed to ${data.vendor.email}`);setDialog('')}}>Issue & email vendor</Btn>}</>}>{!data.vendor&&<Note tone="warn">Choose a vendor by editing this order before issuing it.</Note>}{data.vendor&&!data.vendor.email&&<Note>Add an email to {data.vendor.name} to send the order directly.</Note>}{!data.emailReady&&<Note>Email is not configured for this workspace. Print the order or send it yourself, then mark it issued.</Note>}</Modal>}
  {dialog==='return'&&<ReturnDialog doc={d} lines={lines} onClose={()=>setDialog('')} onDone={()=>{setDialog('');reload()}}/>}
  {dialog==='quote'&&<QuoteDialog doc={d} onClose={()=>setDialog('')} onDone={()=>{setDialog('');reload()}}/>}
  {dialog==='receive'&&<ReceiveDialog doc={d} lines={lines} onClose={()=>setDialog('')} onDone={()=>{setDialog('');reload()}}/>}
 </div>;
}
function stepLabel(st:{type:string,ref?:string}){return st.type==='manager'?"Requester's reporting manager":st.type==='department_head'?'Head of the requesting department':st.type==='department'?`Head of ${st.ref}`:st.type==='role'?`Anyone with the ${st.ref} role`:st.type==='access'?(st.ref==='admin'?'Any administrator':'Any department head'):'A named person'}

function ConvertDialog({doc,onClose}:{doc:Doc,onClose:()=>void}){
 const {toast}=useApp();const {data}=useApi<{vendors:Vendor[]}>('/api/purchasing?view=vendors');const [vendor,setVendor]=useState(''),[busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title="Convert to purchase order" subtitle={`${doc.number} · ${money(doc.total,doc.currency)}`} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);try{const r=await api<{id:string,number:string}>('/api/purchasing',{action:'convert',id:doc.id,vendorId:vendor||null});toast(`${r.number} created as a draft`);go(`purchasing/po/${r.id}`)}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Create draft order</Btn></>}>
  <p className="muted">Lines, quantities and prices are copied into a draft order you can adjust before submitting it for approval.</p>
  <Field label="Vendor" hint={<a href="#/purchasing/vendors">Manage vendors</a>}><select value={vendor} onChange={e=>setVendor(e.target.value)}><option value="">Choose later</option>{data?.vendors.filter(v=>v.status!=='Inactive').map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
 </Modal>;
}
// Goods receipt: lines linked to a stock item can go straight into a store; any line can create asset records.
function ReceiveDialog({doc,lines,onClose,onDone}:{doc:Doc,lines:Line[],onClose:()=>void,onDone:()=>void}){
 const {toast,can}=useApp();
 const [rows,setRows]=useState(()=>Object.fromEntries(lines.map(l=>[l.id!,{qty:String(Math.max(0,l.qty-(l.received_qty||0))),toStock:!!l.inventory_item_id,assets:'0',category:''}])));
 const [store,setStore]=useState(doc.location),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 const upd=(id:string,k:string,v:string|boolean)=>setRows({...rows,[id]:{...rows[id],[k]:v}});
 return <Modal open wide onClose={onClose} title={`Receive goods · ${doc.number}`} subtitle="Enter what physically arrived. Partial deliveries keep the order open." footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="PackageCheck" busy={busy} onClick={async()=>{setBusy(true);try{const r=await api<{grn:string,assets:string[]}>('/api/purchasing',{action:'receive',id:doc.id,note,store,lines:lines.map(l=>({lineId:l.id,qty:Number(rows[l.id!].qty||0),toStock:rows[l.id!].toStock,createAssets:Number(rows[l.id!].assets||0),assetCategory:rows[l.id!].category}))});toast(`Received · ${r.grn}${r.assets.length?` · ${r.assets.length} assets created`:''}`);onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Record receipt</Btn></>}>
  <table className="lines compact"><thead><tr><th>Item</th><th className="r">Ordered</th><th className="r">Received</th><th className="r">Receiving now</th><th>Into stock</th>{can('assets','create')&&<th>Create assets</th>}</tr></thead><tbody>{lines.map(l=><tr key={l.id}><td>{l.description}{l.item_code&&<small className="mono"> · {l.item_code}</small>}</td><td className="r">{l.qty} {l.unit}</td><td className="r">{l.received_qty||0}</td><td className="r"><input className="qty" type="number" min="0" max={l.qty-(l.received_qty||0)} step="any" value={rows[l.id!].qty} onChange={e=>upd(l.id!,'qty',e.target.value)}/></td><td>{l.inventory_item_id?<label className="check"><input type="checkbox" checked={rows[l.id!].toStock} onChange={e=>upd(l.id!,'toStock',e.target.checked)}/>Stock</label>:<span className="muted small">Not a stock item</span>}</td>{can('assets','create')&&<td><div className="row-gap"><input className="qty" type="number" min="0" max={Number(rows[l.id!].qty)||0} value={rows[l.id!].assets} onChange={e=>upd(l.id!,'assets',e.target.value)} aria-label="Assets to create"/>{Number(rows[l.id!].assets)>0&&<input style={{width:120}} placeholder="Category" value={rows[l.id!].category} onChange={e=>upd(l.id!,'category',e.target.value)}/>}</div></td>}</tr>)}</tbody></table>
  <div className="form-grid"><Field label="Receiving store" hint="Where stock lines are put away."><LocationInput value={store} onChange={setStore}/></Field><Field label="Delivery note / remarks"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Delivery note number, condition on arrival…"/></Field></div>
 </Modal>;
}
function ReturnDialog({doc,lines,onClose,onDone}:{doc:Doc,lines:Line[],onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [qty,setQty]=useState<Record<string,string>>({}),[fromStock,setFromStock]=useState<Record<string,boolean>>({}),[reason,setReason]=useState(''),[store,setStore]=useState(doc.location),[busy,setBusy]=useState(false);
 return <Modal open wide onClose={onClose} title={`Return to vendor · ${doc.number}`} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="danger" busy={busy} disabled={!reason} onClick={async()=>{setBusy(true);try{const r=await api<{rtn:string}>('/api/purchasing',{action:'return',id:doc.id,reason,store,lines:lines.map(l=>({lineId:l.id,qty:Number(qty[l.id!]||0),fromStock:!!fromStock[l.id!]}))});toast(`Return recorded · ${r.rtn}`);onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Record return</Btn></>}>
  <table className="lines compact"><thead><tr><th>Item</th><th className="r">Received</th><th className="r">Already returned</th><th className="r">Return now</th><th>Take from stock</th></tr></thead><tbody>{lines.map(l=><tr key={l.id}><td>{l.description}</td><td className="r">{l.received_qty||0}</td><td className="r">{l.returned_qty||0}</td><td className="r"><input className="qty" type="number" min="0" max={l.received_qty||0} step="any" value={qty[l.id!]||''} onChange={e=>setQty({...qty,[l.id!]:e.target.value})}/></td><td>{l.inventory_item_id?<label className="check"><input type="checkbox" checked={!!fromStock[l.id!]} onChange={e=>setFromStock({...fromStock,[l.id!]:e.target.checked})}/>Yes</label>:<span className="muted small">—</span>}</td></tr>)}</tbody></table>
  <div className="form-grid"><Field label="Reason" wide><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Damaged on arrival, wrong item…"/></Field><Field label="Store (for stock lines)" wide><LocationInput value={store} onChange={setStore}/></Field></div>
 </Modal>;
}
function QuoteDialog({doc,onClose,onDone}:{doc:Doc,onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const {data}=useApi<{vendors:Vendor[]}>('/api/purchasing?view=vendors');const [v,setV]=useState({vendorId:'',amount:'',currency:doc.currency,validUntil:'',notes:''});const [busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title="Add quotation" subtitle={doc.number} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.vendorId||!v.amount} onClick={async()=>{setBusy(true);try{await api('/api/purchasing',{action:'quote',id:doc.id,...v});toast('Quotation added');onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Add</Btn></>}>
  <div className="form-grid"><Field label="Vendor" wide><select value={v.vendorId} onChange={e=>setV({...v,vendorId:e.target.value})}><option value="">Choose…</option>{data?.vendors.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Amount"><input type="number" min="0" step="0.01" value={v.amount} onChange={e=>setV({...v,amount:e.target.value})}/></Field><Field label="Currency"><input value={v.currency} onChange={e=>setV({...v,currency:e.target.value.toUpperCase()})}/></Field><Field label="Valid until"><input type="date" value={v.validUntil} onChange={e=>setV({...v,validUntil:e.target.value})}/></Field><Field label="Notes" wide><input value={v.notes} onChange={e=>setV({...v,notes:e.target.value})} placeholder="Lead time, payment terms…"/></Field></div>
 </Modal>;
}
// ── Budgets ─────────────────────────────────────────────────────────────────
type Budget={id:string,name:string,department:string,cost_centre:string,period_start:string,period_end:string,amount:number,currency:string,status:string,spent:number,committed:number,remaining:number};
function Budgets(){
 const {s,toast}=useApp();const {data,error,reload}=useApi<{budgets:Budget[],canEdit:boolean}>('/api/purchasing?view=budgets');const [edit,setEdit]=useState<Partial<Budget>|null>(null);
 const cols:Col<Budget>[]=[{key:'name',label:'Budget',render:b=><div className="cell-title"><b>{b.name}</b><small>{b.department||'All departments'}{b.cost_centre?` · ${b.cost_centre}`:''}</small></div>},{key:'period',label:'Period',width:200,render:b=>`${dateOnly(b.period_start)} – ${dateOnly(b.period_end)}`,value:b=>b.period_start},{key:'amount',label:'Amount',width:130,align:'right',render:b=>money(b.amount,b.currency,0),value:b=>b.amount},{key:'spent',label:'Spent',width:120,align:'right',render:b=>money(b.spent,b.currency,0),value:b=>b.spent},{key:'committed',label:'Committed',width:120,align:'right',render:b=>money(b.committed,b.currency,0),value:b=>b.committed},{key:'remaining',label:'Remaining',width:130,align:'right',render:b=><b className={b.remaining<0?'text-red':''}>{money(b.remaining,b.currency,0)}</b>,value:b=>b.remaining},{key:'used',label:'Used',width:140,render:b=><div className="meter"><i style={{width:`${Math.min(100,(b.spent+b.committed)/Math.max(1,b.amount)*100)}%`}}/></div>,value:b=>(b.spent+b.committed)/Math.max(1,b.amount)},{key:'status',label:'Status',width:100,render:b=><Chip>{b.status}</Chip>}];
 return <div className="page"><Header icon="PiggyBank" tone="green" title="Budgets" subtitle="Spent = issued and approved purchase orders. Committed = requisitions pending or approved but not yet ordered." actions={data?.canEdit&&<Btn variant="primary" icon="Plus" onClick={()=>setEdit({name:'',department:'',cost_centre:'',period_start:`${new Date().getFullYear()}-01-01`,period_end:`${new Date().getFullYear()}-12-31`,amount:0,currency:s.tenant.currency,status:'Active'})}>New budget</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="budgets" rows={data.budgets} cols={cols} exportName="budgets" onOpen={b=>data.canEdit&&setEdit(b)} empty={<Empty icon="PiggyBank" title="No budgets yet"/>}/>}
  {edit&&<Modal open onClose={()=>setEdit(null)} title={edit.id?'Edit budget':'New budget'} footer={<><Btn variant="ghost" onClick={()=>setEdit(null)}>Cancel</Btn><Btn variant="primary" disabled={!edit.name} onClick={async()=>{try{await api('/api/purchasing',{action:'budget',id:edit.id,name:edit.name,department:edit.department,costCentre:edit.cost_centre,periodStart:edit.period_start,periodEnd:edit.period_end,amount:edit.amount,currency:edit.currency,status:edit.status});toast('Budget saved');setEdit(null);reload()}catch(e){toast((e as Error).message,'error')}}}>Save</Btn></>}>
   <div className="form-grid"><Field label="Name" wide><input autoFocus value={edit.name||''} onChange={e=>setEdit({...edit,name:e.target.value})}/></Field><Field label="Department"><DeptSelect value={edit.department||''} any="All departments" onChange={x=>setEdit({...edit,department:x})}/></Field><Field label="Cost centre"><input value={edit.cost_centre||''} onChange={e=>setEdit({...edit,cost_centre:e.target.value})}/></Field><Field label="From"><input type="date" value={edit.period_start||''} onChange={e=>setEdit({...edit,period_start:e.target.value})}/></Field><Field label="To"><input type="date" value={edit.period_end||''} onChange={e=>setEdit({...edit,period_end:e.target.value})}/></Field><Field label="Amount"><input type="number" min="0" value={edit.amount??''} onChange={e=>setEdit({...edit,amount:Number(e.target.value)})}/></Field><Field label="Currency"><input value={edit.currency||''} onChange={e=>setEdit({...edit,currency:e.target.value.toUpperCase()})}/></Field><Field label="Status"><select value={edit.status||'Active'} onChange={e=>setEdit({...edit,status:e.target.value})}>{['Draft','Active','Closed'].map(x=><option key={x}>{x}</option>)}</select></Field></div>
  </Modal>}
 </div>;
}

// ── Editor ──────────────────────────────────────────────────────────────────
function Editor({kind,id}:{kind:'PR'|'PO',id?:string}){
 const {s,toast}=useApp();const existing=useApi<any>(id?'/api/purchasing?id='+encodeURIComponent(id):null);const vendors=useApi<{vendors:Vendor[]}>(kind==='PO'?'/api/purchasing?view=vendors':null);
 const blank:Line={description:'',item_code:'',qty:1,unit:'ea',unit_price:0,tax_rate:0};
 const [v,setV]=useState({title:'',justification:'',department:s.user.department,location:s.user.location||'',neededBy:'',currency:s.tenant.currency,terms:kind==='PO'?String(s.tenant.settings.poTerms||''):'',vendorId:'',costCentre:s.departments.find(d=>d.name===s.user.department)?.costCentre||'',budgetId:''});
 const stock=useApi<{items:{id:string,sku:string,name:string,unit:string,unit_cost:number}[]}>(s.user.permissions.inventory?.view!=='none'?'/api/inventory':null);
 const budgets=useApi<{budgets:{id:string,name:string,department:string,remaining:number,currency:string,status:string}[]}>(s.user.permissions.budgets?.view!=='none'?'/api/purchasing?view=budgets':null);
 const [lines,setLines]=useState<Line[]>([{...blank}]);const [busy,setBusy]=useState('');const [loaded,setLoaded]=useState(!id);
 useEffect(()=>{const d=existing.data?.doc;if(!d||loaded)return;setV({title:d.title,justification:d.justification,department:d.department,location:d.location,neededBy:d.needed_by||'',currency:d.currency,terms:d.terms,vendorId:d.vendor_id||'',costCentre:d.cost_centre||'',budgetId:d.budget_id||''});setLines(existing.data.lines.map((l:Line)=>({...l})));setLoaded(true)},[existing.data,loaded]);
 const sub=lines.reduce((t,l)=>t+(Number(l.qty)||0)*(Number(l.unit_price)||0),0),tax=lines.reduce((t,l)=>t+(Number(l.qty)||0)*(Number(l.unit_price)||0)*(Number(l.tax_rate)||0)/100,0);
 const setLine=(i:number,k:keyof Line,val:string)=>setLines(ls=>ls.map((l,j)=>j===i?{...l,[k]:['qty','unit_price','tax_rate'].includes(k)?val as unknown as number:val}:l));
 async function save(submit:boolean){setBusy(submit?'submit':'save');try{const r=await api<{id:string}>('/api/purchasing',{action:'save',kind,id,version:existing.data?.doc?.version,...v,lines:lines.filter(l=>l.description.trim()).map(l=>({inventoryItemId:stock.data?.items.find(x=>x.sku===l.item_code.trim().toUpperCase())?.id||null,description:l.description,itemCode:l.item_code,qty:Number(l.qty),unit:l.unit,unitPrice:Number(l.unit_price),taxRate:Number(l.tax_rate)})),submit});toast(submit?'Submitted for approval':'Draft saved');go(`purchasing/${kind.toLowerCase()}/${r.id}`)}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}}
 if(id&&!loaded)return <div className="page"><ErrorNote error={existing.error}/><Skeleton rows={8}/></div>;
 return <div className="page">
  <Header icon={kind==='PR'?'ClipboardList':'FileText'} tone="green" title={id?`Edit ${existing.data?.doc?.number}`:kind==='PR'?'New purchase requisition':'New purchase order'} subtitle={kind==='PR'?'Describe what you need and why. Prices can be estimates; procurement confirms them on the order.':'Orders go through their own approval before they can be issued to the vendor.'} actions={<Btn variant="ghost" icon="X" onClick={()=>history.back()}>Discard</Btn>}/>
  <form className="editor" onSubmit={e=>{e.preventDefault();save(true)}}>
   <Card title="Details"><div className="form-grid">
    <Field label="Title" wide><input required autoFocus maxLength={200} value={v.title} onChange={e=>setV({...v,title:e.target.value})} placeholder={kind==='PR'?'e.g. Laptops for new finance officers':'e.g. Packaging film – Q4 supply'}/></Field>
    <Field label="Department"><DeptSelect value={v.department} required onChange={x=>setV({...v,department:x})}/></Field>
    <Field label={kind==='PR'?'Needed by':'Delivery date'}><input type="date" value={v.neededBy} onChange={e=>setV({...v,neededBy:e.target.value})}/></Field>
    <Field label="Deliver to"><LocationInput value={v.location} onChange={x=>setV({...v,location:x})}/></Field>
    <Field label="Cost centre"><input value={v.costCentre} onChange={e=>setV({...v,costCentre:e.target.value})}/></Field>
    {budgets.data&&<Field label="Budget" hint="Approved spend counts against this budget."><select value={v.budgetId} onChange={e=>setV({...v,budgetId:e.target.value})}><option value="">No budget</option>{budgets.data.budgets.filter(b=>b.status==='Active'||b.id===v.budgetId).map(b=><option key={b.id} value={b.id}>{b.name} · {b.department||'All'} · {money(b.remaining,b.currency,0)} left</option>)}</select></Field>}
    <Field label="Currency"><input maxLength={8} value={v.currency} onChange={e=>setV({...v,currency:e.target.value.toUpperCase()})}/></Field>
    {kind==='PO'&&<Field label="Vendor" hint={<a href="#/purchasing/vendors">Add a vendor</a>}><select value={v.vendorId} onChange={e=>setV({...v,vendorId:e.target.value})}><option value="">Choose…</option>{vendors.data?.vendors.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
    <Field label={kind==='PR'?'Justification':'Notes'} wide><textarea rows={3} value={v.justification} onChange={e=>setV({...v,justification:e.target.value})} placeholder={kind==='PR'?'Why is this needed? Link it to a ticket, project or budget line.':''}/></Field>
    {kind==='PO'&&<Field label="Terms" wide><textarea rows={3} value={v.terms} onChange={e=>setV({...v,terms:e.target.value})}/></Field>}
   </div></Card>
   <Card title="Line items" actions={<Btn size="sm" icon="Plus" onClick={()=>setLines([...lines,{...blank}])}>Add line</Btn>}>
    <div className="line-editor"><table><thead><tr><th>#</th><th>Description</th><th>Item code / SKU</th><th className="r">Qty</th><th>Unit</th><th className="r">Unit price</th><th className="r">Tax %</th><th className="r">Amount</th><th/></tr></thead><tbody>{lines.map((l,i)=><tr key={i}><td className="muted">{i+1}</td><td><input required={i===0} value={l.description} placeholder="What exactly?" onChange={e=>setLine(i,'description',e.target.value)}/></td><td><input className="w-code" list="stock-skus" value={l.item_code} title="A stock SKU links this line to inventory" onChange={e=>{const hit=stock.data?.items.find(x=>x.sku===e.target.value.toUpperCase());setLines(ls=>ls.map((x,j)=>j===i?{...x,item_code:e.target.value,...(hit&&!x.description?{description:hit.name,unit:hit.unit,unit_price:hit.unit_cost}:{})}:x))}}/>{stock.data?.items.some(x=>x.sku===l.item_code.trim().toUpperCase())&&<Icon name="Package" size={13} className="stock-linked"/>}</td><td><input className="qty" type="number" min="0.0001" step="any" value={l.qty} onChange={e=>setLine(i,'qty',e.target.value)}/></td><td><input className="w-unit" value={l.unit} onChange={e=>setLine(i,'unit',e.target.value)}/></td><td><input className="money-in" type="number" min="0" step="0.01" value={l.unit_price} onChange={e=>setLine(i,'unit_price',e.target.value)}/></td><td><input className="qty" type="number" min="0" max="100" step="0.01" value={l.tax_rate} onChange={e=>setLine(i,'tax_rate',e.target.value)}/></td><td className="r num">{money((Number(l.qty)||0)*(Number(l.unit_price)||0),v.currency)}</td><td><Btn size="sm" variant="ghost" icon="Trash2" title="Remove line" disabled={lines.length===1} onClick={()=>setLines(lines.filter((_,j)=>j!==i))}/></td></tr>)}</tbody></table></div>
    <datalist id="stock-skus">{(stock.data?.items||[]).map(x=><option key={x.id} value={x.sku}>{x.name}</option>)}</datalist>
    <div className="totals"><div><span>Subtotal</span><b>{money(sub,v.currency)}</b></div><div><span>Tax</span><b>{money(tax,v.currency)}</b></div><div className="grand"><span>Total</span><b>{money(sub+tax,v.currency)}</b></div></div>
   </Card>
   <div className="editor-bar"><span className="muted small">Drafts are private to you until submitted.</span><Btn busy={busy==='save'} onClick={()=>save(false)}>Save draft</Btn><Btn type="submit" variant="primary" icon="Send" busy={busy==='submit'}>Save & submit for approval</Btn></div>
  </form>
 </div>;
}

// ── Vendors ─────────────────────────────────────────────────────────────────
function Vendors({openId}:{openId?:string}){
 const {s,toast}=useApp();const {data,error,reload}=useApi<{vendors:Vendor[],canEdit:boolean}>('/api/purchasing?view=vendors');const [edit,setEdit]=useState<Vendor|null|'new'>(null);
 useEffect(()=>{if(openId&&data){const v=data.vendors.find(x=>x.id===openId);if(v)setEdit(v)}},[openId,data]);
 const cols:Col<Vendor>[]=[{key:'name',label:'Vendor',render:v=><div className="cell-title"><b>{v.name}</b><small>{v.email||v.phone}</small></div>},{key:'category',label:'Category',width:160},{key:'status',label:'Status',width:130,render:v=><Chip>{v.status}</Chip>},{key:'orders',label:'Orders',width:90,align:'right'},{key:'spend',label:'Committed spend',width:160,align:'right',render:v=>money(v.spend||0,s.tenant.currency,0),value:v=>v.spend||0},{key:'tax_id',label:'Tax ID',hide:true},{key:'phone',label:'Phone',hide:true},{key:'address',label:'Address',hide:true}];
 return <div className="page"><Header icon="Store" tone="green" title="Vendors" subtitle="The suppliers behind your purchase orders." actions={data?.canEdit&&<Btn variant="primary" icon="Plus" onClick={()=>setEdit('new')}>Add vendor</Btn>}/><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="vendors" rows={data.vendors} cols={cols} exportName="vendors" onOpen={v=>data.canEdit&&setEdit(v)} empty={<Empty icon="Store" title="No vendors yet">Add vendors here, or promote imported purchase orders from Admin → Data hub to create them automatically.</Empty>}/>}
  {edit&&<VendorForm vendor={edit==='new'?undefined:edit} onClose={()=>{setEdit(null);if(openId)go('purchasing/vendors')}} onSaved={()=>{setEdit(null);reload();toast('Vendor saved')}}/>}
 </div>;
}
function VendorForm({vendor,onClose,onSaved}:{vendor?:Vendor,onClose:()=>void,onSaved:()=>void}){
 const {toast}=useApp();const [v,setV]=useState({name:vendor?.name||'',email:vendor?.email||'',phone:vendor?.phone||'',address:vendor?.address||'',taxId:vendor?.tax_id||'',category:vendor?.category||'',status:vendor?.status||'Active',notes:vendor?.notes||''});const [busy,setBusy]=useState(false);const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 return <Inspector open onClose={onClose} title={vendor?vendor.name:'New vendor'} eyebrow="Vendor"><form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await api('/api/purchasing',{action:'vendor',id:vendor?.id,...v});onSaved()}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>
  <Field label="Name" wide><input required value={v.name} onChange={f('name')}/></Field><Field label="Email" hint="Purchase orders can be emailed here."><input type="email" value={v.email} onChange={f('email')}/></Field><Field label="Phone"><input value={v.phone} onChange={f('phone')}/></Field><Field label="Address" wide><input value={v.address} onChange={f('address')}/></Field><Field label="Tax ID / TIN"><input value={v.taxId} onChange={f('taxId')}/></Field><Field label="Category"><input value={v.category} onChange={f('category')} placeholder="Packaging, IT, Logistics…"/></Field><Field label="Status"><select value={v.status} onChange={f('status')}>{['Active','Under review','Inactive'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Notes" wide><textarea rows={3} value={v.notes} onChange={f('notes')}/></Field>
  <div className="form-actions"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" variant="primary" busy={busy}>Save vendor</Btn></div></form></Inspector>;
}

// ── Workflows ───────────────────────────────────────────────────────────────
type Step={name:string,type:string,ref?:string,minAmount?:number|string};
type Flow={id?:string,doc_type:'PR'|'PO',name:string,department:string,min_amount:number,steps:Step[],active:number};
function Workflows(){
 const {s,toast,ask}=useApp();const {data,error,reload}=useApi<{workflows:Flow[]}>('/api/purchasing?view=workflows');const [edit,setEdit]=useState<Flow|null>(null);
 return <div className="page"><Header icon="Workflow" tone="green" title="Approval workflows" subtitle="Sequential approval chains. The most specific active workflow (department, then highest minimum amount) is applied when a document is submitted." actions={<><Btn icon="Plus" onClick={()=>setEdit({doc_type:'PO',name:'',department:'*',min_amount:0,steps:[{name:'Purchase head',type:'role',ref:'Purchase Head'}],active:1})}>PO workflow</Btn><Btn variant="primary" icon="Plus" onClick={()=>setEdit({doc_type:'PR',name:'',department:'*',min_amount:0,steps:[{name:'Reporting manager',type:'manager'}],active:1})}>PR workflow</Btn></>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<div className="flows">{data.workflows.map(w=><Card key={w.id} title={<><span className={`kind-badge k-${w.doc_type}`}>{w.doc_type}</span> {w.name}</>} actions={<><Chip tone={w.active?'green':'gray'}>{w.active?'Active':'Off'}</Chip><Btn size="sm" variant="ghost" icon="Pencil" title="Edit" onClick={()=>setEdit(w)}/><Btn size="sm" variant="ghost" icon="Trash2" title="Delete" onClick={async()=>{if(await ask({title:`Delete “${w.name}”?`,confirm:'Delete',danger:true})===false)return;await api('/api/purchasing',{action:'delete-workflow',id:w.id});reload()}}/></>}>
   <p className="muted small">{w.department==='*'?'All departments':w.department} · from {money(w.min_amount,s.tenant.currency,0)}</p>
   <ol className="flow-steps">{w.steps.map((st,i)=><li key={i}><span>{i+1}</span><div><b>{st.name}</b><small>{stepLabel(st)}{st.minAmount?` · only above ${money(Number(st.minAmount),s.tenant.currency,0)}`:''}</small></div></li>)}</ol>
  </Card>)}{!data.workflows.length&&<Empty icon="Workflow" title="Using the built-in defaults">Requisitions go to the reporting manager, then the department head, then Finance above 10,000. Add a workflow to change this.</Empty>}</div>}
  {edit&&<FlowEditor flow={edit} onClose={()=>setEdit(null)} onSaved={()=>{setEdit(null);reload();toast('Workflow saved')}}/>}
 </div>;
}
function FlowEditor({flow,onClose,onSaved}:{flow:Flow,onClose:()=>void,onSaved:()=>void}){
 const {s,toast}=useApp();const [f,setF]=useState<Flow>(JSON.parse(JSON.stringify(flow)));const [busy,setBusy]=useState(false);
 const setStep=(i:number,patch:Partial<Step>)=>setF({...f,steps:f.steps.map((st,j)=>j===i?{...st,...patch}:st)});
 const move=(i:number,d:number)=>{const st=[...f.steps];const [x]=st.splice(i,1);st.splice(i+d,0,x);setF({...f,steps:st})};
 return <Modal open wide onClose={onClose} title={flow.id?`Edit workflow`:`New ${f.doc_type} workflow`} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);try{await api('/api/purchasing',{action:'workflow',id:f.id,docType:f.doc_type,name:f.name,department:f.department,minAmount:f.min_amount,active:!!f.active,steps:f.steps.map(st=>({...st,minAmount:st.minAmount===''||st.minAmount===undefined?undefined:Number(st.minAmount)}))});onSaved()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Save workflow</Btn></>}>
  <div className="form-grid"><Field label="Name" wide><input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="e.g. Capex above 50,000"/></Field><Field label="Applies to department"><DeptSelect value={f.department} any="*" onChange={x=>setF({...f,department:x||'*'})}/></Field><Field label={`From total (${s.tenant.currency})`}><input type="number" min="0" value={f.min_amount} onChange={e=>setF({...f,min_amount:Number(e.target.value)})}/></Field><Field label="Status"><select value={f.active?'1':'0'} onChange={e=>setF({...f,active:Number(e.target.value)})}><option value="1">Active</option><option value="0">Off</option></select></Field></div>
  <h3 className="section-title">Steps, in order</h3>
  <div className="step-editor">{f.steps.map((st,i)=><div key={i} className="step-row"><span className="step-no">{i+1}</span><input value={st.name} placeholder="Step name" onChange={e=>setStep(i,{name:e.target.value})}/><select value={st.type} onChange={e=>setStep(i,{type:e.target.value,ref:e.target.value==='access'?'admin':e.target.value==='department'?s.departments[0]?.name:e.target.value==='role'?s.roles[0]?.name:undefined})}><option value="manager">Reporting manager</option><option value="department_head">Requesting department head</option><option value="department">Head of a department</option><option value="role">Anyone with a role</option><option value="access">Access level</option><option value="user">Specific person</option></select>
   {st.type==='department'&&<DeptSelect value={st.ref||''} onChange={x=>setStep(i,{ref:x})}/>}
   {st.type==='role'&&<select value={st.ref} onChange={e=>setStep(i,{ref:e.target.value})}>{s.roles.map(r=><option key={r.id} value={r.name}>{r.name}</option>)}</select>}
   {st.type==='access'&&<select value={st.ref} onChange={e=>setStep(i,{ref:e.target.value})}><option value="admin">Any administrator</option><option value="manager">Any department head</option></select>}
   {st.type==='user'&&<PersonSelect value={st.ref} onChange={x=>setStep(i,{ref:x||undefined})}/>}
   <input className="money-in" type="number" min="0" placeholder="Only above…" value={st.minAmount??''} onChange={e=>setStep(i,{minAmount:e.target.value})} title="Skip this step below this total"/>
   <Btn size="sm" variant="ghost" icon="ArrowUp" title="Move up" disabled={!i} onClick={()=>move(i,-1)}/><Btn size="sm" variant="ghost" icon="ArrowDown" title="Move down" disabled={i===f.steps.length-1} onClick={()=>move(i,1)}/><Btn size="sm" variant="ghost" icon="Trash2" title="Remove step" disabled={f.steps.length===1} onClick={()=>setF({...f,steps:f.steps.filter((_,j)=>j!==i)})}/></div>)}</div>
  <Btn size="sm" icon="Plus" onClick={()=>setF({...f,steps:[...f.steps,{name:'',type:'department_head'}]})}>Add step</Btn>
  <Note>Steps with no eligible approver are skipped and recorded. Requesters never approve their own documents; if nobody is left, administrators approve.</Note>
 </Modal>;
}
