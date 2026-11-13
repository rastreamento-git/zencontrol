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
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [filter, setFilter] = useState("ready"),
    [page, setPage] = useState(0);
  const reload = () =>
    api.get("/spreadsheet-imports").then(({ data }) => setHistory(data.items));
  useEffect(() => {
    reload().catch((e) => setError(errorMessage(e)));
  }, []);
  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
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
      setConfirmation("");
      setPage(0);
      await reload();
    });
  }
  const rows = batch?.rows.filter((r) => r.state === filter) || [];
  return (
    <section className="zen-import" aria-label="Importação de planilha">
      <h2>Importar controle de serviços</h2>
      <p>
        Envie o Excel no formato atual. Apenas abas mensais são analisadas.
        Ativos e abas auxiliares ficam fora desta importação.
      </p>
      <p>
        <strong>Importação por etapa:</strong> o sistema identifica os
        cabeçalhos, o mês/ano da aba e os sinais de cada atendimento. Serviços
        em aberto entram na operação; encerrados seguem a retenção por período.
        Confira a etapa proposta e o motivo antes de confirmar. A importação não
        lança pagamentos, movimenta estoque ou envia mensagens.
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
            setConfirmation("");
          }}
        />
      </label>
      <button
        className="primary-button"
        disabled={!file || busy}
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
          {batch.approved_at ? (
            <p role="status">
              Importação confirmada: {batch.result?.imported} registros
              gravados.
            </p>
          ) : (
            <p>
              Confira as linhas abaixo. Somente as prontas serão gravadas.
              Prévia válida até{" "}
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
          <div className="zen-import-table">
            <table>
              <thead>
                <tr>
                  <th>Aba / linha</th>
                  <th>Associado / veículo</th>
                  <th>Serviço / situação</th>
                  <th>Etapa identificada / destino</th>
                  <th>Conferência</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(page * 50, (page + 1) * 50).map((r) => (
                  <tr key={r.sheet + ":" + r.row}>
                    <td>
                      {r.sheet} / {r.row || "aba inteira"}
                    </td>
                    <td>
                      {r.data?.customer_name || "—"}
                      <br />
                      {r.data?.vehicle}
                    </td>
                    <td>
                      {r.data?.service || "—"}
                      <br />
                      {r.data?.legacy_status}
                    </td>
                    <td>
                      <strong>{r.data?.status || "—"}</strong>
                      <div>
                        {r.destination}
                        {r.data?.archive ? ` · ${r.data.archive}` : ""}
                      </div>
                      <div>{r.period}</div>
                      {!!r.additional_orders && (
                        <p>
                          {r.additional_orders} OS adicional de equipamento será
                          criada.
                        </p>
                      )}
                      {r.inference?.map((reason, i) => (
                        <p key={i}>{reason}</p>
                      ))}
                    </td>
                    <td>
                      {r.reason && <p>{r.reason}</p>}
                      {r.data && (
                        <details>
                          <summary>Ver dados</summary>
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
          {!batch.approved_at && (
            <fieldset disabled={busy}>
              <legend>Confirmação do administrador</legend>
              <p>
                Linhas pendentes e possíveis duplicidades não serão importadas.
                Corrija o arquivo e gere uma nova prévia. Registros já
                existentes serão verificados novamente na confirmação.
              </p>
              <label>
                Digite IMPORTAR SERVICOS
                <input
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                className="primary-button"
                disabled={
                  confirmation !== "IMPORTAR SERVICOS" || !batch.counts.ready
                }
                onClick={() =>
                  run(async () => {
                    await api.post(
                      "/spreadsheet-imports/" + batch.id + "/approve",
                      { confirmation },
                    );
                    const { data } = await api.get(
                      "/spreadsheet-imports/" + batch.id,
                    );
                    setBatch(data);
                    setConfirmation("");
                    await reload();
                  })
                }
              >
                Confirmar importação de {batch.counts.ready} registros
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
                  setPage(0);
                  setConfirmation("");
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
