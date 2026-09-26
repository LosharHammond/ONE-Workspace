'use client';
import {useApi,go,downloadCsv} from './lib';
import {Header,Grid,ErrorNote,Skeleton,Empty,Btn,type Col} from './kit';
// Reports: every row comes from the server already scoped to the active workspace and the person's access.
export default function Reports({parts}:{parts:string[]}){
 const list=useApi<{reports:{id:string,title:string}[]}>('/api/reports');
 const id=parts[0];const r=useApi<{title:string,rows:Record<string,string|number|null>[],canExport:boolean}>(id?'/api/reports?report='+encodeURIComponent(id):null);
 if(!id)return <div className="page"><Header icon="ChartColumn" tone="blue" title="Reports" subtitle="Cross-module reports for your workspace."/><ErrorNote error={list.error}/>{!list.data?<Skeleton/>:!list.data.reports.length?<Empty icon="ChartColumn" title="No reports available to you"/>:<div className="mini-list">{list.data.reports.map(x=><a key={x.id} href={`#/reports/${x.id}`}>{x.title}</a>)}</div>}</div>;
 const rows=(r.data?.rows||[]).map((x,i)=>({id:String(i),...x}));const keys=Object.keys(r.data?.rows[0]||{});
 const cols:Col<Record<string,unknown>&{id:string}>[]=keys.map(k=>({key:k,label:k,value:x=>(x[k]??'') as string|number}));
 return <div className="page"><div className="doc-top"><Btn variant="ghost" icon="ArrowLeft" onClick={()=>go('reports')}>All reports</Btn></div><Header icon="ChartColumn" tone="blue" title={r.data?.title||'Report'} actions={r.data?.canExport&&<Btn icon="Download" onClick={()=>downloadCsv(id,[keys,...(r.data?.rows||[]).map(x=>keys.map(k=>x[k]??''))])}>Export CSV</Btn>}/><ErrorNote error={r.error}/>{!r.data?<Skeleton/>:<Grid id={'report-'+id} rows={rows} cols={cols}/>}</div>;
}
