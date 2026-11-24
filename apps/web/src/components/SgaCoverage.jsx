import { useEffect, useState } from "react";
import Modal from "@zen/ui/components/Modal";
import { api, errorMessage, format, Loading } from "./common";

const labels = {
  RASTREADOR: "Rastreadores",
  TAG: "TAGs",
  PERFURADO: "Adesivos Perfurado",
};
const status = {
  covered: "Coberto pela carga atual",
  matrix_transfer: "Depende de transferência da matriz",
  shortage: "Equipamentos insuficientes",
  route_pending: "Trajeto a confirmar",
  stock_pending: "Estoque a confirmar",
  demand_pending: "Equipamentos a confirmar na ficha",
  already_ordered: "Já possui OS",
};
const metrics = [
  ["required", "Necessários"],
  ["covered", "Da carga atual"],
  ["from_matrix", "Da matriz"],
  ["missing", "Faltam"],
  ["pending", "A confirmar"],
];
function describe(value) {
  if (!value) return "A confirmar";
  return (
    Object.entries(labels)
      .filter(([key]) => value[key] > 0)
      .map(([key, label]) => `${value[key]} ${label.toLowerCase()}`)
      .join(" · ") || "Nenhum"
  );
}
function route(candidate) {
  return `${candidate.name} · ${Math.round(candidate.route.duration_seconds / 60)} min · ${(candidate.route.distance_meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}
export default function SgaCoverage({ ids, onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api
      .post(
        "/sga-intake/coverage",
        { ids },
        { signal: controller.signal, timeout: 180000 },
      )
      .then(({ data }) => setResult(data))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [ids]);
  return (
    <Modal title="Cobertura das instalações pendentes" wide onClose={onClose}>
      <div className="sga-coverage-content">
        <p>
          Simulação para as pendências selecionadas. As transferências sugeridas
          dependem de confirmação de prazo com a operação.
        </p>
        {!result && <Loading error={error} />}
        {result && (
          <>
            <p>
              <strong>Matriz antes da simulação:</strong>{" "}
              {describe(result.matrix)}
              <br />
              <strong>Matriz restante:</strong>{" "}
              {describe(result.matrix_remaining)}
            </p>
            <div className="zc-table-scroll">
              <table className="zc-table zc-responsive-table">
                <thead>
                  <tr>
                    <th scope="col">Equipamento</th>
                    {metrics.map(([key, label]) => (
                      <th scope="col" key={key}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(labels).map(([key, label]) => (
                    <tr key={key}>
                      <td data-label="Equipamento">{label}</td>
                      {metrics.map(([id, title]) => (
                        <td key={id} data-label={title}>
                          {result.totals[id][key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.totals.pending_items > 0 && (
              <p>
                {result.totals.pending_items} atendimento(s) dependem de
                conferência. Quantidades indefinidas ficam fora dos totais.
              </p>
            )}
            <ul className="sga-coverage-results">
              {result.items.map((item) => (
                <li key={item.id}>
                  <strong>
                    {item.vehicle} · {status[item.state]}
                  </strong>
                  {item.date && (
                    <div>Data prevista: {format(item.date, true)}</div>
                  )}
                  {item.required && (
                    <div>Necessários: {describe(item.required)}</div>
                  )}
                  {item.nearest && (
                    <div>
                      Mais próximo: {route(item.nearest)} · Carga livre
                      estimada: {describe(item.nearest.free)}
                    </div>
                  )}
                  {item.direct && (
                    <div>
                      Mais próximo com carga completa: {route(item.direct)}
                    </div>
                  )}
                  {item.matrix_option && (
                    <div>
                      Com transferência: {route(item.matrix_option)} · Matriz:{" "}
                      {describe(item.matrix_option.missing)}
                    </div>
                  )}
                  {item.missing && (
                    <div>
                      Faltam para o técnico mais próximo:{" "}
                      {describe(item.missing)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}
