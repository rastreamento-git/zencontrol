const {fail}=require("./errors");
const UFS=new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
function normalizeBase(value){
 if(!value||typeof value!=="object"||Array.isArray(value))fail(400,"Base operacional inválida.");
 const field=(key,max,required=false)=>{
  const raw=value[key]??"";
  if(typeof raw!=="string"||raw.length>max)fail(400,"Confira o campo "+key+" da base operacional.");
  const s=raw.trim().replace(/\s+/g," ");
  if(required&&!s)fail(400,"Preencha "+key+" da base operacional.");
  return s;
 };
 const cep=field("cep",9,true).replace(/-/g,"");
 const street=field("street",160,true),number=field("number",12,true),district=field("district",100,true),city=field("city",100,true),state=field("state",2,true).toUpperCase();
 if(!/^\d{8}$/.test(cep)||!/^\d+[A-Za-z]?$/.test(number)||!UFS.has(state)||[street,district,city].some(s=>s.includes(",")))fail(400,"Confira CEP, número e UF. Não utilize vírgulas nos campos de endereço.");
 const transport=field("transport",20);
 if(transport&&!["car","moto","other"].includes(transport))fail(400,"Meio de transporte inválido.");
 const radiusRaw=value.radius_km;
 const radius=radiusRaw===undefined||radiusRaw===null||radiusRaw===""?null:Number(radiusRaw);
 if(radius!==null&&(!Number.isFinite(radius)||radius<0||radius>10000))fail(400,"Raio de atendimento inválido.");
 const base={cep,street,number,district,city,state,complement:field("complement",100),transport,radius_km:radius,municipalities:field("municipalities",500)};
 // Numeric house number and city/UF at the end are required by routing-providers.
 return {base,address:[street,number,district,city,state].join(", ")};
}
module.exports={normalizeBase};
