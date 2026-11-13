import { useEffect, useState, useRef } from "react";
import { api, errorMessage } from "@zen/ui/lib/api";
import "./spreadsheet-import.css";
const fieldLabels = {
  document_data: "Dados complementares",
  sga_check: "Situação e classificação no SGA",
  proposed_scheduled_at: "Agendamento proposto na origem (aguarda validação)",
  sga_id: "Código no SGA",
  sga_classification: "Classificação SGA",
  sga_status: "Situação SGA",
  contact: "Telefone",
  "document_data.brand": "Marca",
  "document_data.model": "Modelo",
  "document_data.color": "Cor",
  "document_data.renavam": "Renavam",
  "document_data.cpf_cnpj": "CPF/CNPJ",
  "document_data.customer_address": "Endereço do associado",
  "document_data.year": "Ano",
  period: "Competência",
  archive: "Base",
  workflow_mode: "Fluxo",
  scheduled_at: "Agendamento",
  shift: "Turno",
  technician_id: "Técnico vinculado",
  service: "Serviço",
  customer_name: "Associado",
  vehicle: "Placa / chassi",
  chassis: "Chassi",
  imei: "IMEI / TAG",
  term: "Envio do termo",
  completed_at: "Conclusão",
  technician_name: "Técnico de origem",
  location: "Região",
  volunteer: "Voluntário",
  fipe_value: "Valor FIPE original",
  fipe_risk: "Classificação FIPE original",
  created_by: "Incluiu (origem)",
  closed_by: "Concluiu (origem)",
  status: "Situação no sistema",
  legacy_status: "Situação original",
  notes: "Observações de origem",
};
const labels = {
  ready: "Prontas",
  ignored: "Ignoradas",
  pending: "Pendentes",
  duplicate: "Possíveis duplicidades",
};
export default function SpreadsheetImport() {
  const [file, setFile] = useState(null),
    [batch, setBatch] = useState(null),
    [history, setHistory] = useState([]),
    [selectedSheets, setSelectedSheets] = useState([]),
    [selectedArchive, setSelectedArchive] = useState(""),
    [compatible, setCompatible] = useState(false),
    [sgaStatus, setSgaStatus] = useState(null),
    [sgaMode, setSgaMode] = useState("fill_missing"),
    [sgaTask, setSgaTask] = useState(null),
    [sgaPollError, setSgaPollError] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("ready"),
    [page, setPage] = useState(0),
    [search, setSearch] = useState("");
  const reload = () =>
    api.get("/spreadsheet-imports").then(({ data }) => setHistory(data.items));
  useEffect(() => {
    api
      .get("/spreadsheet-imports/capabilities")
      .then(({ data }) => {
        if (data.version !== 9) throw Error("API incompatível");
        setCompatible(true);
        api
          .get("/sga/status")
          .then(({ data }) => setSgaStatus(data))
          .catch(() => setSgaStatus({ configured: false }));
        return reload();
      })
      .catch(() =>
        setError(
          "A API configurada não disponibiliza esta versão da importação. Publique a API e a interface juntas e confira o endereço da API configurado no site.",
        ),
      );
  }, []);
  const completedRun = useRef(null);
  useEffect(() => {
    if (!batch?.id || !batch.reviewed || batch.approved_at) return;
    let cancelled = false,
      timer;
    async function poll() {
      try {
        const { data } = await api.get(
          `/spreadsheet-imports/${batch.id}/enrichment`,
        );
        if (cancelled) return;
        if (
          data.state === "completed" &&
          completedRun.current !== data.run_id
        ) {
          const updated = await api.get(`/spreadsheet-imports/${batch.id}`);
          if (cancelled) return;
          completedRun.current = data.run_id;
          setBatch(updated.data);
        }
        setSgaTask(data);
        setSgaPollError("");
        if (["running", "queued"].includes(data.state))
          timer = setTimeout(poll, 2000);
      } catch {
        if (!cancelled) {
          setSgaPollError(
            "Não foi possível atualizar a consulta SGA. Tentando novamente; a prévia permanece preservada.",
          );
          timer = setTimeout(poll, 3000);
        }
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    batch?.id,
    batch?.reviewed,
    batch?.approved_at,
    batch?.enrichment?.run_id,
    batch?.enrichment?.state,
  ]);
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e.response?.status === 404
          ? "A rota de importação não existe na API configurada. Confira a publicação da API e o endereço configurado no site."
          : errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Escolha um arquivo de até 10 MB.");
      return;
    }
    await run(async () => {
      const content = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.onerror = () => reject(Error("Não foi possível ler o arquivo."));
        r.readAsDataURL(file);
      });
      const { data } = await api.post(
        "/spreadsheet-imports",
        { filename: file.name, content },
        {
          headers: {
            "Content-Type": "application/vnd.zencontrol.spreadsheet+json",
          },
        },
      );
      setBatch(data);
      setSgaTask(null);
      setSgaPollError("");
      setSgaMode("fill_missing");
      setSelectedSheets([]);
      setSelectedArchive("");

      setPage(0);
      await reload();
    });
  }
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const rows = (batch?.rows || []).filter(
    (r) =>
      r.state === filter &&
      normalize(
        [
          r.data?.customer_name,
          r.data?.vehicle,
          r.data?.imei,
          ...(r.equipment || []).map((e) => e.serial),
        ].join(" "),
      ).includes(normalize(search)),
  );
  if (filter === "duplicate")
    rows.sort((a, b) =>
      [a.data?.customer_name, a.data?.vehicle]
        .join()
        .localeCompare([b.data?.customer_name, b.data?.vehicle].join()),
    );
  return (
    <section className="zen-import" aria-label="Importação de planilha">
      <h2>Importação</h2>
      <p>
        Traga seu controle de serviços em três etapas: escolha o arquivo, revise
        os atendimentos e confirme.
      </p>
      <p>
        Envie o Excel no formato atual. Apenas abas mensais são analisadas.
        Ativos e abas auxiliares ficam fora desta importação.
      </p>
      <p>
        <strong>Importação por etapa:</strong> o sistema identifica os
        cabeçalhos, o mês/ano da aba e os sinais de cada atendimento. Serviços
        seguem a etapa identificada; a base HOT, WARM ou COLD é escolhida pelo
        administrador. Confira a etapa proposta e o motivo antes de confirmar. A
        importação não lança pagamentos, movimenta estoque ou envia mensagens.
      </p>
      <p>
        Numeração das OS: data + sequência hexadecimal (001 a FFF, até 4095 por
        dia). Na planilha, vale a data de envio do termo; quando ausente, usamos
        a data da importação com indicador de origem. O número é reservado
        somente ao confirmar.
      </p>
      <details>
        <summary>
          Integração SGA ·{" "}
          {sgaStatus?.configured
            ? "Consulta disponível"
            : "Aguardando configuração"}
        </summary>
        <p>
          Os códigos são consultados no catálogo atual do SGA; as listas antigas
          em PDF servem somente como referência.
        </p>
        {!sgaStatus?.configured && (
          <p>
            Configure no Render: SGA_READ_ENABLED, HINOVA_TOKEN_ASSOC,
            HINOVA_USER e HINOVA_PASS. As credenciais ficam somente no servidor.
          </p>
        )}
        <button
          className="secondary-button"
          disabled={busy || !sgaStatus?.configured}
          onClick={() =>
            run(async () => {
              const { data } = await api.post(
                "/sga/catalogs/refresh",
                undefined,
                { timeout: 180000 },
              );
              setSgaStatus((s) => ({
                ...s,
                catalogs: {
                  fetched_at: data.fetched_at,
                  counts: Object.fromEntries(
                    Object.entries(data.items).map(([k, v]) => [k, v.length]),
                  ),
                  errors: data.errors,
                },
              }));
            })
          }
        >
          Atualizar códigos do SGA
        </button>
        {sgaStatus?.catalogs && (
          <p>
            Última consulta:{" "}
            {new Date(sgaStatus.catalogs.fetched_at).toLocaleString("pt-BR")} ·{" "}
            {Object.values(sgaStatus.catalogs.counts || {}).reduce(
              (a, b) => a + b,
              0,
            )}{" "}
            códigos lidos.
          </p>
        )}
        {!!sgaStatus?.catalogs?.errors?.length && (
          <p role="status">
            Alguns catálogos não responderam. Tente atualizar os códigos
            novamente antes de conferir as classificações.
          </p>
        )}
      </details>
      <label>
        Planilha XLSX (até 10 MB)
        <input
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files[0] || null);
            setBatch(null);
          }}
        />
      </label>
      <button
        className="primary-button"
        disabled={!file || busy || !compatible}
        onClick={analyze}
      >
        {busy ? "Processando…" : "Analisar planilha"}
      </button>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {batch && (
        <>
          <h3>{batch.filename}</h3>
          {!batch.approved_at && (
            <fieldset disabled={busy}>
              <legend>1. Escolha os meses para importar</legend>
              <label>
                Base de destino (escolha do administrador)
                <select
                  value={selectedArchive}
                  onChange={(e) => {
                    setSelectedArchive(e.target.value);
                    setBatch((b) => ({ ...b, reviewed: false }));
                  }}
                >
                  <option value="">Selecione a base</option>
                  {["HOT", "WARM", "COLD"].map((base) => (
                    <option key={base} value={base}>
                      {base}
                    </option>
                  ))}
                </select>
              </label>
              {sgaStatus?.configured && (
                <label>
                  Preenchimento automático pelo SGA
                  <select
                    value={sgaMode}
                    onChange={(e) => {
                      setSgaMode(e.target.value);
                      setBatch((b) => ({ ...b, reviewed: false }));
                    }}
                  >
                    <option value="fill_missing">
                      Completar campos vazios e sinalizar divergências
                    </option>
                    <option value="skip">
                      Consultar depois, nas ordens de serviço
                    </option>
                    <option value="prefer_sga">
                      Usar os dados cadastrais atuais do SGA
                    </option>
                  </select>
                </label>
              )}
              {sgaMode === "skip" && (
                <p role="status">
                  A importação usará os dados da planilha. O cadastro SGA ficará
                  pendente nas OS e deverá ser validado antes do agendamento.
                </p>
              )}
              <div className="zen-import-filters">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSelectedSheets(
                      batch.sheets.filter((s) => s.eligible).map((s) => s.name),
                    );
                    setBatch((b) => ({ ...b, reviewed: false }));
                  }}
                >
                  Selecionar todos os meses
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSelectedSheets([]);
                    setBatch((b) => ({ ...b, reviewed: false }));
                  }}
                >
                  Limpar meses
                </button>
              </div>
              {batch.sheets.map((sheet) => (
                <label key={sheet.name} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    disabled={!sheet.eligible}
                    checked={selectedSheets.includes(sheet.name)}
                    onChange={(e) => {
                      setSelectedSheets((prev) =>
                        e.target.checked
                          ? [...prev, sheet.name]
                          : prev.filter((n) => n !== sheet.name),
                      );
                      setBatch((b) => ({ ...b, reviewed: false }));
                    }}
                  />
                  {sheet.name} —{" "}
                  {sheet.eligible
                    ? `${sheet.rows} linhas de atendimento`
                    : "Aba auxiliar, fora da importação"}
                </label>
              ))}
              <button
                className="primary-button"
                disabled={!selectedSheets.length || !selectedArchive}
                onClick={() =>
                  run(async () => {
                    const { data } = await api.post(
                      `/spreadsheet-imports/${batch.id}/review`,
                      {
                        sheets: selectedSheets,
                        archive: selectedArchive,
                        sga_mode: sgaMode,
                        groups: (batch.groups || []).filter((pair) =>
                          pair.every((id) =>
                            selectedSheets.some((name) =>
                              id.startsWith(name + ":"),
                            ),
                          ),
                        ),
                      },
                    );
                    setBatch(data);
                    setSgaTask(data.enrichment);
                    setPage(0);
                  })
                }
              >
                Revisar abas selecionadas
              </button>
              {(!selectedSheets.length || !selectedArchive) && (
                <p role="status">
                  Para liberar a revisão, escolha{" "}
                  {!selectedSheets.length && !selectedArchive
                    ? "ao menos um mês e a base de destino"
                    : !selectedSheets.length
                      ? "ao menos um mês"
                      : "a base de destino"}
                  .
                </p>
              )}
            </fieldset>
          )}
          {batch.reviewed && (
            <p>
              Meses da prévia: {batch.selected_sheets.join(", ")}. Confira
              composição, situação e destino antes de importar.
            </p>
          )}
          {batch.approved_at ? (
            <p role="status">
              Importação confirmada: {batch.result?.imported} registros
              gravados.
            </p>
          ) : (
            <p>
              Confira as linhas abaixo. Somente os registros prontos serão
              gravados. Prévia válida até{" "}
              {new Date(batch.expires_at).toLocaleString("pt-BR")}.
            </p>
          )}
          <p>
            Etapas prontas para importar:{" "}
            {Object.entries(
              batch.rows
                .filter((r) => r.state === "ready" && r.data)
                .reduce(
                  (totals, r) => ({
                    ...totals,
                    [r.data.status]: (totals[r.data.status] || 0) + 1,
                  }),
                  {},
                ),
            )
              .map(([stage, count]) => `${stage}: ${count}`)
              .join(" · ") || "nenhuma"}
            .
          </p>
          {sgaTask && (
            <div role="status">
              {["running", "queued"].includes(sgaTask.state)
                ? `Consultando SGA: ${sgaTask.processed || 0} de ${sgaTask.total || 0} veículos. Você pode aguardar o preenchimento ou parar a consulta e revisar a prévia atual.`
                : sgaTask.state === "completed"
                  ? `SGA: ${sgaTask.filled} registro(s) preenchido(s), ${sgaTask.conflicts} divergência(s).`
                  : sgaTask.message}
            </div>
          )}
          {sgaPollError && <p role="status">{sgaPollError}</p>}
          {batch.reviewed &&
            !batch.approved_at &&
            ["running", "queued"].includes(sgaTask?.state) && (
              <div>
                <p>
                  Ao parar, os dados desta consulta em andamento não serão
                  aplicados. A prévia atual será mantida para sua confirmação.
                </p>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const { data } = await api.post(
                        `/spreadsheet-imports/${batch.id}/enrichment/stop`,
                        { review_token: batch.review_token },
                      );
                      setBatch(data);
                      setSgaTask(data.enrichment);
                      setSgaPollError("");
                    })
                  }
                >
                  Parar consulta SGA e revisar agora
                </button>
              </div>
            )}
          {batch.reviewed && (
            <p role="status">
              {batch.rows.filter((r) => r.sources).length} atendimento(s)
              agrupado(s) automaticamente por nome e placa/chassi. Nenhuma
              seleção ou confirmação de agrupamento é necessária.
            </p>
          )}
          {batch.reviewed && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { data } = await api.get(
                    `/spreadsheet-imports/${batch.id}/export`,
                    { responseType: "blob" },
                  );
                  const url = URL.createObjectURL(data),
                    link = document.createElement("a");
                  link.href = url;
                  link.download = "ZenControl-revisao-completa.xlsx";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Exportar revisão completa (XLSX)
            </button>
          )}
          <nav className="zen-import-filters" aria-label="Resultado da análise">
            {Object.entries(labels).map(([k, l]) => (
              <button
                key={k}
                className="secondary-button"
                aria-pressed={filter === k}
                onClick={() => {
                  setFilter(k);
                  setPage(0);
                }}
              >
                {l} ({batch.counts[k]})
              </button>
            ))}
          </nav>
          {batch.reviewed && (
            <label>
              Buscar nome, placa ou IMEI
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Digite para localizar um atendimento"
              />
            </label>
          )}
          <div className="zen-import-table">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Placa</th>
                  <th>IMEI</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 50, (page + 1) * 50).map((r) => (
                  <tr key={r.sheet + ":" + r.row}>
                    <td>
                      {r.data?.customer_name || "—"}
                      {r.numbering && (
                        <small className="zen-import-note">
                          {r.order_id ? `OS: ${r.order_id} · ` : "Numeração: "}
                          {r.numbering.date
                            .split("-")
                            .reverse()
                            .join("/")} ·{" "}
                          {r.numbering.source === "term"
                            ? "Envio do termo"
                            : "Data da importação (termo sem data)"}
                        </small>
                      )}
                      {r.data?.sga_check?.assessment && (
                        <small className="zen-import-note">
                          SGA · Financeiro:{" "}
                          {r.data.sga_check.assessment.financial_status ||
                            "não confirmado"}{" "}
                          · Associado:{" "}
                          {r.data.sga_check.assessment.customer_status ||
                            "não confirmado"}{" "}
                          · Veículo:{" "}
                          {r.data.sga_check.assessment.vehicle_status ||
                            "não confirmado"}
                        </small>
                      )}
                      {r.sga && (
                        <small className="zen-import-note">
                          SGA:{" "}
                          {r.sga.filled?.length
                            ? `${r.sga.filled.length} campo(s) preenchido(s)`
                            : r.sga.status === "found"
                              ? "Conferido"
                              : r.sga.message || "Divergência no cadastro"}
                          {!!r.sga.conflicts?.length &&
                            ` · ${r.sga.conflicts.length} divergência(s)`}
                        </small>
                      )}

                      {r.group_warning && (
                        <small className="zen-import-note">
                          Há diferenças entre as linhas. Revise os dados
                          principais.
                        </small>
                      )}
                      {r.completion_date_source === "import_date" && (
                        <small className="zen-import-note">
                          Conclusão sem data: será usada a data da importação (
                          {r.data?.completed_at}).
                        </small>
                      )}
                      {r.reason && <p>{r.reason}</p>}
                      {r.data && (
                        <details>
                          <summary>Revisar conteúdo completo</summary>
                          {!!r.additional_order_ids?.length && (
                            <p>
                              OS adicionais: {r.additional_order_ids.join(", ")}
                            </p>
                          )}
                          {r.sga?.conflicts?.map((conflict, i) => (
                            <p key={i}>
                              Divergência (
                              {fieldLabels[conflict.field] || conflict.field}):
                              planilha “{conflict.original}”; SGA “
                              {conflict.sga}”.
                            </p>
                          ))}
                          <p>
                            {r.sheet} /{" "}
                            {r.sources?.map((s) => s.row).join(" + ") || r.row}{" "}
                            · {r.data?.status} · Base: {r.data?.archive}
                          </p>
                          {r.inference?.map((reason, i) => (
                            <p key={i}>{reason}</p>
                          ))}
                          <dl>
                            {Object.entries(r.data || {}).map(([k, v]) => (
                              <div key={k}>
                                <dt>{fieldLabels[k] || k}</dt>
                                <dd>
                                  {k === "sga_check" ? (
                                    <div>
                                      <p>
                                        Veículo:{" "}
                                        {v?.assessment
                                          ?.vehicle_classification ||
                                          "Classificação não informada"}{" "}
                                        ·{" "}
                                        {v?.assessment?.vehicle_status ||
                                          "Situação não confirmada"}
                                      </p>
                                      <p>
                                        Associado:{" "}
                                        {v?.assessment
                                          ?.customer_classification ||
                                          "Classificação não informada"}{" "}
                                        ·{" "}
                                        {v?.assessment?.customer_status ||
                                          "Situação não confirmada"}
                                      </p>
                                      <p>
                                        Financeiro:{" "}
                                        {v?.assessment?.financial_status ||
                                          "Não confirmado"}
                                      </p>
                                      {!!v?.assessment?.reasons?.length && (
                                        <p>{v.assessment.reasons.join("; ")}</p>
                                      )}
                                    </div>
                                  ) : k === "document_data" ? (
                                    <dl>
                                      {Object.entries(v).map(
                                        ([field, value]) => (
                                          <div key={field}>
                                            <dt>
                                              {fieldLabels[
                                                "document_data." + field
                                              ] || field}
                                            </dt>
                                            <dd>
                                              {typeof value === "object"
                                                ? JSON.stringify(value)
                                                : String(value)}
                                            </dd>
                                          </div>
                                        ),
                                      )}
                                    </dl>
                                  ) : k === "workflow_mode" ? (
                                    v === "controlled" ? (
                                      "Operação integrada"
                                    ) : (
                                      "Registro encerrado de origem"
                                    )
                                  ) : (
                                    v || "—"
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </td>
                    <td>{r.data?.vehicle || "—"}</td>
                    <td>
                      {r.equipment ? (
                        <>
                          <span>
                            Principal: {r.equipment[0]?.serial || "A informar"}
                          </span>
                          <small className="zen-import-note">
                            IMEI adicional:{" "}
                            {r.equipment
                              .slice(1)
                              .map((e) => e.serial || "A informar")
                              .join(" / ")}
                          </small>
                        </>
                      ) : (
                        r.data?.imei || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && <p>Nenhuma linha nesta categoria.</p>}
          <div className="zen-import-filters">
            <button
              className="secondary-button"
              disabled={!page}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              Página {page + 1} de {Math.max(1, Math.ceil(rows.length / 50))}
            </span>
            <button
              className="secondary-button"
              disabled={(page + 1) * 50 >= rows.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
          {!batch.approved_at && batch.reviewed && (
            <fieldset disabled={busy}>
              <legend>Confirmação do administrador</legend>
              <p>
                Linhas pendentes e possíveis duplicidades não serão importadas.
                Corrija o arquivo e gere uma nova prévia. Registros já
                existentes serão verificados novamente na confirmação.
              </p>
              {!batch.counts.ready && (
                <p role="status">
                  Não há atendimentos prontos para importar.{" "}
                  {batch.counts.pending} pendente(s) e {batch.counts.duplicate}{" "}
                  possível(is) duplicidade(s). Confira essas categorias e os
                  motivos apresentados em cada linha.
                </p>
              )}
              <button
                className="primary-button"
                disabled={
                  !batch.counts.ready ||
                  ["running", "queued"].includes(sgaTask?.state)
                }
                onClick={() =>
                  run(async () => {
                    await api.post(
                      "/spreadsheet-imports/" + batch.id + "/approve",
                      { confirmed: true, review_token: batch.review_token },
                    );
                    const { data } = await api.get(
                      "/spreadsheet-imports/" + batch.id,
                    );
                    setBatch(data);

                    await reload();
                  })
                }
              >
                {busy
                  ? "Processando…"
                  : ["running", "queued"].includes(sgaTask?.state)
                    ? "Aguardando consulta SGA"
                    : `Importar ${batch.counts.ready} atendimentos`}
              </button>
            </fieldset>
          )}
        </>
      )}
      <h3>Importações recentes</h3>
      <ul>
        {history.map((b) => (
          <li key={b.id}>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const { data } = await api.get(
                    "/spreadsheet-imports/" + b.id,
                  );
                  setBatch(data);
                  setSelectedSheets(data.selected_sheets);
                  setSelectedArchive(data.archive || "");
                  setSgaMode(data.sga_mode || "fill_missing");

                  setPage(0);
                })
              }
            >
              {b.filename} —{" "}
              {b.approved_at ? `${b.result?.imported} importados` : "Prévia"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
