import { useEffect, useState } from "react";
import Modal from "@zen/ui/components/Modal";
import { api, errorMessage, format } from "./common";
import { notify } from "@zen/ui/lib/feedback";
import SgaProducts from "./SgaProducts";
import "./sga-intake.css";
export default function SgaIntake({
  settings = false,
  revision,
  openOrder,
  refresh,
}) {
  const [config, setConfig] = useState(null),
    [choices, setChoices] = useState([]),
    [runs, setRuns] = useState([]);
  const [queue, setQueue] = useState({ items: [], total: 0 }),
    [page, setPage] = useState(1),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null),
    [techs, setTechs] = useState([]),
    [assignment, setAssignment] = useState({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [configured, setConfigured] = useState(false);
  const [confirmed, setConfirmed] = useState(false),
    [expanded, setExpanded] = useState(settings),
    [showSettings, setShowSettings] = useState(false);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [start, setStart] = useState(today), [end, setEnd] = useState(today), [complementary, setComplementary] = useState(false);
  const activeRuns = runs.filter(r => ["running","queued"].includes(r.state));
  const reload = async () => {
    const [{ data: entries }, { data: history }] = await Promise.all([
      api.get("/sga-intake/entries", { params: { page, q: query } }),
      api.get("/sga-intake/runs"),
    ]);
    setQueue(entries);
    setRuns(history.items);
  };
  useEffect(() => {
    let active = true,
      timer;
    async function poll() {
      try {
        const [{ data: entries }, { data: history }] = await Promise.all([
          api.get("/sga-intake/entries", { params: { page, q: query } }),
          api.get("/sga-intake/runs"),
        ]);
        if (active) {
          setQueue(entries);
          setRuns(history.items);
          setLoading(false);
        }
      } catch (e) {
        if (active) {
          setError(errorMessage(e));
          setLoading(false);
        }
      }
      if (active) timer = setTimeout(poll, 10000);
    }
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, query, revision]);
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
        archive: "",
        electric: "",
        customer_choice: "",
        sticker_discount_opt_in: data.data.sga_products?.perfurado === true,
      });
    });
  }
  return (
    <section className="sga-intake" aria-label="Instalações pendentes do SGA">
      <div className="sga-intake-heading">
        <div>
          <h2>Instalações pendentes do SGA</h2>
          <p>
            {loading
              ? "Carregando…"
              : `${queue.total} cadastro(s) aguardando atribuição · sem número de OS`}
          </p>
        </div>
        {!settings && (
          <button
            className="secondary-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Recolher lista" : "Ver pendências"}
          </button>
        )}
      </div>
      {settings && (
        <p>
          Receba as mudanças para Instalação pendente feitas hoje, pelo horário
          de Brasília. Os dados originais são preservados; a coleta não altera
          cadastros existentes nem gera OS.
        </p>
      )}
      {settings && config && (
        <details
          open={showSettings}
          onToggle={(e) => setShowSettings(e.currentTarget.open)}
        >
          <summary>
            Configurar coleta diária ·{" "}
            {config.enabled
              ? config.daily_time + " (Brasília)"
              : "Automação desativada"}
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
            <p>
              Importação bruta, sem sobrescrever e sem duplicar. O administrador
              autoriza as próximas coletas ao salvar esta configuração.
            </p>
            <small>
              A coleta depende do servidor ativo no horário escolhido. Registros
              que entrarem depois desse horário podem ser buscados por uma nova
              coleta manual no mesmo dia.
            </small>
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
          <div className="zc-form-grid">
            <label>Data inicial<input type="date" required value={start} max={end || today} disabled={busy} onChange={e => { setStart(e.target.value); setConfirmed(false); }} /></label>
            <label>Data final<input type="date" required value={end} min={start} max={today} disabled={busy} onChange={e => { setEnd(e.target.value); setConfirmed(false); }} /></label>
          </div>
          <small>Até 31 dias por coleta. Cadastros existentes serão ignorados.</small>
          <label className="sga-intake-check"><input type="checkbox" checked={complementary} disabled={busy} onChange={e => setComplementary(e.target.checked)} /> Consultar também situação financeira e cadastral durante a coleta (mais lento; obrigatória ao agendar).</label>
          <label className="sga-intake-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
            />
            Confirmo a coleta dos cadastros que passaram para Instalação
            pendente no período selecionado.
          </label>
          <button
            className="secondary-button"
            disabled={
              busy ||
              !confirmed || !start || !end || start > end || end > today ||
              !configured ||
              !config.pending_code ||
              runs.some((r) => ["running", "queued"].includes(r.state))
            }
            onClick={() =>
              action(async () => {
                await api.post("/sga-intake/runs", { confirmed: true, start, end, complementary });
                setConfirmed(false);
                await reload();
                notify("Coleta SGA iniciada. Você pode continuar trabalhando.");
              })
            }
          >
            {busy ? "Iniciando…" : "Buscar pendências do período"}
          </button>
        </div>
      )}
      {settings && activeRuns.map(run => <div key={run.id} role="status" className="sga-intake-manual"><strong>{run.state === "queued" ? "Na fila do servidor" : "Importação em andamento"} · {run.period_start} a {run.period_end}</strong><p>{run.message || "Aguardando o worker de integração…"}</p>{run.summary?.phase === "records" ? <progress max={Math.max(1, run.summary.matching)} value={run.summary.processed || 0} /> : run.summary?.total_days ? <progress max={run.summary.total_days} value={run.summary.processed_days || 0} /> : <progress />}<p>{run.summary?.received || 0} movimentações · {run.summary?.imported || 0} novos · {run.summary?.duplicates || 0} duplicados · {run.summary?.failed || 0} falhas</p></div>)}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {settings && !!runs.length && (
        <details>
          <summary>Histórico de coletas</summary>
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
                  ` · ${run.summary.imported} recebidos · ${run.summary.duplicates} já existentes · ${run.summary.failed} falhas`}
                <p>{run.message}</p>
                {!!run.summary?.errors?.length && (
                  <p>
                    {run.summary.errors
                      .map((x) => "SGA " + x.sga_id)
                      .join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {expanded && (
        <>
          <label>
            Buscar cadastro recebido
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Nome ou placa"
            />
          </label>
          {!loading && !queue.items.length ? (
            <p>Nenhuma instalação pendente recebida nesta lista.</p>
          ) : (
            <div className="zc-table-scroll">
              <table className="zc-table">
                <thead>
                  <tr>
                    <th>Associado / veículo</th>
                    <th>Entrada na etapa SGA</th>
                    <th>Perfurado 2371</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.customer_name}</strong>
                        <br />
                        {entry.vehicle} ·{" "}
                        {entry.data.document_data?.model ||
                          "Modelo não informado"}
                        <br />
                        <small>SGA {entry.data.sga_id} · Sem OS</small>
                      </td>
                      <td>{format(entry.movement_at, true)}</td>
                      <td>
                        {entry.data.sga_products?.perfurado === true
                          ? "Ativo"
                          : entry.data.sga_products?.perfurado === false
                            ? "Não encontrado ativo"
                            : "Não confirmado"}
                      </td>
                      <td>
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
      {selected && (
        <Modal
          title="Revisar cadastro e atribuir ao técnico"
          wide
          busy={busy}
          onClose={() => setSelected(null)}
        >
          <div className="sga-intake-detail">
            <p>
              <strong>{selected.customer_name}</strong> · {selected.vehicle} ·{" "}
              {selected.data.document_data?.model}
            </p>
            <p>
              Este cadastro ainda não tem OS. Ao confirmar a atribuição, a
              regularidade será consultada novamente no SGA e o número será
              gerado com a data de hoje.
            </p>
            <p><strong>FIPE:</strong> {selected.data.fipe_value || "Não informada no SGA"} · {selected.data.document_data?.vehicle_type || "Tipo não informado"}. FIPE alta exige rastreador e TAG; elétricos exigem consulta ao cliente.</p>
            <SgaProducts value={selected.data.sga_products} />
            <details>
              <summary>Todos os dados originais recebidos</summary>
              <pre className="sga-raw-data">
                {JSON.stringify(selected.raw_source, null, 2)}
              </pre>
            </details>
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
