import {
  canSelect,
  lineId,
  planGroups,
} from "@zen/domain/import-selection.mjs";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@zen/ui/lib/api";
import "./spreadsheet-import.css";
const fieldLabels = {
  document_data: "Equipamentos previstos",
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
    [selectedLines, setSelectedLines] = useState([]),
    [selectedArchive, setSelectedArchive] = useState(""),
    [compatible, setCompatible] = useState(false),
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
        if (data.version !== 7) throw Error("API incompatível");
        setCompatible(true);
        return reload();
      })
      .catch(() =>
        setError(
          "A API configurada não disponibiliza esta versão da importação. Publique a API e a interface juntas e confira o endereço da API configurado no site.",
        ),
      );
  }, []);
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
      setSelectedSheets([]);
      setSelectedArchive("");
      setSelectedLines([]);

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
  const eligible = rows.filter(canSelect);
  const selectionPlan = planGroups(batch?.rows || [], selectedLines);
  function selectRows(list) {
    setSelectedLines((previous) => [
      ...new Set([...previous, ...list.map(lineId)]),
    ]);
  }
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
                    setSelectedLines([]);

                    setPage(0);
                  })
                }
              >
                Revisar abas selecionadas
              </button>
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
          {batch.reviewed && !batch.approved_at && (
            <div>
              <p>
                Marque os registros do mesmo nome e placa/chassi para
                agrupá-los. A primeira linha selecionada define o IMEI
                principal; a segunda, o IMEI adicional. Os dados principais
                seguem a primeira linha.
              </p>
              <p>
                Todos os registros prontos serão importados. A seleção abaixo
                serve apenas para agrupar os equipamentos.
              </p>
              <div className="zen-import-filters">
                <button
                  className="secondary-button"
                  disabled={busy || !batch.rows.some(canSelect)}
                  onClick={() => selectRows(batch.rows.filter(canSelect))}
                >
                  Selecionar todos os registros
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !eligible.length}
                  onClick={() => selectRows(eligible)}
                >
                  Selecionar todos os resultados ({eligible.length})
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !eligible.length}
                  onClick={() =>
                    selectRows(
                      rows.slice(page * 50, (page + 1) * 50).filter(canSelect),
                    )
                  }
                >
                  Selecionar esta página
                </button>
                <button
                  className="secondary-button"
                  disabled={busy || !selectedLines.length}
                  onClick={() => setSelectedLines([])}
                >
                  Limpar seleção
                </button>
              </div>
              <p>
                {selectionPlan.pairs.length} par(es) pronto(s) para agrupar.{" "}
                {selectionPlan.ambiguous > 0 &&
                  `${selectionPlan.ambiguous} grupo(s) com mais de duas linhas ou IMEI repetido precisam de revisão.`}{" "}
                {selectionPlan.singles > 0 &&
                  `${selectionPlan.singles} registro(s) sem par continuam separados.`}
              </p>
              <button
                className="secondary-button"
                disabled={busy || !selectionPlan.pairs.length}
                onClick={() =>
                  run(async () => {
                    const { data } = await api.post(
                      `/spreadsheet-imports/${batch.id}/review`,
                      {
                        sheets: batch.selected_sheets,
                        archive: selectedArchive,
                        groups: [
                          ...(batch.groups || []),
                          ...selectionPlan.pairs,
                        ],
                      },
                    );
                    setBatch(data);
                    setSelectedLines([]);

                    setFilter("ready");
                    setPage(0);
                  })
                }
              >
                Agrupar pares selecionados
              </button>
              {(batch.groups || []).map((pair, index) => (
                <div key={pair.join("|")}>
                  <span>
                    Atendimento agrupado · principal: {pair[0]} · adicional:{" "}
                    {pair[1]}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const { data } = await api.post(
                          `/spreadsheet-imports/${batch.id}/review`,
                          {
                            sheets: batch.selected_sheets,
                            archive: selectedArchive,
                            groups: batch.groups.filter((_, i) => i !== index),
                          },
                        );
                        setBatch(data);
                        setSelectedLines([]);
                      })
                    }
                  >
                    Desfazer agrupamento {index + 1}
                  </button>
                </div>
              ))}
            </div>
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
          {selectedLines.length > 0 && (
            <p>
              {selectedLines.length} registro(s) selecionado(s). Primeiro:{" "}
              {selectedLines[0]} (principal)
              {selectedLines[1]
                ? ` · Segundo: ${selectedLines[1]} (adicional)`
                : ""}
              .
            </p>
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
                      {batch.reviewed &&
                        !batch.approved_at &&
                        !r.sources &&
                        !r.additional_orders &&
                        ["ready", "duplicate"].includes(r.state) &&
                        !!r.data?.service && (
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${r.sheet} linha ${r.row}`}
                            checked={selectedLines.includes(
                              r.sheet + ":" + r.row,
                            )}
                            onChange={(e) =>
                              setSelectedLines((prev) =>
                                e.target.checked
                                  ? [...prev, r.sheet + ":" + r.row]
                                  : prev.filter(
                                      (id) => id !== r.sheet + ":" + r.row,
                                    ),
                              )
                            }
                          />
                        )}
                      {r.data?.customer_name || "—"}
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
                                  {k === "document_data"
                                    ? `${v.equipment_counts?.tracker || 0} rastreador(es), ${v.equipment_counts?.tag || 0} TAG(s)`
                                    : k === "workflow_mode"
                                      ? v === "controlled"
                                        ? "Operação integrada"
                                        : "Registro encerrado de origem"
                                      : v || "—"}
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
                            {r.equipment[1]?.serial || "A informar"}
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
              <button
                className="primary-button"
                disabled={!batch.counts.ready}
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
                Importar {batch.counts.ready} atendimentos
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
                  setSelectedLines([]);
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
