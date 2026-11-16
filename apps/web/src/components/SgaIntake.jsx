import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, AlertCircle, Download, Settings2 } from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { api, errorMessage, format } from "./common";
import { notify } from "@zen/ui/lib/feedback";
import SgaProducts from "./SgaProducts";
import { classifyFipe, fipeRegions, fipeCents, fipeVehicleType } from "@zen/domain/fipe.mjs";
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
  onOpenQueue,
}) {
  const [config, setConfig] = useState(null),
    [choices, setChoices] = useState([]),
    [runs, setRuns] = useState([]);
  const [queue, setQueue] = useState({ items: [], total: 0 }),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [origin, setOrigin] = useState(settings ? "manual" : ""),
    [runId, setRunId] = useState(initialRunId);
  const [selected, setSelected] = useState(null),
    [techs, setTechs] = useState([]),
    [assignment, setAssignment] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [configured, setConfigured] = useState(false);
  const [confirmed, setConfirmed] = useState(false),
    [showSettings, setShowSettings] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [start, setStart] = useState(today), [end, setEnd] = useState(today), [complementary, setComplementary] = useState(true);
  const activeRuns = runs.filter(r => ["running","queued"].includes(r.state));
  const collecting = activeRuns.length > 0;
  const latest = runs[0];
  const loadData = async () => {
    const history = api.get("/sga-intake/runs");
    const entries = settings ? Promise.resolve(null) : api.get("/sga-intake/entries", { params: { page, q: query, origin, run_id: runId } });
    const [h, e] = await Promise.all([history,entries]);
    return { history: h.data.items, entries: e?.data };
  };
  const reload = async () => {
    const result = await loadData();
    if (result.entries) setQueue(result.entries);
    setRuns(result.history);
  };
  useEffect(() => {
    let active = true,
      timer;
    async function poll() {
      try {
        const result = await loadData();
        if (active) {
          if (result.entries) setQueue(result.entries);
          setRuns(result.history);
          setLoading(false);
        }
      } catch (e) {
        if (active) {
          setError(errorMessage(e));
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
  }, [page, query, revision, origin, runId, settings]);
  useEffect(() => {
    if (!settings) return;
    let active = true;
    Promise.allSettled([
      api.get("/sga-intake/config"),
      api.get("/sga-intake/catalogs"),
    ])
      .then(([c, catalogs]) => {
        if (active) {
          if (c.status === "fulfilled") {
            setConfig(c.value.data.config);
            setShowSettings(!c.value.data.config.pending_code);
            setConfigured(c.value.data.configured);
          } else setError(errorMessage(c.reason));
          if (catalogs.status === "fulfilled")
            setChoices(catalogs.value.data.items);
          else setError(errorMessage(catalogs.reason));
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [settings]);
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
        archive: "HOT",
        electric: "",
        customer_choice: "",
        fipe_value: "", vehicle_type: "", fipe_region: "", contact: "", volunteer: "", document_data: {},
        sticker_discount_opt_in: data.data.sga_products?.perfurado === true,
      });
    });
  }
  const doc = selected?.data.document_data || {};
  const savedFipe = fipeCents(selected?.data.fipe_value) ? selected.data.fipe_value : "";
  const savedType = fipeVehicleType(doc.vehicle_type) ? doc.vehicle_type : "";
  const draftUF = doc.customer_state || assignment.document_data?.customer_state;
  const region = doc.fipe_region || assignment.fipe_region || (draftUF ? (["SP","RJ"].includes(draftUF) ? draftUF : "GERAL") : "");
  const fipe = classifyFipe({ value: savedFipe || assignment.fipe_value, vehicleType: savedType || assignment.vehicle_type, region });
  const field = (label, key, document = false) => {
    const stored = document ? doc[key] : selected?.data[key];
    const value = stored || (document ? assignment.document_data?.[key] : assignment[key]) || "";
    return <label key={key}>{label}{key === "customer_state" ? <select disabled={!!stored || busy} value={value} onChange={e => setAssignment(a => ({...a,document_data:{...a.document_data,[key]:e.target.value}}))}><option value="">Selecione a UF</option>{brazilStates.map(uf => <option key={uf}>{uf}</option>)}</select> : <input readOnly={!!stored} disabled={busy} value={value} placeholder="Não informado" onChange={e => setAssignment(a => document ? {...a,document_data:{...a.document_data,[key]:e.target.value}} : {...a,[key]:e.target.value})}/>}</label>;
  };
  return (
    <section className={"sga-intake" + (settings ? " sga-import-view" : "")} aria-label="Instalações pendentes do SGA">
      <div className="sga-intake-heading">
        <div>
          <h2>Instalações pendentes do SGA</h2>
          <p className="sga-intake-subtitle">{settings ? "Importação automática ou por período." : loading ? "Carregando…" : `${queue.total} cadastro(s) aguardando atribuição · sem número de OS`}</p>
        </div>
        {settings && <button className="secondary-button" onClick={() => onOpenQueue?.()}><ArrowRight size={16}/> Abrir Controle de OS</button>}
      </div>

      {settings && config && (
        <details
          className="sga-config-details"
          open={showSettings}
          onToggle={(e) => setShowSettings(e.currentTarget.open)}
        >
          <summary>
            <Settings2 size={17} aria-hidden="true"/> <span>Coleta automática</span><small>{config.enabled ? config.daily_time + " · Brasília" : "Desativada"}</small>
          </summary>
          <form
            className="sga-intake-settings"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                const { data } = await api.put("/sga-intake/config", config);
                setConfig(data);
                setShowSettings(false);
                notify("Configuração da coleta SGA salva.");
              });
            }}
          >
            <label>
              Etapa no catálogo atual do SGA
              <select
                required
                value={
                  config.pending_code
                    ? config.pending_kind + ":" + config.pending_code
                    : ""
                }
                disabled={busy || (config.enabled && !configured)}
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
            {!choices.length && (
              <p role="status">
                Nenhum código de Instalação pendente foi encontrado no catálogo.
                Confira os códigos e as permissões de consulta no SGA.
              </p>
            )}
            <button
              className="primary-button"
              disabled={busy || (config.enabled && !configured)}
            >
              Salvar configuração
            </button>
          </form>
        </details>
      )}
      {settings && config && (
        <div className="sga-intake-manual">
          <h3><Download size={17} aria-hidden="true"/> Importação manual</h3>
          <div className="zc-form-grid">
            <label>Data inicial<input type="date" required value={start} max={end || today} disabled={busy || collecting} onChange={e => { setStart(e.target.value); setConfirmed(false); }} /></label>
            <label>Data final<input type="date" required value={end} min={start} max={today} disabled={busy || collecting} onChange={e => { setEnd(e.target.value); setConfirmed(false); }} /></label>
          </div>
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
            disabled={
              busy || loading ||
              !confirmed || !start || !end || start > end || end > today ||
              !configured ||
              !config.pending_code ||
              runs.some((r) => ["running", "queued"].includes(r.state))
            }
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
            {busy ? "Iniciando…" : collecting ? "Importação em andamento" : "Buscar pendências do período"}
          </button>
        </div>
      )}
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
      {!settings && !!runs.length && (
        <details className="sga-config-details">
          <summary>Histórico de coletas e diagnósticos</summary>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <strong>{format(run.created_at, true)}</strong> · {run.period_start} a {run.period_end} ·{" "}
                {
                  {
                    queued: "Na fila",
                    running: "Consultando SGA…",
                    completed: "Concluída",
                    failed: "Requer atenção",
                  }[run.state]
                }
                {run.summary?.imported !== undefined &&
                  ` · ${run.summary.imported} recebidos · ${run.summary.duplicates} já existentes · ${run.summary.failed} falhas em cadastros${run.summary.failed_days ? " · " + run.summary.failed_days + " datas com erro" : ""}`}
                <p>{run.message}</p>
                <small>{run.origin === "automatic" ? "Coleta automática" : "Coleta manual"}</small>
                <button type="button" className="secondary-button" onClick={() => { setOrigin(run.origin || ""); setRunId(run.id); setPage(1); }}>Ver cadastros deste lote</button>
                {onOpenQueue && <button type="button" className="secondary-button" onClick={() => onOpenQueue(run.id)}>Abrir lote no Controle de OS</button>}
                {!!run.summary?.day_results?.length && (
                  <ul className="sga-intake-errors">
                    {run.summary.day_results.map(day => (
                      <li key={day.day}><strong>{day.day}</strong>: {day.state === "failed" ? (run.summary.day_errors?.find(x => x.day === day.day)?.message || "Falha de consulta") : day.state === "empty" ? "Nenhuma movimentação" : day.movements + " movimentação(ões) recebida(s)"}</li>
                    ))}
                  </ul>
                )}
                {!!run.summary?.errors?.length && (
                  <ul className="sga-intake-errors">
                    {run.summary.errors.map((x) => (
                      <li key={x.sga_id}><strong>SGA {x.sga_id}</strong>{x.stage ? " · " + x.stage : ""}: {x.message || "Motivo não registrado na versão anterior."}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!settings && (
        <>
          <div className="zc-filters">
            <label>Origem da coleta
              <select value={origin} onChange={e => { setOrigin(e.target.value); setRunId(""); setPage(1); }}>
                <option value="">Todas as origens</option>
                <option value="automatic">Automática diária</option>
                <option value="manual">Manual por período</option>
              </select>
            </label>
            <label>Lote de coleta
              <select value={runId} onChange={e => { setRunId(e.target.value); setPage(1); }}>
                <option value="">Todos os lotes</option>
                {runId && !runs.some(r => r.id === runId) && <option value={runId}>Lote selecionado</option>}
                {runs.filter(r => !origin || r.origin === origin || r.id === runId).map(r => <option key={r.id} value={r.id}>{r.period_start} a {r.period_end} · {r.origin === "automatic" ? "Auto" : "Manual"} · {format(r.created_at, true)}</option>)}
              </select>
            </label>
            <button type="button" className="secondary-button" onClick={() => { setOrigin(""); setRunId(""); setQuery(""); setPage(1); }}>Limpar filtros</button>
          </div>
          {runId && <p><small>Este filtro mostra os novos cadastros preservados por este lote que ainda não têm OS. Duplicados permanecem no lote original; limpe os filtros para vê-los.</small></p>}
          <label>
            Buscar cadastro recebido
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Nome, placa, chassi ou código SGA"
            />
          </label>
          {!loading && !queue.items.length ? (
            <p>Nenhuma instalação pendente recebida nesta lista.</p>
          ) : (
            <div className="zc-table-scroll">
              <table className="zc-table zc-responsive-table">
                <thead>
                  <tr>
                    <th>Associado / veículo</th>
                    <th>Entrada na etapa SGA</th>
                    <th>Origem / período</th>
                    <th>FIPE</th>
                    <th>Perfurado 2371</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Associado / veículo">
                        <strong>{entry.customer_name}</strong>
                        <br />
                        {entry.vehicle} ·{" "}
                        {entry.data.document_data?.model ||
                          "Modelo não informado"}
                        <br />
                        <small>SGA {entry.data.sga_id} · Sem OS</small>
                        <small>{[entry.data.contact,entry.data.document_data?.customer_city,entry.data.document_data?.customer_state].filter(Boolean).join(" · ") || "Contato ou endereço não informado"}</small>
                      </td>
                      <td data-label="Entrada SGA">{format(entry.movement_at, true)}</td>
                      <td data-label="Origem / período">{entry.origin === "automatic" ? "Automática" : "Manual"}<br/><small>{entry.period_start} a {entry.period_end}</small></td>
                      <td data-label="FIPE"><strong>{entry.data.fipe_value || "Não informado"}</strong><small>{entry.data.fipe_risk || "Não classificado"}</small></td>
                      <td data-label="Perfurado 2371">
                        {entry.data.sga_products?.perfurado === true
                          ? "Ativo"
                          : entry.data.sga_products?.perfurado === false
                            ? "Não encontrado ativo"
                            : "Não confirmado"}
                      </td>
                      <td data-label="Ação">
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => select(entry)}
                        >
                          Revisar e atribuir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {queue.total > 25 && (
            <nav
              className="sga-intake-heading"
              aria-label="Paginação de pendências SGA"
            >
              <button
                disabled={page === 1 || busy}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} de {Math.ceil(queue.total / 25)}
              </span>
              <button
                disabled={page * 25 >= queue.total || busy}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </nav>
          )}
        </>
      )}
      {!settings && selected && (
        <Modal
          title="Revisar cadastro e atribuir ao técnico"
          wide
          busy={busy}
          onClose={() => setSelected(null)}
        >
          <div className="sga-intake-detail">
            <div className="sga-prepared-header">
              <div><small>INSTALAÇÃO · SEM NÚMERO DE OS</small><h2>{selected.customer_name}</h2><p>{selected.vehicle} · {doc.model || "Modelo não informado"}</p></div>
              <div className="sga-prepared-status"><strong>Cadastro importado</strong><small>SGA {selected.data.sga_id} · {format(selected.received_at,true)}</small></div>
            </div>
            <p className="zc-notice">Dados recuperados da importação salva. Complete apenas os campos ausentes. A regularidade precisa estar válida no momento de atribuir.</p>
            <div className="sga-prepared-metrics"><div><small>Valor FIPE</small><strong>{selected.data.fipe_value || "Não informado"}</strong></div><div><small>Classificação</small><strong>{fipe.label || "A confirmar"}</strong></div><div><small>Equipamentos previstos</small><strong>{assignment.electric === "yes" && !assignment.customer_choice ? "Consultar cliente" : assignment.customer_choice === "tag_only" ? "1 TAG" : fipe.label === "Alta" ? "1 Rastreador + 1 TAG" : fipe.label ? "1 Rastreador" : "A confirmar"}</strong></div></div>
            <fieldset className="zc-fieldset"><legend>01 · Veículo e associado</legend><div className="zc-form-grid">
              <label>Associado<input readOnly value={selected.customer_name}/></label>
              {field("Contato","contact")}{field("CPF / CNPJ","cpf_cnpj",true)}{field("RG","rg",true)}
              <label>Placa ou chassi<input readOnly value={selected.vehicle}/></label><label>Chassi<input readOnly value={selected.chassis || ""}/></label>
              {field("Renavam","renavam",true)}{field("Marca","brand",true)}{field("Modelo","model",true)}{field("Ano","year",true)}{field("Cor","color",true)}{field("Categoria","category",true)}{field("Voluntário","volunteer")}
            </div></fieldset>
            <fieldset className="zc-fieldset"><legend>02 · Endereço do associado</legend><div className="zc-form-grid">{addressFields.map(([key,label]) => field(label,"customer_"+key,true))}</div></fieldset>
            <fieldset className="zc-fieldset"><legend>03 · FIPE e produtos</legend><div className="zc-form-grid">
              <label>Valor FIPE<input readOnly={!!savedFipe} value={savedFipe || assignment.fipe_value || ""} onChange={e=>setAssignment(a=>({...a,fipe_value:e.target.value}))}/></label>
              <label>Tipo de veículo<select disabled={!!savedType} value={savedType || assignment.vehicle_type || ""} onChange={e=>setAssignment(a=>({...a,vehicle_type:e.target.value}))}><option value="">Selecione</option>{[...new Set(["Automóvel","Motocicleta",savedType].filter(Boolean))].map(v=><option key={v}>{v}</option>)}</select></label>
              <label>Regra regional<select disabled={!!doc.fipe_region} value={region} onChange={e=>setAssignment(a=>({...a,fipe_region:e.target.value}))}><option value="">Selecione</option>{fipeRegions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            </div><SgaProducts value={selected.data.sga_products}/></fieldset>
            <button type="button" className="secondary-button" disabled={busy} onClick={()=>action(async()=>{const {data}=await api.patch("/sga-intake/entries/"+selected.id+"/draft",assignment);setSelected(data);await reload();notify("Cadastro salvo, sem gerar OS.");})}>Salvar preenchimento sem gerar OS</button>
            <details><summary>Dados originais do SGA (JSON)</summary><pre className="sga-raw-data">{JSON.stringify(selected.raw_source,null,2)}</pre></details>
          </div>
          <form
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
              <label>
                Base da OS
                <select
                  aria-label="Base da OS"
                  required
                  value={assignment.archive}
                  disabled={busy}
                  onChange={(e) =>
                    setAssignment({ ...assignment, archive: e.target.value })
                  }
                >
                  <option value="">Selecione a base</option>
                  {["HOT", "WARM", "COLD"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>Veículo elétrico<select required value={assignment.electric} onChange={e => setAssignment({ ...assignment, electric: e.target.value, customer_choice: "" })} disabled={busy}><option value="">Confirme o tipo</option><option value="no">Não</option><option value="yes">Sim</option></select></label>
            {assignment.electric === "yes" && <label>Autorização após contato com o cliente<select required value={assignment.customer_choice} disabled={busy} onChange={e => setAssignment({ ...assignment, customer_choice: e.target.value })}><option value="">Aguardando consulta</option><option value="tracker">Cliente autorizou rastreador</option><option value="tag_only">Cliente autorizou somente TAG</option></select></label>}
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
