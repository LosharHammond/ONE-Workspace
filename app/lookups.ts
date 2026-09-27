// Company-managed pick lists used by forms across the workspace (Company settings › Lists).
// Administrators maintain the values once; staff choose from them in every form.
// Departments, locations and vendors have their own managers and are listed here for navigation.
export type LookupList={id:string,label:string,group:string,description:string,parent?:string,defaults:string[],legacySetting?:string};
export const lookupLists:LookupList[]=[
 {id:'ticket-categories',label:'Ticket categories',group:'Help desk',description:'Categories people choose when raising a ticket.',defaults:['Hardware','Software','Network','Email','Access','Facilities','Electrical','Plumbing','Vehicle','Other'],legacySetting:'ticketCategories'},
 {id:'ticket-subcategories',label:'Ticket subcategories',group:'Help desk',description:'Optional detail under each ticket category.',parent:'ticket-categories',defaults:[]},
 {id:'asset-categories',label:'Asset categories',group:'Assets',description:'Used on assets, role asset scopes and reports.',defaults:['Laptop','Desktop','Monitor','Printer','Phone','Network','Server','CCTV','Vehicle','Furniture','Machinery','Tools'],legacySetting:'assetCategories'},
 {id:'asset-subcategories',label:'Asset subcategories',group:'Assets',description:'Optional detail under each asset category.',parent:'asset-categories',defaults:[]},
 {id:'brands',label:'Brands / manufacturers',group:'Assets',description:'Makes of equipment.',defaults:['Dell','HP','Lenovo','Apple','Cisco','Hikvision','Toyota']},
 {id:'inventory-categories',label:'Inventory categories',group:'Inventory',description:'Groups of stock items.',defaults:['Consumables','Spare parts','Packaging','Raw materials','Stationery'],legacySetting:'inventoryCategories'},
 {id:'units',label:'Units of measure',group:'Inventory & purchasing',description:'Units on stock items and purchase lines.',defaults:['ea','box','pack','set','pair','roll','kg','g','l','ml','m','hour']},
 {id:'vendor-categories',label:'Vendor categories',group:'Purchasing',description:'What each vendor supplies.',defaults:['IT equipment','Office supplies','Facilities','Services','Logistics','Raw materials']},
 {id:'cost-centres',label:'Cost centres',group:'Finance',description:'Charged on assets, requisitions and orders. Department cost centres are included automatically.',defaults:[]},
 {id:'job-titles',label:'Job titles',group:'People',description:'Titles on people’s profiles.',defaults:['Manager','Officer','Assistant','Technician','Analyst','Coordinator','Supervisor','Director']},
];
export const lookupListById=new Map(lookupLists.map(l=>[l.id,l]));
export type LookupValue={id:string,value:string,parent:string,description:string,sort:number,active:number};
