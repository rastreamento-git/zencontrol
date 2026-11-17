import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, ChevronDown } from "lucide-react";
import { Panel, Loading, Empty, Pager, Badge, format, useLoad } from "./common";
import "./sga-intake.css";

function RunDetails({run}){
  const summary=run.summary||{};
  return <details className="sga-run-details">
    <summary>Diagnóstico <ChevronDown size={13} aria-hidden="true"/></summary>
    {run.message&&<p>{run.message}</p>}
    <p>Responsável: {run.actor||"Sistema"} · Tentativas: {run.attempts??0}</p>
    <p>Encerramento: {run.finished_at?format(run.finished_at,true):"Ainda não encerrada"}</p>
    {!!summary.day_results?.length&&<ul>{summary.day_results.map(day=><li key={day.day}><strong>{format(day.day)}</strong>: {day.state==="failed"?(summary.day_errors?.find(x=>x.day===day.day)?.message||"Falha de consulta"):day.state==="empty"?"Nenhuma movimentação":day.movements+" movimentação(ões)"}</li>)}</ul>}
    {!!summary.errors?.length&&<ul>{summary.errors.map((x,index)=><li key={x.sga_id+"-"+index}><strong>SGA {x.sga_id}</strong>{x.stage?" · "+x.stage:""}: {x.message||"Motivo não registrado"}</li>)}</ul>}
    {!run.message&&!summary.day_results?.length&&!summary.errors?.length&&<p>Nenhum diagnóstico adicional.</p>}
  </details>;
}
export default function SgaCollectionHistory({onOpenQueue,revision=0}){
  const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[origin,setOrigin]=useState(""),[state,setState]=useState("");
  const params=new URLSearchParams({page,limit:25,origin,state});
  const {data,loading,error}=useLoad("/sga-intake/runs?"+params,revision+refresh);
  useEffect(()=>{const timer=setInterval(()=>setRefresh(v=>v+1),15000);return()=>clearInterval(timer)},[]);
  const items=data?.items||[];
  return <Panel className="zc-service-list sga-history-panel">
    <div className="zc-filters">
      <select aria-label="Origem do histórico" value={origin} onChange={e=>{setOrigin(e.target.value);setPage(1);}}><option value="">Todas as origens</option><option value="automatic">Automática</option><option value="manual">Manual</option></select>
      <select aria-label="Situação da coleta" value={state} onChange={e=>{setState(e.target.value);setPage(1);}}><option value="">Todas as situações</option><option value="queued">Na fila</option><option value="running">Em andamento</option><option value="completed">Concluída</option><option value="failed">Falhou</option></select>
      <button type="button" className="secondary-button" onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={15}/> Atualizar</button>
    </div>
    {loading&&!data||error?<Loading error={error}/>:!items.length?<Empty title="Nenhuma coleta encontrada" description="As importações do SGA serão registradas aqui."/>:<>
      <div className="zc-table-scroll"><table className="zc-table zc-responsive-table">
        <thead><tr><th>COLETA / ORIGEM</th><th>PERÍODO</th><th>RECEBIDOS</th><th>DUPLICADOS</th><th>FALHAS</th><th>SITUAÇÃO</th><th>DETALHES</th><th aria-label="Ações"/></tr></thead>
        <tbody>{items.map(run=><tr key={run.id}>
          <td data-label="Coleta / origem"><strong>{format(run.created_at,true)}</strong><small>{run.origin==="automatic"?"Automática":"Manual"}</small></td>
          <td data-label="Período">{format(run.period_start)}<small>até {format(run.period_end)}</small></td>
          <td data-label="Recebidos">{run.summary?.imported??"—"}</td>
          <td data-label="Duplicados">{run.summary?.duplicates??"—"}</td>
          <td data-label="Falhas">{run.summary?.failed??"—"} {!!run.summary?.failed_days&&<small>{run.summary.failed_days} dia(s) com erro</small>}</td>
          <td data-label="Situação"><Badge value={run.state==="queued"?"pending":run.state}/></td>
          <td data-label="Detalhes"><RunDetails run={run}/></td>
          <td data-label="Ação"><button type="button" className="icon-button" title="Abrir lote no Controle de OS" aria-label="Abrir lote no Controle de OS" onClick={()=>onOpenQueue?.(run.id)}><ArrowRight size={16}/></button></td>
        </tr>)}</tbody>
      </table></div>
      {data?.total!==undefined?<Pager data={data} onPage={setPage}/>:<p className="sga-lot-note">Exibindo as coletas recentes. Atualize a API para acessar todo o histórico e os filtros.</p>}
    </>}
  </Panel>;
}
