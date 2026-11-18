const {isDemoOrder}=require("./demo-rj");
const {dataset}=require("../../../scripts/rj-demo-data.cjs");
const {formatAddress}=require("../../../packages/domain/order-fields.mjs");
const {addressParts}=require("./routing-providers");
const data=dataset();
const canonical=value=>{const p=addressParts(value);return p?.text.normalize("NFC").toLocaleLowerCase("pt-BR")||null};
const same=(a,b)=>Boolean(canonical(a)&&canonical(a)===canonical(b));
function demoDestination(cfg,order,destination){
 if(!isDemoOrder(cfg,order))return false;
 const customer=data.customers.find(c=>c.name===order.customer_name&&c.vehicle===order.vehicle);
 return Boolean(customer&&same(formatAddress(customer.address),destination));
}
function demoOrigin(cfg,technician){
 if(cfg?.DEMO_RJ_ISOLATED!==true)return false;
 const entry=data.technicians.find(t=>t.name===technician?.name);
 return Boolean(entry&&same(formatAddress(entry.address),technician.address));
}
module.exports={demoDestination,demoOrigin};
