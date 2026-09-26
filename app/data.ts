export type Item={id:string,module:string,title:string,department:string,status:string,owner:string,amount:number,details:string,updated:string,version:number,createdBy?:string,fileKey?:string,sourceId?:string,sourceDataset?:string,sourceName?:string,reference?:string,unit?:string,currency?:string};

// Generic register modules kept from the original workspace (stored in `records`).
export const statuses:Record<string,string[]>={inventory:['In stock','Low stock','Out of stock'],budgets:['Draft','Active','Closed'],receipts:['Received','Partially received','Returned'],locations:['Active','Inactive'],documents:['Draft','Published','Archived']};
export const descriptions:Record<string,string>={inventory:'Stock levels across stores and warehouses.',receipts:'Goods received against purchase orders.',budgets:'Imported budgets and their source details.',locations:'Company sites, units and stores.'};

export const assetStatuses=['In use','In store','Maintenance','Retired','Disposed','Lost'] as const;
export const assetConditions=['New','Good','Fair','Poor','Damaged'] as const;
export const assetKinds=['IT','Physical','Vehicle','Furniture','Machinery'] as const;

export const ticketStatuses=['New','Open','In progress','On hold','Resolved','Closed'] as const;
export const ticketPriorities=['Low','Medium','High','Urgent'] as const;
export const ticketTypes=['Incident','Service request','Maintenance','Access request','Question'] as const;
// Target resolution time per priority, in hours.
export const slaHours:Record<string,number>={Urgent:4,High:24,Medium:72,Low:120};

export const prStatuses=['Draft','Pending approval','Approved','Rejected','Converted','Cancelled'] as const;
export const poStatuses=['Draft','Pending approval','Approved','Rejected','Issued','Partially received','Received','Closed','Cancelled'] as const;

export const pageKinds=['page','announcement','policy','procedure','research'] as const;

// Straight-line depreciation by month.
export function bookValue(cost:number,salvage:number,months:number,purchased:string|null,at=Date.now()){if(!months||!purchased)return cost;const age=Math.max(0,(at-Date.parse(purchased))/(30.4375*86400000));return Math.max(salvage,Math.round((cost-(cost-salvage)*Math.min(1,age/months))*100)/100)}
