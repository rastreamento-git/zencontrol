// Do not infer tracker ownership from the vehicle plan or a generic tracking service.
export function isTrackerProduct(product) {
  const name=String(product?.name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
  return /\bRASTREADOR(?:ES)?\b/.test(name) && !/\b(?:SEM|RETIRADA|REMOCAO|CANCELAMENTO|DEVOLUCAO|DESINSTALACAO)\b/.test(name);
}
export function productSummary(value) {
  if(value?.state!=="available")return {tracker:null,perfurado:null};
  const trackers=(value.items||[]).filter(isTrackerProduct);
  const tracker=trackers.some(p=>p.active===true)?true:trackers.some(p=>p.active!==false)?null:false;
  return {tracker,perfurado:typeof value.perfurado==="boolean"?value.perfurado:null};
}
export function isPerfuradoProduct(product){
  return product?.kind==="product"&&String(product.code)==="2371";
}
