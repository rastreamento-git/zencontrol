import { useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { api, errorMessage, Intro, Panel, Loading, Empty, Pager, useLoad } from "./common";
import { notify } from "@zen/ui/lib/feedback";

export default function Regionals({revision,refresh}){
 const [q,setQ]=useState(""),[page,setPage]=useState(1),[status,setStatus]=useState("");
 const [syncing,setSyncing]=useState(false),[result,setResult]=useState(null),[syncError,setSyncError]=useState("");
 const {data,loading,error}=useLoad("/regionals?"+new URLSearchParams({q,page,status,limit:25}),revision);
 function filter(value){setStatus(value);setPage(1);}
 async function sync(){
  setSyncing(true);setResult(null);setSyncError("");
  try{
   const {data:summary}=await api.post("/regionals/sga/sync",{},{timeout:200000});
   if(!summary||typeof summary.received!=="number")throw new Error("Resposta inesperada da API de regionais.");
   setResult(summary);setPage(1);setStatus("");setQ("");refresh();notify("Regionais sincronizadas.");
  }catch(e){setSyncError(e.response||e.code?errorMessage(e):e.message||errorMessage(e));}
  finally{setSyncing(false);}
 }
 return <>
  <Intro title="Regionais" subtitle="Catálogo oficial de regionais do SGA. Consulte as unidades ativas e inativas.">
   <button type="button" className="primary-button" disabled={syncing} onClick={sync}><RefreshCw size={16}/>{syncing?"Sincronizando…":"Sincronizar com SGA"}</button>
  </Intro>
  {syncing&&<p role="status" className="tf-note">Consultando o SGA e verificando as situações disponíveis. A listagem atual permanece disponível.</p>}
  {syncError&&<p role="alert" className="error-banner">{syncError} O catálogo anterior foi preservado.</p>}
  {result&&<div role="status" className="dashboard-panel tf-preview-summary"><strong>Consulta concluída</strong><p>{result.received} recebidas · {result.created} novas · {result.updated} atualizadas · {result.unchanged} sem alterações · {result.skipped} inconsistências ignoradas · {result.duplicates} repetições de código.</p></div>}
  {data?.stats&&<>
   <div className="tf-task-metrics">{[["Total",data.stats.total,""],["Ativas",data.stats.active,"ATIVO"],["Inativas",data.stats.inactive,"INATIVO"],["Não confirmadas",data.stats.unknown,"UNKNOWN"]].map(([label,count,key])=><button type="button" key={key} className="dashboard-panel tf-metric tf-task" aria-pressed={status===key} onClick={()=>filter(key)}><small>{label}</small><strong>{count}</strong></button>)}</div>
   <small className="zc-muted">Último registro sincronizado: {data.stats.last_sync?new Date(data.stats.last_sync).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}):"Nenhuma sincronização registrada"}</small>
  </>}
  <Panel>
   <div className="zc-filters">
    <div className="trace-search"><Search size={17}/><input aria-label="Buscar regionais" placeholder="Buscar nome ou código SGA…" value={q} onChange={e=>{setQ(e.target.value);setPage(1)}}/></div>
    <select aria-label="Situação da regional" value={status} onChange={e=>filter(e.target.value)}><option value="">Todas</option><option value="ATIVO">Ativas</option><option value="INATIVO">Inativas</option><option value="UNKNOWN">Não confirmadas</option></select>
   </div>
   {loading||error?<Loading error={error}/>:<>
    <div className="zc-table-scroll"><table className="zc-table zc-responsive-table"><thead><tr><th>REGIONAL</th><th>CÓDIGO SGA</th><th>SITUAÇÃO</th><th>ORIGEM</th></tr></thead><tbody>{data.items.map(row=><tr key={row.sga_code}><td data-label="Regional"><strong>{row.name}</strong></td><td data-label="Código SGA">{row.sga_code}</td><td data-label="Situação"><span className={"zc-badge "+(row.sga_status==="ATIVO"?"mint":"gray")}>{row.sga_status==="ATIVO"?"Ativa":row.sga_status==="INATIVO"?"Inativa":"Não confirmada"}</span></td><td data-label="Origem">SGA</td></tr>)}</tbody></table></div>
    {!data.items.length&&<Empty/>}
    <Pager data={data} onPage={setPage}/>
   </>}
  </Panel>
 </>;
}
