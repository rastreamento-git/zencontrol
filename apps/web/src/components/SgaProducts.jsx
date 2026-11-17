import { ChevronDown, MapPin, Tag } from "lucide-react";
import { productSummary, isTrackerProduct, isPerfuradoProduct } from "@zen/domain/sga-product-summary.mjs";
import "./sga-intake.css";
const statusText=value=>value===true?"Ativo":value===false?"Não encontrado ativo":"Não confirmado";
export default function SgaProducts({value}) {
  const {tracker,perfurado}=productSummary(value);
  const items=value?.state==="available" ? value.items||[] : [];
  return (
    <section className="sga-products-panel" aria-label="Produtos do associado neste veículo">
      <h3>Produtos vinculados ao veículo</h3>
      <div className="sga-product-highlights">
        {[["Rastreador",tracker,MapPin],["Perfurado",perfurado,Tag]].map(([name,state,Icon])=>(
          <div key={name} className="sga-product-highlight" data-state={state===true?"active":state===false?"inactive":"unknown"}>
            <Icon size={19} aria-hidden="true"/>
            <div><strong>{name}</strong><small>{statusText(state)}{name==="Perfurado"?" · 2371":""}</small></div>
          </div>
        ))}
      </div>
      <details className="sga-products-details">
        <summary>Ver todos os produtos ({items.length}) <ChevronDown size={16} aria-hidden="true"/></summary>
        {value?.state!=="available"?<p role="status">Produtos ainda não confirmados. Consulte ou sincronize o cadastro SGA.</p>:!items.length?<p>Nenhum produto vinculado retornado pelo SGA.</p>:(
          <ul className="sga-products-list">
            {items.map((product,index)=>(
              <li key={product.kind+"-"+product.code+"-"+index} className={isTrackerProduct(product)||isPerfuradoProduct(product)?"sga-product-priority":""}>
                <div><strong>{product.name}</strong><small>Código {product.code}{product.kind==="additional"?" · Produto adicional":""}</small></div>
                <span className="sga-product-state" data-active={product.active===true?"yes":product.active===false?"no":"unknown"}>{product.status||"Não confirmado"}</span>
              </li>
            ))}
          </ul>
        )}
        {value?.checked_at&&<small>Consultado em {new Date(value.checked_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}.</small>}
      </details>
    </section>
  );
}
