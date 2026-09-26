import {canRead} from '../../server/policy';
import {route,all,projection} from '../../server/core';
import {buildSourceRecords,type SourceRow} from '../../server/source-records';
import type {Item} from '../../data';
// Generic registers (inventory, receipts, budgets, locations) plus read-only snapshots imported from earlier systems.
export const GET=route(async(req,u)=>{
 const module=new URL(req.url).searchParams.get('module')||'';
 const records=await all<Item>(`SELECT ${projection} FROM records WHERE tenant_id=? AND (?='' OR module=?) ORDER BY updated DESC LIMIT 2000`,u.tenantId,module,module);
 const datasets="'staff','locations','assets','it-assets','inventory-balances','purchase-orders','purchase-requisitions','tickets','goods-receipts','budgets'";
 const source=await all<SourceRow>(`SELECT r.id,r.source_key,r.payload_json,b.dataset,b.source,b.imported_at FROM source_rows r JOIN import_batches b ON b.id=r.batch_id WHERE b.tenant_id=? AND b.dataset IN (${datasets}) AND b.id=(SELECT b2.id FROM import_batches b2 WHERE b2.dataset=b.dataset AND b2.tenant_id=b.tenant_id ORDER BY b2.imported_at DESC,b2.id DESC LIMIT 1) ORDER BY b.dataset,r.row_number`,u.tenantId);
 const imported=buildSourceRecords(source).filter(r=>!module||r.module===module);
 return {records:[...records,...imported].filter(r=>canRead(u,r))};
});
