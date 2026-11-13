import { useState } from "react";
import { Plus, Search } from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { notify } from "@zen/ui/lib/feedback";
import {
  api,
  Panel,
  Intro,
  Empty,
  Loading,
  Pager,
  FormModal,
  format,
  useLoad,
} from "./common";
import "./operational-services.css";

const states = [
  ["registered", "Registrado"],
  ["in_progress", "Em atendimento"],
  ["completed", "Concluído"],
  ["cancelled", "Cancelado"],
];
function State({ value }) {
  const color = {
    registered: "amber",
    in_progress: "blue",
    completed: "mint",
    cancelled: "gray",
  }[value];
  return (
    <span className={"zc-badge " + color}>
      {states.find(([s]) => s === value)?.[1]}
    </span>
  );
}
const detailFields = (state = "registered", creating = false) => [
  {
    name: "status",
    label: "Situação do bloqueio",
    required: true,
    options: states.filter(([s]) =>
      creating
        ? s !== "cancelled"
        : state === "registered" ||
          s === state ||
          (state === "in_progress" && ["completed", "cancelled"].includes(s)),
    ),
  },
  {
    name: "provider_reference",
    label: "Protocolo da Rede Veículo (opcional)",
    maxLength: 200,
  },
  {
    name: "notes",
    label: "Observações operacionais",
    type: "textarea",
    maxLength: 3000,
    full: true,
  },
];
function EditBlocking({ id, onClose, onSave }) {
  const { data, loading, error } = useLoad("/operational-services/" + id);
  if (loading || error)
    return (
      <Modal title="Bloqueio operacional" onClose={onClose}>
        <Loading error={error} />
      </Modal>
    );
  return (
    <FormModal
      title={"Bloqueio · " + data.vehicle}
      description={
        "Execução pela Rede Veículo. Registre a situação informada pela operação e o protocolo, quando disponível."
      }
      initial={data}
      fields={detailFields(data.status)}
      onClose={onClose}
      onSave={(values) =>
        onSave({
          version: data.version,
          status: values.status,
          provider_reference: values.provider_reference,
          notes: values.notes,
        })
      }
    >
      <section className="zc-detail-section">
        <p>
          <b>Associado:</b> {data.customer_name || "Não informado"}
        </p>
        <p>
          <b>OS de referência:</b> {data.order_id || "Serviço avulso"}
        </p>
        <p>
          <b>Registrado por:</b> {data.created_by} ·{" "}
          {format(data.created_at, true)}
        </p>
        {data.completed_at && (
          <p>
            <b>Concluído em:</b> {format(data.completed_at, true)}
          </p>
        )}
        <details>
          <summary>Histórico do bloqueio</summary>
          <ol className="operational-history">
            {data.history.map((event, index) => (
              <li key={index}>
                <b>{event.actor}</b> · {format(event.created_at, true)}
                <p>
                  {event.action === "operational_service_created"
                    ? "Registro criado"
                    : "Registro atualizado"}{" "}
                  · <State value={event.detail.after.status} />
                </p>
                {event.detail.after.provider_reference && (
                  <p>Protocolo: {event.detail.after.provider_reference}</p>
                )}
                {event.detail.after.notes && <p>{event.detail.after.notes}</p>}
              </li>
            ))}
          </ol>
        </details>
      </section>
    </FormModal>
  );
}

export default function OperationalServices({ revision, refresh, openOrder }) {
  const [query, setQuery] = useState(""),
    [term, setTerm] = useState(""),
    [state, setState] = useState(""),
    [page, setPage] = useState(1),
    [editor, setEditor] = useState(null);
  const params = new URLSearchParams({
    q: query,
    status: state,
    page: String(page),
  });
  const { data, loading, error } = useLoad(
    "/operational-services?" + params,
    revision,
  );
  async function save(values) {
    if (editor.id)
      await api.patch("/operational-services/" + editor.id, values);
    else await api.post("/operational-services", values);
    setEditor(null);
    refresh();
    notify("Registro operacional salvo.");
  }
  return (
    <>
      <Intro
        title="Bloqueios operacionais."
        subtitle="Acompanhe os serviços executados pela Rede Veículo."
      >
        <button
          className="primary-button"
          onClick={() => setEditor({ id: null })}
        >
          <Plus size={16} />
          Registrar bloqueio
        </button>
      </Intro>
      <div className="zc-notice">
        Serviço executado pela Rede Veículo, sem tarefa ou remuneração para o
        técnico. Registre a situação e o protocolo após a tratativa com a
        operação.
      </div>
      <Panel>
        <div className="operational-filters">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(term.trim());
              setPage(1);
            }}
          >
            <label>
              Pesquisar bloqueio
              <input
                type="search"
                aria-label="Pesquisar bloqueio"
                value={term}
                maxLength={200}
                placeholder="Placa, associado, OS ou protocolo"
                onChange={(e) => setTerm(e.target.value)}
              />
            </label>
            <button className="secondary-button" type="submit">
              <Search size={16} />
              Pesquisar
            </button>
          </form>
          <label>
            Filtrar situação
            <select
              aria-label="Filtrar situação"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as situações</option>
              {states.map(([s, name]) => (
                <option key={s} value={s}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {loading || error ? (
          <Loading error={error} />
        ) : !data.items.length ? (
          <Empty
            title="Nenhum bloqueio encontrado"
            description="Registre o serviço operacional para acompanhar a situação e o protocolo da Rede Veículo."
          />
        ) : (
          <>
            <div className="zc-table-scroll">
              <table className="zc-table">
                <thead>
                  <tr>
                    <th>VEÍCULO / ASSOCIADO</th>
                    <th>OS DE REFERÊNCIA</th>
                    <th>SITUAÇÃO / PROTOCOLO</th>
                    <th>ÚLTIMA ALTERAÇÃO</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.vehicle}</strong>
                        <small>
                          {row.customer_name || "Associado não informado"}
                        </small>
                      </td>
                      <td>
                        {row.order_id ? (
                          <button
                            className="secondary-button"
                            onClick={() => openOrder(row.order_id)}
                          >
                            {row.order_id}
                          </button>
                        ) : (
                          "Serviço avulso"
                        )}
                      </td>
                      <td>
                        <State value={row.status} />
                        <small>
                          {row.provider_reference || "Sem protocolo"}
                        </small>
                      </td>
                      <td>
                        <strong>{row.updated_by}</strong>
                        <small>{format(row.updated_at, true)}</small>
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          onClick={() => setEditor({ id: row.id })}
                        >
                          Ver bloqueio
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager data={data} onPage={setPage} />
          </>
        )}
      </Panel>
      {editor &&
        (editor.id ? (
          <EditBlocking
            key={editor.id}
            id={editor.id}
            onClose={() => setEditor(null)}
            onSave={save}
          />
        ) : (
          <FormModal
            title="Registrar bloqueio operacional"
            description="Serviço executado pela Rede Veículo. Este registro acompanha a operação e não envia um comando de bloqueio ao veículo."
            initial={{
              vehicle: "",
              customer_name: "",
              order_id: "",
              status: "registered",
              provider_reference: "",
              notes: "",
            }}
            fields={[
              {
                name: "vehicle",
                label: "Placa ou chassi",
                required: true,
                maxLength: 40,
              },
              {
                name: "customer_name",
                label: "Associado (opcional)",
                maxLength: 200,
              },
              {
                name: "order_id",
                label: "OS de referência (opcional)",
                maxLength: 100,
                full: true,
              },
              ...detailFields("registered", true),
            ]}
            submit="Registrar bloqueio"
            onClose={() => setEditor(null)}
            onSave={save}
          />
        ))}
    </>
  );
}
