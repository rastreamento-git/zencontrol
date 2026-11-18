import {useEffect,useRef,useState} from "react";
import {Route,RefreshCw,ArrowRight} from "lucide-react";
import {api,errorMessage} from "./common";
import "./technician-recommendations.css";
const km=m=>(m/1000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" km";
const duration=s=>{const m=Math.ceil(s/60);return m>=60?Math.floor(m/60)+"h "+m%60+"min":m+" min"};
const stockLabels={sufficient:"Estoque suficiente",insufficient:"Estoque insuficiente",unknown:"Estoque não confirmado",not_required:"Sem consumo de estoque"};
const providerNames={ors:"OpenRouteService",mapbox:"Mapbox",google:"Google Maps"};
const routeReasons={quota_cooldown:"Google em pausa após limite de consultas",geocode_unconfirmed:"Endereço não localizado com precisão",address_format:"Formato do endereço incompleto",quota:"Limite de consultas atingido",authorization:"API recusou a autorização",invalid_request:"Parâmetros da rota recusados",provider_temporarily_unavailable:"Provedor temporariamente indisponível",provider_error:"Provedor respondeu com erro",timeout:"Tempo limite da consulta atingido",network_or_response:"Falha de conexão ou resposta da API",no_driving_route:"Provedor não encontrou trajeto de automóvel",invalid_route_metrics:"Provedor não retornou distância e duração válidas"};
const routeLabels={not_configured:"Rotas não configuradas",missing_origin:"Ponto de partida não cadastrado",address_review:"Confira os endereços",unavailable:"Rota não confirmada",not_checked:"Rota não consultada"};
export default function TechnicianRecommendations({address,required,orderId="",enabled=true,disabled=false,onSelect}){
 const [result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[showAll,setShowAll]=useState(false);
 const input={address,required,order_id:orderId},signature=JSON.stringify(input),latest=useRef(signature),request=useRef(null);
 latest.current=signature;
 useEffect(()=>{request.current?.abort();setResult(null);setError("");setLoading(false);setShowAll(false);return()=>request.current?.abort()},[signature,enabled]);
 if(!enabled)return null;
 const valid=address?.street&&address?.number&&address?.city&&address?.state&&required&&Object.values(required).every(Number.isSafeInteger);
 async function run(){request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError("");setResult(null);
 try{const {data}=await api.post("/technician-recommendations",input,{timeout:180000,signal:controller.signal});if(!controller.signal.aborted&&latest.current===signature)setResult(data);}
 catch(e){if(!controller.signal.aborted)setError(e.response?.status===404?"Atualize o backend de homologação para habilitar recomendações.":errorMessage(e));}
 finally{if(!controller.signal.aborted)setLoading(false)}}
 const candidates=result?.items||[],recommended=candidates.filter(c=>c.recommended);
 const nearest=candidates.find(c=>c.nearest_geographic);
 const shortlist=recommended.length?recommended.slice(0,3):candidates.slice(0,3);
 const visible=showAll?candidates:nearest&&!shortlist.some(c=>c.id===nearest.id)?[...shortlist,nearest]:shortlist;
 const equipmentLabels={RASTREADOR:"rastreador(es)",TAG:"TAG(s)",PERFURADO:"perfurado(s)"};
 return <section className="zc-full zc-recommendations" aria-label="Recomendação de técnicos">
  <div className="zc-recommendation-heading"><div><strong><Route size={17}/> Recomendar técnico</strong><small>Estoque disponível e menor distância de automóvel da base cadastrada até o atendimento.</small></div><button type="button" className="secondary-button" disabled={!valid||disabled||loading} onClick={run}><RefreshCw size={15}/>{loading?"Consultando…":result?"Atualizar sugestões":"Buscar sugestões"}</button></div>
  {!valid&&<small>Complete o endereço e confirme os equipamentos necessários antes de consultar.</small>}
  {loading&&<p role="status">Consultando a carga dos técnicos e calculando os trajetos…</p>}
  {error&&<p role="alert" className="form-error">{error}</p>}
  {result&&<>{!result.routing_configured&&<p className="zc-recommendation-note">Consulta de rotas não habilitada. Somente o estoque foi verificado; nenhum técnico será classificado por proximidade.</p>}
  <small>Necessário: {required.RASTREADOR} rastreador(es) · {required.TAG} TAG(s) · {required.PERFURADO} perfurado(s). Ordenação por menor distância de ida; tempo usado no desempate. Sem trânsito em tempo real. A distância também é consultada para técnicos com estoque insuficiente, sem recomendá-los para execução. A consulta não reserva equipamentos nem confirma agenda.</small>
  {!recommended.length&&<p className="zc-recommendation-note">Nenhum técnico com estoque e deslocamento confirmados. A atribuição manual continua disponível.</p>}
  <div className="zc-table-scroll"><table className="zc-table zc-responsive-table"><thead><tr><th>TÉCNICO</th><th>ESTOQUE LIVRE ESTIMADO</th><th>TRAJETO DE IDA</th><th>AÇÕES</th></tr></thead><tbody>{visible.map((item,i)=><tr key={item.id}><td data-label="Técnico"><strong>{item.name}</strong>{item.recommended&&i===0&&<small>Mais próximo apto por estoque</small>}{item.nearest_geographic&&!item.recommended&&<small>Mais próximo geograficamente · não recomendado por estoque</small>}</td><td data-label="Estoque"><strong>{stockLabels[item.stock_state]}</strong>{item.stock&&<small>{item.stock.free.RASTREADOR} rastreador(es) · {item.stock.free.TAG} TAG(s) · {item.stock.free.PERFURADO??"?"} perfurado(s)</small>}{item.stock_note&&<small>{item.stock_note}</small>}{item.shortages?.map(s=><small key={s.equipment}>Faltam {s.missing} {equipmentLabels[s.equipment]}</small>)}</td><td data-label="Trajeto">{item.route.state==="confirmed"?<><strong>{km(item.route.distance_meters)}</strong><small>{duration(item.route.duration_seconds)}{item.route.provider?" · "+providerNames[item.route.provider]:""}</small>{item.route.basis==="same_confirmed_point"&&<small>Mesmo ponto confirmado</small>}{Object.values(item.route.location_accuracy||{}).includes("interpolated")&&<small>Localização estimada por número de rua · conferir</small>}{item.travel_estimate?.amount_cents!==null&&item.travel_estimate?.amount_cents!==undefined?<small>Extra estimado: {(item.travel_estimate.amount_cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}</small>:<small>Extra a conferir</small>}</>:<small>{item.route.state==="address_review"&&item.route.address_issue?(item.route.address_issue.origin&&item.route.address_issue.destination?"Confira origem e destino":item.route.address_issue.origin?"Confira a base do técnico":"Confira o endereço da instalação"):(routeReasons[item.route.reason]||routeLabels[item.route.state]||"Não confirmado")}{item.route.http_status?" · HTTP "+item.route.http_status:""}{item.route.attempts?.length?item.route.attempts.map(a=>" · "+(providerNames[a.provider]||a.provider)+": "+(a.state==="confirmed"?"rota confirmada":a.state==="address_review"?"endereço não confirmado":routeReasons[a.reason]||"rota não confirmada")).join(""):""}</small>}</td><td data-label="Ação"><button type="button" className={item.recommended?"primary-button":"secondary-button"} disabled={disabled} onClick={()=>onSelect(item.id)}>{item.recommended?"Selecionar":"Escolher manualmente"}<ArrowRight size={14}/></button></td></tr>)}</tbody></table></div>
  {(showAll||candidates.length>visible.length)&&<button type="button" className="secondary-button" onClick={()=>setShowAll(v=>!v)}>{showAll?"Ver resumo":"Ver todos os técnicos ("+candidates.length+")"}</button>}
  {candidates.some(c=>c.route.provider==="ors"&&c.route.state==="confirmed")&&<small>© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors</small>}
  {candidates.some(c=>c.route.provider==="mapbox"&&c.route.state==="confirmed")&&<small>© Mapbox © OpenStreetMap</small>}
  <small>Consultado em {new Date(result.checked_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}. Confira disponibilidade e endereço antes de salvar.</small></>}
 </section>
}
