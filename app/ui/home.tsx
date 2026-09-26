'use client';
import {ResponsiveContainer,AreaChart,Area,BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid,Legend} from 'recharts';
import {useApi,money,compact,until,ago,dateOnly,go} from './lib';
import {useApp,Btn,Chip,Card,Stat,Empty,Icon,Skeleton,ErrorNote,Who} from './kit';

type Dash={focus:{approvals:any[],assigned:any[],requested:any[],myDocs:any[],myAssets:any[]},announcements:any[],pulse:Record<string,number|null>,charts:{ticketsByStatus:Record<string,number>,ticketsByPriority:Record<string,number>,assetsByStatus:Record<string,number>,assetsByCategory:Record<string,number>,ticketTrend:{week:string,opened:number,resolved:number}[],spend:{month:string,requested:number,ordered:number}[],spendByDepartment:[string,number][]}};

function greeting(){const h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening'}
const tooltipStyle={background:'var(--surface)',border:'1px solid var(--line)',borderRadius:10,fontSize:12,color:'var(--ink)',boxShadow:'var(--shadow-2)'};

export default function Home(){
 const {s,can}=useApp();const {data,error,reload}=useApi<Dash>('/api/dashboard');
 const cur=s.tenant.currency;const first=s.user.name.split(' ')[0];
 const today=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
 return <div className="page home">
  <section className="hero">
   <div><span className="eyebrow">{today}</span><h1>{greeting()}, {first}.</h1><p>{data?heroLine(data):'Gathering what needs you today…'}</p></div>
   <div className="hero-actions">
    {can('maintenance','create')&&<Btn icon="LifeBuoy" onClick={()=>go('tickets/new')}>Raise a ticket</Btn>}
    {can('requests','create')&&<Btn icon="ClipboardList" onClick={()=>go('purchasing/pr/new')}>Request a purchase</Btn>}
    {can('knowledge','create')&&<Btn icon="PenLine" onClick={()=>go('spaces/edit/new')}>Write a page</Btn>}
   </div>
  </section>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton rows={8}/>:<>
   <div className="stats">
    {can('maintenance')&&<Stat label="Open tickets" value={data.pulse.openTickets} icon="LifeBuoy" tone="orange" sub={<>{data.pulse.overdue?<span className="text-red">{data.pulse.overdue} overdue</span>:'None overdue'} · {data.pulse.unassigned} unassigned</>} onClick={()=>go('tickets/queue')}/>}
    {(can('requests')||can('procurement'))&&<Stat label="Awaiting approval" value={data.pulse.pendingApprovals} icon="Stamp" tone="green" sub={`${data.focus.approvals.length} waiting on you`} onClick={()=>go('purchasing/inbox')}/>}
    {can('assets')&&<Stat label="Assets tracked" value={compact(Number(data.pulse.assets))} icon="Boxes" tone="teal" sub={`${money(Number(data.pulse.assetValue),cur,0)} recorded value`} onClick={()=>go('assets/all')}/>}
    {data.pulse.people!==null&&<Stat label="People" value={data.pulse.people} icon="Users" tone="sky" sub={`${data.pulse.newPeople} joined in 30 days`} onClick={()=>go('people/directory')}/>}
    {can('procurement')&&<Stat label="Open orders" value={money(Number(data.pulse.openOrders),cur,0)} icon="FileText" tone="violet" sub="Approved, issued or part-received" onClick={()=>go('purchasing/po')}/>}
   </div>
   <div className="home-grid">
    <div className="home-main">
     <Card title={<><Icon name="Target" size={17}/> Your focus</>} className="focus">
      {!data.focus.approvals.length&&!data.focus.assigned.length?<Empty icon="PartyPopper" title="Nothing needs you right now">New approvals and ticket assignments will land here.</Empty>:<>
       {data.focus.approvals.map(d=><a key={d.id} className="focus-row" href={`#/purchasing/${d.kind.toLowerCase()}/${d.id}`}><span className="focus-kind tone-green"><Icon name="Stamp" size={15}/></span><span className="focus-main"><b>{d.title}</b><small>{d.number} · {d.pending_step} · <Who id={d.requester_id}/></small></span><span className="focus-meta"><b>{money(d.total,d.currency)}</b><Chip tone="amber">Approve</Chip></span></a>)}
       {data.focus.assigned.map(t=><a key={t.id} className="focus-row" href={`#/tickets/${t.id}`}><span className="focus-kind tone-orange"><Icon name="LifeBuoy" size={15}/></span><span className="focus-main"><b>{t.title}</b><small>{t.number} · {t.department}</small></span><span className="focus-meta"><Chip>{t.priority}</Chip><small className={t.due_at&&Date.parse(t.due_at)<Date.now()?'text-red':'muted'}>{until(t.due_at)}</small></span></a>)}
      </>}
     </Card>
     {can('maintenance')&&<Card title="Tickets · last 8 weeks" actions={<Btn size="sm" variant="ghost" onClick={()=>go('tickets/board')}>Open board</Btn>}>
      {data.charts.ticketTrend.every(w=>!w.opened&&!w.resolved)?<Empty icon="ChartLine" title="No ticket activity yet"/>:<div className="chart viz" role="img" aria-label="Tickets opened and resolved per week"><ResponsiveContainer width="100%" height={220}><AreaChart data={data.charts.ticketTrend.map(w=>({...w,label:dateOnly(w.week).slice(0,6)}))} margin={{top:8,right:8,left:-18,bottom:0}}><CartesianGrid vertical={false} stroke="var(--grid)"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fill:'var(--muted)',fontSize:11}}/><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{fill:'var(--muted)',fontSize:11}}/><Tooltip contentStyle={tooltipStyle} cursor={{stroke:'var(--line-strong)'}}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12,color:'var(--muted)'}}/><Area type="monotone" dataKey="opened" name="Opened" stroke="var(--series-1)" fill="var(--series-1)" fillOpacity={.12} strokeWidth={2} dot={false} activeDot={{r:4,strokeWidth:2,stroke:'var(--surface)'}}/><Area type="monotone" dataKey="resolved" name="Resolved" stroke="var(--series-2)" fill="var(--series-2)" fillOpacity={.08} strokeWidth={2} dot={false} activeDot={{r:4,strokeWidth:2,stroke:'var(--surface)'}}/></AreaChart></ResponsiveContainer></div>}
     </Card>}
     {(can('requests')||can('procurement'))&&<Card title={`Purchasing · ${cur}, last 6 months`} actions={<Btn size="sm" variant="ghost" onClick={()=>go('purchasing/pr')}>Requisitions</Btn>}>
      {data.charts.spend.every(m=>!m.requested&&!m.ordered)?<Empty icon="ChartColumn" title="No purchasing activity yet">Submitted requisitions and orders will chart here.</Empty>:<div className="chart viz" role="img" aria-label="Requested and ordered value per month"><ResponsiveContainer width="100%" height={220}><BarChart data={data.charts.spend.map(m=>({...m,label:new Date(m.month+'-01').toLocaleDateString('en-GB',{month:'short'})}))} margin={{top:8,right:8,left:-6,bottom:0}} barGap={2}><CartesianGrid vertical={false} stroke="var(--grid)"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fill:'var(--muted)',fontSize:11}}/><YAxis tickFormatter={v=>compact(v)} tickLine={false} axisLine={false} tick={{fill:'var(--muted)',fontSize:11}}/><Tooltip contentStyle={tooltipStyle} cursor={{fill:'var(--hover)'}} formatter={(v)=>money(Number(v),cur)}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12,color:'var(--muted)'}}/><Bar dataKey="requested" name="Requested (PR)" fill="var(--series-1)" radius={[4,4,0,0]} maxBarSize={22}/><Bar dataKey="ordered" name="Ordered (PO)" fill="var(--series-2)" radius={[4,4,0,0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div>}
     </Card>}
    </div>
    <div className="home-side">
     <Card title={<><Icon name="Megaphone" size={17}/> Announcements</>} actions={can('knowledge')&&<Btn size="sm" variant="ghost" onClick={()=>go('spaces/d/company')}>All</Btn>}>
      {!data.announcements.length?<p className="muted small">No announcements yet.</p>:<div className="announce">{data.announcements.map(a=><a key={a.id} href={`#/spaces/page/${a.id}`} className="announce-item"><b>{a.title}</b><small>{a.department||'Company'} · {ago(a.updated_at)}</small><p>{a.excerpt}</p></a>)}</div>}
     </Card>
     {can('maintenance')&&Object.keys(data.charts.ticketsByPriority).length>0&&<Card title="Open tickets by priority"><BarList data={data.charts.ticketsByPriority} order={['Urgent','High','Medium','Low']}/></Card>}
     {can('assets')&&Object.keys(data.charts.assetsByStatus).length>0&&<Card title="Assets by status"><BarList data={data.charts.assetsByStatus} order={['In use','In store','Maintenance','Retired','Lost']}/></Card>}
     <Card title="Assigned to you" actions={<Btn size="sm" variant="ghost" onClick={()=>go('assets/mine')}>View</Btn>}>
      {!data.focus.myAssets.length?<p className="muted small">No assets are assigned to you.</p>:<div className="mini-list">{data.focus.myAssets.map(a=><a key={a.id} href={`#/assets/mine/${a.id}`}><Icon name="Laptop" size={15}/><span>{a.name}<small>{a.code}</small></span></a>)}</div>}
     </Card>
     {data.focus.myDocs.length>0&&<Card title="My purchase requests"><div className="mini-list">{data.focus.myDocs.map(d=><a key={d.id} href={`#/purchasing/${d.kind.toLowerCase()}/${d.id}`}><Icon name="ClipboardList" size={15}/><span>{d.title}<small>{d.number}</small></span><Chip>{d.status}</Chip></a>)}</div></Card>}
    </div>
   </div>
  </>}
 </div>;
}
function heroLine(d:Dash){const parts:string[]=[];if(d.focus.approvals.length)parts.push(`${d.focus.approvals.length} approval${d.focus.approvals.length>1?'s':''} waiting on you`);if(d.focus.assigned.length)parts.push(`${d.focus.assigned.length} open ticket${d.focus.assigned.length>1?'s':''} assigned to you`);return parts.length?`You have ${parts.join(' and ')}.`:'You are all caught up. Here is how the company is running.'}
// Single-hue magnitude bars with the value printed beside each bar.
export function BarList({data,order}:{data:Record<string,number>,order?:string[]}){const rank=(k:string)=>{const i=order?.indexOf(k)??-1;return i<0?99:i};const entries=Object.entries(data).sort((a,b)=>rank(a[0])-rank(b[0])||b[1]-a[1]).slice(0,8);const max=Math.max(1,...entries.map(e=>e[1]));return <div className="barlist">{entries.map(([k,v])=><div key={k} className="barlist-row" title={`${k}: ${v}`}><span>{k}</span><div><i style={{width:`${Math.max(2,v/max*100)}%`}}/></div><b>{v.toLocaleString()}</b></div>)}</div>}
