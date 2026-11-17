import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, AlertCircle, Download, Settings2, Trash2, RefreshCw, CalendarDays, Search, ChevronDown } from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { api, errorMessage, format, Empty, Loading, Pager, Badge } from "./common";
import { notify } from "@zen/ui/lib/feedback";
import SgaProducts from "./SgaProducts";
import { classifyFipe, fipeRegions, fipeCents, canonicalVehicleType, fipeCategories } from "@zen/domain/fipe.mjs";
import { brazilStates, addressFields } from "@zen/domain/order-fields.mjs";
import "./sga-intake.css";
function ImportProgress({ run }) {
  const summary = run.summary || {};
  const records = summary.phase === "records";
  const movements = summary.phase === "movements";
  const total = records ? Number(summary.matching) : movements ? Number(summary.total_days) : 0;
  const done = records ? Number(summary.processed || 0) : Number(summary.processed_days || 0);
  const determinate = run.state === "running" && total > 0;
  const percent = determinate ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
  const stage = run.state === "queued" ? "Aguardando início…" : records ? "Importando cadastros…" : movements ? "Consultando movimentações…" : "Preparando consulta…";
  return (
    <div className="sga-progress" role="status" aria-live="polite">
      <div className="sga-progress-heading"><strong>{stage}</strong><small>{determinate ? `${done} de ${total} ${records ? "cadastros" : "dias"}` : ""}</small></div>
      <div className={"sga-progress-track" + (determinate && percent === 0 ? " is-starting" : "")} role="progressbar" aria-label={stage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={determinate ? percent : undefined}>
        <div className={determinate ? "sga-progress-fill" : "sga-progress-fill is-indeterminate"} style={determinate ? {width: percent + "%"} : undefined} />
      </div>
    </div>
  );
}
export default function SgaIntake({
  settings = false,
  revision,
  openOrder,
  refresh,
  initialRunId = "",
  globalQuery = "",
  onOpenQueue,
}) {
  const [config, setConfig] = useState({enabled:false,daily_time:"18:00",pending_kind:"classifications",pending_code:""}),
    [choices, setChoices] = useState([]),
    [runs, setRuns] = useState([]);
  const [queue, setQueue] = useState({ items: [], total: 0 }),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(globalQuery || ""),
    [origin, setOrigin] = useState(settings ? "manual" : ""),
    [runId, setRunId] = useState(initialRunId);
  const [marked, setMarked] = useState([]);
  const [searchTerm,setSearchTerm]=useState(globalQuery||"");
  useEffect(()=>{if(!settings){setQuery(globalQuery||"");setPage(1);}},[globalQuery,settings]);
  useEffect(()=>{const timer=setTimeout(()=>setSearchTerm(query),250);return()=>clearTimeout(timer)},[query]);
  const [clearReason, setClearReason] = useState("reimport");
  const [clearDialog, setClearDialog] = useState(false);
  const [selected, setSelected] = useState(null),
    [techs, setTechs] = useState([]),
    [assignment, setAssignment] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [configured, setConfigured] = useState(false);
  const [configState,setConfigState]=useState("loading"), [catalogState,setCatalogState]=useState("loading");
  const [configError,setConfigError]=useState(""), [catalogError,setCatalogError]=useState(""), [historyError,setHistoryError]=useState("");
  const [configRetry,setConfigRetry]=useState(0), [catalogRetry,setCatalogRetry]=useState(0);
  const [savedConfig,setSavedConfig]=useState(null);
  const [confirmed, setConfirmed] = useState(false),
    [showSettings, setShowSettings] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [start, setStart] = useState(today), [end, setEnd] = useState(today), [complementary, setComplementary] = useState(true);
  const activeRuns = runs.filter(r => ["running","queued"].includes(r.state));
  const collecting = activeRuns.length > 0;
  const latest = runs[0];
  const loadData = async () => {
    const history = api.get("/sga-intake/runs");
    const entries = settings ? Promise.resolve(null) : api.get("/sga-intake/entries", { params: { page, q: searchTerm, origin, run_id: runId } });
    const [h,e]=await Promise.allSettled([history,entries]);
    return {history:h.status==="fulfilled"?h.value.data.items:null,entries:e.status==="fulfilled"?e.value?.data:null,historyError:h.status==="rejected"?errorMessage(h.reason):"",entryError:e.status==="rejected"?errorMessage(e.reason):""};
  };
  const reload = async () => {
    const result = await loadData();
    if (result.entries) setQueue(result.entries);
    if(result.history) setRuns(result.history);
    setHistoryError(result.historyError || result.entryError);
  };
  useEffect(() => {
    let active = true,
      timer;
    async function poll() {
      try {
        const result = await loadData();
        if (active) {
          if (result.entries) setQueue(result.entries);
          if(result.history) setRuns(result.history);
          setHistoryError(result.historyError || result.entryError);
          setLoading(false);
        }
      } catch (e) {
        if (active) {
          setHistoryError(errorMessage(e));
          setLoading(false);
        }
      }
      if (active) timer = setTimeout(poll, settings ? 2000 : 10000);
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, searchTerm, revision, origin, runId, settings]);
  useEffect(() => { setMarked([]); }, [page, query, origin, runId]);
  // Config and remote catalogs have independent lifecycles. A slow SGA must not
  // hide local configuration or the manual import controls.
  useEffect(()=>{
    if(!settings)return;
    let active=true;
    setConfigState("loading");setConfigError("");
    api.get("/sga-intake/config",{timeout:20000}).then(({data})=>{
      if(!active)return;
      if(!data?.config || typeof data.config.version!=="number")throw new Error("Resposta de configuração inválida. Confira a versão da API.");
      setConfig(data.config);setSavedConfig(data.config);setConfigured(data.configured===true);setConfigState("ready");
      setShowSettings(v=>v||!data.config.pending_code);
    }).catch(e=>{if(active){setConfigState("error");setConfigError(errorMessage(e));setConfigured(false);}});
    return()=>{active=false};
  },[settings,configRetry]);
  useEffect(()=>{
    if(!settings)return;
    let active=true;
    setCatalogState("loading");setCatalogError("");
    api.get("/sga-intake/catalogs",{timeout:90000}).then(({data})=>{
      if(!active)return;
      if(!Array.isArray(data?.items))throw new Error("Resposta de catálogo inválida.");
      setChoices(data.items);setCatalogState("ready");
      if(Object.keys(data.errors||{}).length)setCatalogError("Parte do catálogo SGA não respondeu. Confira a conexão ou atualize o catálogo.");
    }).catch(e=>{if(active){setCatalogState("error");setCatalogError(errorMessage(e));}});
    return()=>{active=false};
  },[settings,catalogRetry]);
  const configReady=configState==="ready" && !!savedConfig;
  const configDirty=configReady && ["enabled","daily_time","pending_kind","pending_code"].some(k=>config[k]!==savedConfig[k]);
  const validPeriod=!!start&&!!end&&start<=end&&end<=today&&Date.parse(end)-Date.parse(start)<=30*86400000;
  const canCollect=configReady&&configured&&!!savedConfig.pending_code&&!configDirty&&!loading&&!historyError&&!collecting&&!busy&&validPeriod&&confirmed;
  const savedOption=config.pending_code?config.pending_kind+":"+config.pending_code:"";
  const importBlocker=!configReady?"Aguardando configuração da API.":!configured?"Integração SGA indisponível. Confira a configuração do servidor.":configDirty?"Salve a configuração antes de iniciar a coleta.":!savedConfig.pending_code?"Configure a etapa Instalação pendente antes de importar.":historyError?"Não foi possível confirmar a fila de coletas. Atualize a conexão.":!validPeriod?"Selecione um período válido de até 31 dias.":"";
  async function action(task) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function select(entry) {
    await action(async () => {
      const [{ data }, { data: technicians }] = await Promise.all([
        api.get("/sga-intake/entries/" + entry.id),
        api.get("/technicians"),
      ]);
      setSelected(data);
      setTechs(technicians.items.filter((t) => t.active));
      setAssignment({
        technician_id: "",
        scheduled_at: "",
        electric: "",
        customer_choice: "",
        fipe_value:"",vehicle_type:canonicalVehicleType(data.data.document_data?.vehicle_type),fipe_region:data.data.document_data?.fipe_region||"",fipe_override:data.data.document_data?.fipe_override||"",sga_classification:data.data.sga_classification||"",sga_status:data.data.sga_status||"",contact:"",volunteer:"",document_data:{},
        sticker_discount_opt_in:data.data.sticker_discount_opt_in??(data.data.sga_products?.perfurado===true),
      });
    });
  }
  const pageIds = queue.items.map(entry => entry.id);
  const selectedIds = marked.filter(id => pageIds.includes(id));
  const allMarked = pageIds.length > 0 && pageIds.every(id => marked.includes(id));
  const incomplete = entry => !entry.data.contact || !entry.data.document_data?.model || !entry.data.document_data?.customer_street || !entry.data.document_data?.customer_city || !entry.data.document_data?.customer_state || !entry.data.fipe_risk || entry.data.sga_products?.perfurado == null;
  const toggleMarked = id => setMarked(old => old.includes(id) ? old.filter(x => x !== id) : [...old,id]);
  async function clearMarked() {
    const ids = selectedIds.slice();
    if (!ids.length) return;
    await action(async () => {
      let data;
      try {
        ({data} = await api.post("/sga-intake/entries/clear", {ids,reason:clearReason,confirmed:true}));
      } catch (e) {
        if (e.response?.status === 404) throw new Error("A rota de limpeza não está disponível na API atual. Confira a versão do backend de homologação e atualize junto com o frontend. Nenhuma nova tentativa automática foi feita.");
        throw e;
      }
      setMarked([]);
      setClearDialog(false);
      setSelected(null);
      if (page > 1 && queue.items.length === data.removed) setPage(page-1);
      else await reload();
      refresh?.();
      notify(data.removed+" cadastro(s) retirado(s) da fila. Nenhuma OS ou dado do SGA foi alterado.");
    });
  }
  const doc = selected?.data.document_data || {};
  const savedFipe = fipeCents(selected?.data.fipe_value) ? selected.data.fipe_value : "";
  const savedType = canonicalVehicleType(doc.vehicle_type);
  const draftUF = doc.customer_state || assignment.document_data?.customer_state;
  const region = assignment.fipe_region || doc.fipe_region || (draftUF ? (["SP","RJ"].includes(draftUF) ? draftUF : "GERAL") : "");
  const fipe = classifyFipe({ value: savedFipe || assignment.fipe_value, vehicleType: assignment.vehicle_type || savedType, region });
  const effectiveFipe=assignment.fipe_override||fipe.label;
  const field = (label, key, document = false) => {
    const stored = document ? doc[key] : selected?.data[key];
    const value = stored || (document ? assignment.document_data?.[key] : assignment[key]) || "";
    return <label key={key}>{label}{key === "customer_state" ? <select disabled={!!stored || busy} value={value} onChange={e => setAssignment(a => ({...a,document_data:{...a.document_data,[key]:e.target.value}}))}><option value="">Selecione a UF</option>{brazilStates.map(uf => <option key={uf}>{uf}</option>)}</select> : <input readOnly={!!stored} disabled={busy} value={value} placeholder="Não informado" onChange={e => setAssignment(a => document ? {...a,document_data:{...a.document_data,[key]:e.target.value}} : {...a,[key]:e.target.value})}/>}</label>;
  };
  return (
    <section className={settings ? "sga-intake sga-import-view" : "dashboard-panel zc-service-list sga-queue-panel"} aria-label="Instalações pendentes do SGA">
      {settings && <div className="sga-intake-heading">
        <div><h2>Instalações pendentes do SGA</h2><p className="sga-intake-subtitle">Importação automática ou por período.</p></div>
        <button className="secondary-button" onClick={() => onOpenQueue?.()}><ArrowRight size={16}/> Abrir Controle de OS</button>
      </div>}

      {settings && configState !== "ready" && (
        <div className="sga-connection-status" role={configState==="error"?"alert":"status"}>
          <div><strong>{configState==="loading"?"Carregando configuração da integração…":"Não foi possível carregar a configuração SGA"}</strong><small>{configError||"Os controles permanecem visíveis. Aguarde a confirmação do servidor."}</small></div>
          {configState==="error"&&<button type="button" className="secondary-button" onClick={()=>setConfigRetry(v=>v+1)}><RefreshCw size={15}/> Tentar novamente</button>}
        </div>
      )}
      {settings && (
        <div className="sga-import-layout">
        <details
          className="sga-config-details"
          open={showSettings}
          onToggle={(e) => setShowSettings(e.currentTarget.open)}
        >
          <summary>
            <Settings2 size={19} aria-hidden="true"/><span>Coleta automática<small>{!configReady?"Aguardando conexão":savedConfig.enabled?savedConfig.daily_time+" · Brasília":"Desativada"}</small></span><ChevronDown size={16} className="sga-disclosure-icon" aria-hidden="true"/>
          </summary>
          <form
            className="sga-intake-settings"
            onSubmit={(e) => {
              e.preventDefault();
              if(!configReady)return;
              action(async () => {
                const { data } = await api.put("/sga-intake/config", config);
                setConfig(data);
                setSavedConfig(data);
                setShowSettings(false);
                notify("Configuração da coleta SGA salva.");
              });
            }}
          >
            <fieldset disabled={!configReady || busy} className="sga-config-fields">
            <label>
              Etapa no catálogo atual do SGA
              <select
                required
                value={
                  config.pending_code
                    ? config.pending_kind + ":" + config.pending_code
                    : ""
                }
                disabled={busy || !configReady || catalogState==="loading" || (config.enabled && !configured)}
                onChange={(e) => {
                  const [kind, code] = e.target.value.split(":");
                  setConfig({
                    ...config,
                    pending_kind: kind,
                    pending_code: code,
                  });
                }}
              >
                <option value="">Selecione Instalação pendente</option>
                {savedOption&&!choices.some(c=>c.kind+":"+c.code===savedOption)&&<option value={savedOption}>Etapa salva · código {config.pending_code}</option>}
                {choices.map((c) => (
                  <option
                    key={c.kind + ":" + c.code}
                    value={c.kind + ":" + c.code}
                  >
                    {c.label} · {c.code} ·{" "}
                    {c.kind === "classifications"
                      ? "Classificação"
                      : "Situação"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Horário diário (Brasília)
              <input
                required
                type="time"
                value={config.daily_time}
                onChange={(e) =>
                  setConfig({ ...config, daily_time: e.target.value })
                }
                disabled={busy}
              />
            </label>
            <label className="sga-intake-check">
              <input
                type="checkbox"
                checked={config.enabled}
                disabled={busy || (!configured && !config.enabled)}
                onChange={(e) =>
                  setConfig({ ...config, enabled: e.target.checked })
                }
              />
              Ativar coleta automática diária
            </label>
            <small>A coleta depende do servidor ativo no horário configurado.</small>
            </fieldset>
            <div className="sga-catalog-status">
              <small role="status">{catalogState==="loading"?"Consultando catálogo SGA…":catalogError||(!choices.length?"Nenhuma etapa de instalação pendente encontrada no catálogo.":"Catálogo disponível.")}</small>
              <button type="button" className="secondary-button" disabled={busy||catalogState==="loading"} onClick={()=>setCatalogRetry(v=>v+1)}><RefreshCw size={14}/> Atualizar catálogo</button>
            </div>
            <button
              className="primary-button"
              disabled={busy || !configReady || !configDirty || (config.enabled && !configured)}
            >
              Salvar configuração
            </button>
          </form>
        </details>
        <div className="sga-intake-manual">
          <div className="sga-section-heading"><CalendarDays size={20} aria-hidden="true"/><div><h3>Importação manual</h3><small>Selecione o intervalo de movimentações.</small></div></div>
          <div className="zc-form-grid">
            <label>Data inicial<input type="date" required value={start} max={end || today} disabled={busy || collecting} onChange={e => { setStart(e.target.value); setConfirmed(false); }} /></label>
            <label>Data final<input type="date" required value={end} min={start} max={today} disabled={busy || collecting} onChange={e => { setEnd(e.target.value); setConfirmed(false); }} /></label>
          </div>
          <div className="sga-period-actions"><button type="button" className="secondary-button" disabled={busy||collecting} onClick={()=>{setStart(today);setEnd(today);setConfirmed(false);}}>Hoje</button><button type="button" className="secondary-button" disabled={busy||collecting} onClick={()=>{setStart(today.slice(0,7)+"-01");setEnd(today);setConfirmed(false);}}>Mês atual</button></div>
          <small>Até 31 dias por coleta. Cadastros existentes serão ignorados.</small>
          <label className="sga-intake-check"><input type="checkbox" checked={complementary} disabled={busy || collecting} onChange={e => setComplementary(e.target.checked)} /> Consultar também situação financeira e cadastral durante a coleta (mais lento; obrigatória ao agendar).</label>
          <label className="sga-intake-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy || collecting}
            />
            Confirmo a coleta do período selecionado.
          </label>
          <button
            className="primary-button"
            disabled={!canCollect}
            onClick={() =>
              action(async () => {
                const { data: task } = await api.post("/sga-intake/runs", { confirmed: true, start, end, complementary });
                setConfirmed(false);
                setRuns(previous => [{ ...task, state: task.state || "queued" }, ...previous.filter(r => r.id !== task.id)]);
                await reload();
                notify("Coleta SGA iniciada. Você pode continuar trabalhando.");
              })
            }
          >
            <Download size={16} aria-hidden="true"/>{busy ? "Processando…" : collecting ? "Importação em andamento" : "Buscar pendências do período"}
          </button>
          {importBlocker && <small className="sga-blocker" role="status">{importBlocker}</small>}
        </div>
        </div>
      )}
      {historyError && <div className="error-banner" role="alert">{historyError} <button type="button" className="secondary-button" disabled={busy} onClick={()=>action(reload)}><RefreshCw size={14}/> Atualizar</button></div>}
      {settings && activeRuns.map(run => <ImportProgress key={run.id} run={run}/>)}
      {settings && !collecting && latest && (
        <div className="sga-import-result" role="status">
          {latest.state === "completed" ? <CheckCircle2 size={18} aria-hidden="true"/> : <AlertCircle size={18} aria-hidden="true"/>}
          <span>{latest.state === "completed" ? "Importação concluída." : "Coleta requer atenção."}</span>
          <button type="button" className="secondary-button" onClick={() => onOpenQueue?.(latest.id)}>Abrir lote no Controle de OS <ArrowRight size={15}/></button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!settings && (
        <>
          <div className="zc-filters sga-compact-filters">
            <div className="trace-search"><Search size={17} aria-hidden="true"/>
              <input type="search" aria-label="Buscar cadastro recebido" placeholder="Buscar associado, placa ou código SGA…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
            </div>
            <select aria-label="Origem da coleta" value={origin} onChange={e=>{setOrigin(e.target.value);setRunId("");setPage(1);}}>
              <option value="">Todas as origens</option><option value="automatic">Automática diária</option><option value="manual">Manual por período</option>
            </select>
            <select aria-label="Lote de coleta" value={runId} onChange={e=>{setRunId(e.target.value);setPage(1);}}>
              <option value="">Todos os lotes</option>
              {runId&&!runs.some(r=>r.id===runId)&&<option value={runId}>Lote selecionado</option>}
              {runs.filter(r=>!origin||r.origin===origin||r.id===runId).map(r=><option key={r.id} value={r.id}>{r.period_start} a {r.period_end} · {format(r.created_at,true)}</option>)}
            </select>
            {(origin||runId||query)&&<button type="button" className="secondary-button" onClick={()=>{setOrigin("");setRunId("");setQuery("");setPage(1);}}>Limpar filtros</button>}
          </div>
          <div className="sga-compact-toolbar">
            <span aria-live="polite">{loading?"Carregando…":queue.total+" pendência(s)"}{selectedIds.length?" · "+selectedIds.length+" selecionado(s)":""}</span>
            {queue.items.length>0&&<>
              <button type="button" className="secondary-button" disabled={busy||loading||!!historyError||!queue.items.some(incomplete)} onClick={()=>setMarked(queue.items.filter(incomplete).map(e=>e.id))}>Selecionar incompletos</button>
              {selectedIds.length>0&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>setMarked([])}>Desmarcar</button>}
              <button type="button" className="secondary-button sga-bulk-remove" disabled={busy||loading||!!historyError||collecting||!selectedIds.length} onClick={()=>{setClearReason("reimport");setClearDialog(true);}}><Trash2 size={15}/> Limpar selecionados</button>
            </>}
            {collecting&&<small>Limpeza disponível após a coleta.</small>}
          </div>
          {runId&&<p className="sga-lot-note"><small>Exibindo pendências deste lote. Cadastros duplicados permanecem no lote original.</small></p>}
          {loading ? <Loading/> : !queue.items.length ? (
            <Empty title="Nenhuma instalação pendente recebida nesta lista." description="Novos cadastros da importação aparecerão aqui."/>
          ) : (
            <div className="zc-table-scroll">
              <table className="zc-table zc-responsive-table">
                <thead>
                  <tr>
                    <th className="sga-select-cell" scope="col"><input type="checkbox" aria-label="Selecionar página" checked={allMarked} disabled={busy||loading||!!historyError} onChange={e=>setMarked(e.target.checked?pageIds:[])}/></th>
                    <th>ASSOCIADO</th>
                    <th>VEÍCULO</th>
                    <th>SERVIÇO / FIPE</th>
                    <th>ENTRADA SGA</th>
                    <th>SITUAÇÃO</th>
                    <th aria-label="Ações"/>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map(entry=>(
                    <tr key={entry.id} className={marked.includes(entry.id)?"sga-row-selected":""}>
                      <td className="sga-select-cell" data-label="Seleção"><input type="checkbox" aria-label={"Selecionar cadastro SGA "+entry.data.sga_id} checked={marked.includes(entry.id)} disabled={busy||loading||!!historyError} onChange={()=>toggleMarked(entry.id)}/></td>
                      <td data-label="Associado">
                        <button type="button" className="zc-link sga-associate-link" disabled={busy} onClick={()=>select(entry)}>{entry.customer_name||"Associado não informado"}</button>
                        <small>SGA {entry.data.sga_id}{entry.data.contact?" · "+entry.data.contact:""}</small>
                      </td>
                      <td data-label="Veículo"><span className="zc-plate">{entry.vehicle||"Sem identificação"}</span><small>{entry.data.document_data?.model||"Modelo não informado"}{entry.data.document_data?.vehicle_type?" · "+entry.data.document_data.vehicle_type:""}</small></td>
                      <td data-label="Serviço / FIPE"><strong>Instalação</strong><small>{[entry.data.fipe_value,entry.data.fipe_risk].filter(Boolean).join(" · ")||"FIPE a confirmar"}</small></td>
                      <td data-label="Entrada SGA"><strong>{format(entry.movement_at,true)}</strong><small>{entry.origin==="automatic"?"Automática":"Manual"} · {format(entry.period_start)} a {format(entry.period_end)}</small></td>
                      <td data-label="Situação"><Badge value="Sem OS"/><small>{incomplete(entry)?"Dados a conferir":"Dados básicos preenchidos"}</small><small>Perfurado: {entry.data.sga_products?.perfurado===true?"Ativo":entry.data.sga_products?.perfurado===false?"Não ativo":"Não confirmado"}</small></td>
                      <td data-label="Ação"><div className="sga-order-actions"><button type="button" className="icon-button" title="Revisar e atribuir" aria-label="Revisar e atribuir" disabled={busy} onClick={()=>select(entry)}><ArrowRight size={16}/></button></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading&&queue.total>0&&<Pager data={{...queue,page,limit:queue.limit||25}} onPage={setPage}/>}
        </>
      )}
      {!settings && clearDialog && (
        <Modal title="Limpar pendências selecionadas" busy={busy} onClose={()=>setClearDialog(false)}>
          <div className="sga-clear-dialog">
            <p><strong>{selectedIds.length} cadastro(s) sem OS</strong> serão removidos da fila, incluindo preenchimentos locais. O histórico e as OS existentes serão preservados.</p>
            <label>Motivo da limpeza<select disabled={busy} value={clearReason} onChange={e=>setClearReason(e.target.value)}><option value="reimport">Importar novamente</option><option value="incomplete">Dados incompletos</option><option value="status_changed">Situação alterada no SGA</option><option value="other">Outro motivo</option></select></label>
            <small>Uma nova coleta do período original, inclusive uma repetição automática, pode recuperar o cadastro se ele continuar com instalação pendente. Falhas em consulta não são consideradas confirmação de mudança de situação.</small>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setClearDialog(false)}>Cancelar</button><button type="button" className="primary-button" disabled={busy || collecting || !selectedIds.length} onClick={clearMarked}>Confirmar limpeza</button></div>
          </div>
        </Modal>
      )}
      {!settings && selected && (
        <Modal
          title="Revisar cadastro e atribuir ao técnico"
          wide
          busy={busy}
          onClose={() => setSelected(null)}
        >
          <div className="sga-intake-detail sga-compact-detail">
            <div className="sga-prepared-header">
              <div><small>INSTALAÇÃO · SEM NÚMERO DE OS</small><h2>{selected.customer_name}</h2><p>{selected.vehicle} · {doc.model || "Modelo não informado"}</p></div>
              <div className="sga-prepared-status"><strong>Cadastro importado</strong><small>SGA {selected.data.sga_id} · {format(selected.received_at,true)}</small></div>
            </div>
            <p className="zc-notice">Dados recuperados da importação salva. Confira os campos editáveis e complete as informações ausentes. A regularidade precisa estar válida no momento de atribuir.</p>
            <div className="sga-prepared-metrics"><div><small>Valor FIPE</small><strong>{selected.data.fipe_value || "Não informado"}</strong></div><div><small>Classificação</small><strong>{effectiveFipe || "A confirmar"}</strong></div><div><small>Equipamentos previstos</small><strong>{assignment.electric === "yes" && !assignment.customer_choice ? "Consultar cliente" : assignment.customer_choice === "tag_only" ? "1 TAG" : (effectiveFipe === "Alta" || fipe.label === "Alta") ? "1 Rastreador + 1 TAG" : effectiveFipe ? "1 Rastreador" : "A confirmar"}</strong></div></div>
            <fieldset className="zc-fieldset"><legend>01 · Veículo e associado</legend><div className="zc-form-grid">
              <label>Associado<input readOnly value={selected.customer_name}/></label>
              {field("Contato","contact")}{field("CPF / CNPJ","cpf_cnpj",true)}{field("RG","rg",true)}
              <label>Placa ou chassi<input readOnly value={selected.vehicle}/></label><label>Chassi<input readOnly value={selected.chassis || ""}/></label>
              {field("Renavam","renavam",true)}{field("Marca","brand",true)}{field("Modelo","model",true)}{field("Ano","year",true)}{field("Cor","color",true)}{field("Categoria","category",true)}{field("Voluntário","volunteer")}
            </div></fieldset>
            <fieldset className="zc-fieldset"><legend>02 · Endereço do associado</legend><div className="zc-form-grid">{addressFields.map(([key,label]) => field(label,"customer_"+key,true))}</div></fieldset>
            <fieldset className="zc-fieldset"><legend>03 · FIPE e produtos</legend><div className="zc-form-grid">
              <label>Valor FIPE<input readOnly={!!savedFipe} value={savedFipe || assignment.fipe_value || ""} onChange={e=>setAssignment(a=>({...a,fipe_value:e.target.value}))}/></label>
              <label>Tipo de veículo<select disabled={busy} value={assignment.vehicle_type || savedType || ""} onChange={e=>setAssignment(a=>({...a,vehicle_type:e.target.value}))}><option value="">Selecione</option>{["Automóvel","Motocicleta"].map(v=><option key={v}>{v}</option>)}</select></label>
              <label>Regra regional<select disabled={busy} value={region} onChange={e=>setAssignment(a=>({...a,fipe_region:e.target.value}))}><option value="">Selecione</option>{fipeRegions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
              <label>Tipo FIPE<select disabled={busy} value={assignment.fipe_override||""} onChange={e=>setAssignment(a=>({...a,fipe_override:e.target.value}))}><option value="">Automático · {fipe.label||"Não classificado"}</option>{fipeCategories.map(x=><option key={x}>{x}</option>)}</select></label>
              <label>Classificação SGA<input disabled={busy} value={assignment.sga_classification||""} onChange={e=>setAssignment(a=>({...a,sga_classification:e.target.value}))}/></label>
              <label>Situação SGA<input disabled={busy} value={assignment.sga_status||""} onChange={e=>setAssignment(a=>({...a,sga_status:e.target.value}))}/></label>
            </div><SgaProducts value={selected.data.sga_products}/></fieldset>
            <button type="button" className="secondary-button" disabled={busy} onClick={()=>action(async()=>{const {data}=await api.patch("/sga-intake/entries/"+selected.id+"/draft",assignment);setSelected(data);await reload();notify("Cadastro salvo, sem gerar OS.");})}>Salvar preenchimento sem gerar OS</button>
            <details><summary>Dados originais do SGA (JSON)</summary><pre className="sga-raw-data">{JSON.stringify(selected.raw_source,null,2)}</pre></details>
          </div>
          <form className="sga-assignment-form"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                const { data } = await api.post(
                  "/sga-intake/entries/" + selected.id + "/assign",
                  assignment,
                  { timeout: 180000 },
                );
                setSelected(null);
                await reload();
                refresh?.();
                notify("OS " + data.id + " criada e atribuída.");
                openOrder?.(data.id);
              });
            }}
          >
            <fieldset className="zc-fieldset sga-assignment-section"><legend>04 · Atendimento e responsável</legend>
            <div className="zc-form-grid">
              <label>
                Técnico
                <select
                  aria-label="Técnico"
                  required
                  value={assignment.technician_id}
                  disabled={busy}
                  onChange={(e) =>
                    setAssignment({
                      ...assignment,
                      technician_id: e.target.value,
                    })
                  }
                >
                  <option value="">Selecione o técnico</option>
                  {techs.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Data e horário do atendimento
                <input
                  required
                  type="datetime-local"
                  value={assignment.scheduled_at}
                  disabled={busy}
                  onChange={(e) =>
                    setAssignment({
                      ...assignment,
                      scheduled_at: e.target.value,
                    })
                  }
                />
              </label>

            </div>
            <div className="zc-form-grid sga-electric-grid"><label>Veículo elétrico<select required value={assignment.electric} onChange={e => setAssignment({ ...assignment, electric: e.target.value, customer_choice: "" })} disabled={busy}><option value="">Confirme o tipo</option><option value="no">Não</option><option value="yes">Sim</option></select></label>
            {assignment.electric === "yes" && <label>Autorização após contato com o cliente<select required value={assignment.customer_choice} disabled={busy} onChange={e => setAssignment({ ...assignment, customer_choice: e.target.value })}><option value="">Aguardando consulta</option><option value="tracker">Cliente autorizou rastreador</option><option value="tag_only">Cliente autorizou somente TAG</option></select></label>}
            </div>
            <label className="sga-intake-check">
              <input
                type="checkbox"
                checked={assignment.sticker_discount_opt_in}
                disabled={busy}
                onChange={(e) =>
                  setAssignment({
                    ...assignment,
                    sticker_discount_opt_in: e.target.checked,
                  })
                }
              />
              Confirmar que o cliente optou pelo desconto do adesivo Perfurado
              (2371)
            </label>
            </fieldset>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Voltar
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? "Consultando SGA e validando…" : "Atribuir e gerar OS"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
