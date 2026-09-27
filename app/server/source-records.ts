import type {Item} from '../data';
export type SourceRow={id:string,dataset:string,source:string,imported_at:string,payload_json:string,source_key:string};
const text=(p:Record<string,unknown>,...keys:string[])=>{for(const key of keys){const value=p[key];if(value!==null&&value!==undefined&&String(value).trim())return String(value).trim()}return ''};
const number=(v:string)=>{const n=Number(v.replaceAll(',',''));return v&&Number.isFinite(n)?n:0};
export function mapSource(row:SourceRow):Item|null{
 const p=JSON.parse(row.payload_json) as Record<string,unknown>,s=(...keys:string[])=>text(p,...keys);
 const department=s('Department','Assets Department','Staff Department')||'Unassigned';
 let module='',title='',status=s('Status')||'Not specified',owner='',amount=0,unit='',currency='',details='',reference=row.source_key;
 switch(row.dataset){
 case 'staff':module='people';title=s('Full Name');status=s('Is Active').toLowerCase()==='true'?'Active':'Inactive';owner=s('Reporting Manager');details=[s('Job Title'),s('Staff Unit'),s('Company')].filter(Boolean).join(' · ');break;
 case 'locations':module='locations';title=s('Unit');status='Listed';details=s('Department');break;
 case 'assets':case 'it-assets':module='assets';title=s('Asset Name','Asset Type');reference=s('Asset Code','Serial Number','Serial No')||reference;owner=s('Transferred To','Full Name');details=[s('Category','Asset Type'),s('Location','Assets Unit'),s('Brand'),s('Model'),s('Serial No','Serial Number'),s('Description','Notes')].filter(Boolean).join(' · ');break;
 case 'inventory-balances':module='inventory';title=s('Item');amount=number(s('Available Stock'));status=amount>0?'In stock':amount<0?'Negative stock':'Out of stock';reference=s('Item Code');unit=s('Unit');details=s('Category');break;
 case 'purchase-orders':module='procurement';reference=s('Purchase Order #');title=reference+' · '+s('Vendor');status=s('PO Status','Status')||'Not specified';owner=s('PO Created By');amount=number(s('PO Value (with Tax)'));currency=s('Currency');details=[s('PR Description'),s('Request Number'),s('Delivery Location'),s('Delivery Date')].filter(Boolean).join(' · ');break;
 case 'purchase-requisitions':module='requests';reference=s('Requisition No');title=reference+' · '+(s('Description')||s('Request Type'));owner=s('Requested By');details=[s('Location'),s('Required Date'),s('Ticket No.')].filter(Boolean).join(' · ');break;
 case 'tickets':module='maintenance';reference=s('Ticket No');title=s('Description')||reference;owner=s('Assigned To','Ticket Group');details=[s('Ticket Type'),s('Location'),s('Asset Code'),s('Priority'),s('Remarks')].filter(Boolean).join(' · ');break;
 case 'goods-receipts':module='receipts';reference=s('Receive Goods');title=reference+' · '+s('PO Number');status='Received';owner=s('RECEIVED BY');details=s('RECEIVED DATE');break;
 case 'budgets':module='budgets';reference=s('Budget Code');title=s('Budget Name');status=s('Budget Status','Status')||'Not specified';owner=s('Requested By');details=[s('Location'),s('Start Date'),s('End Date'),s('Remark')].filter(Boolean).join(' · ');break;
 default:return null;
 }
 return {id:'source:'+row.id,sourceId:row.id,sourceDataset:row.dataset,sourceName:row.source,reference,module,title:title||reference||'Untitled record',department,status,owner,amount,unit,currency,details,updated:row.imported_at,version:1};
}
export function buildSourceRecords(rows:SourceRow[]):Item[]{const records=rows.map(mapSource).filter((r):r is Item=>!!r);const vendors=new Map<string,Item>();for(const row of rows){if(row.dataset!=='purchase-orders')continue;const p=JSON.parse(row.payload_json);const name=text(p,'Vendor');if(!name||vendors.has(name.toLowerCase()))continue;vendors.set(name.toLowerCase(),{id:'vendor:'+row.id,sourceId:row.id,sourceDataset:'purchase-orders',sourceName:row.source,reference:name,module:'suppliers',title:name,department:'Procurement',status:'Referenced in orders',owner:'',amount:0,details:'Supplier name from purchase orders. Open the source order for purchasing details.',updated:row.imported_at,version:1})}return [...records,...vendors.values()]}
