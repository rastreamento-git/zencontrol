import {
  passwordInputProps,
  passwordRequirements,
} from "@zen/ui/lib/password-policy";
import { useEffect, useState } from "react";
import { classifyFipe, fipeRegions } from "@zen/domain/fipe.mjs";
import {
  addressFields,
  brazilStates,
  formatPhone,
  schedulingServices,
} from "@zen/domain/order-fields.mjs";
import {
  Plus,
  Search,
  Download,
  Send,
  CheckCheck,
  RefreshCw,
  Phone,
  MapPin,
  Wrench,
  ArrowRight,
  Wallet,
  Trash2,
} from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { notify, confirmAction } from "@zen/ui/lib/feedback";
import {
  api,
  errorMessage,
  Panel,
  Intro,
  Empty,
  Loading,
  Pager,
  Badge,
  FormModal,
  Field,
  download,
  format,
  initials,
  money,
  useLoad,
} from "./common";
export function Orders({ agenda, meta, revision, openOrder, globalQuery }) {
  const [q, setQ] = useState(globalQuery || ""),
    [term, setTerm] = useState(q),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [archive, setArchive] = useState(""),
    [day, setDay] = useState(meta.today);
  useEffect(() => {
    setQ(globalQuery || "");
    setPage(1);
  }, [globalQuery]);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const path =
    "/orders?" +
    new URLSearchParams({
      q: term,
      page,
      limit: 25,
      status,
      archive,
      ...(agenda ? { day } : {}),
    });
  const { data, loading, error } = useLoad(path, revision);
  return (
    <>
      <Intro
        title={
          agenda
            ? "Sua agenda, organizada."
            : "Cada atendimento no lugar certo."
        }
        subtitle={
          agenda
            ? "Confira os atendimentos por dia e técnico."
            : "Cadastre, encaminhe e acompanhe as ordens de serviço."
        }
      >
        <button className="primary-button" onClick={() => openOrder()}>
          <Plus size={16} />
          Nova ordem de serviço
        </button>
      </Intro>
      <Panel>
        {agenda ? (
          <div className="zc-filters">
            <label>
              Data do atendimento
              <input
                type="date"
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <button
              className="secondary-button"
              onClick={() => {
                setDay(meta.today);
                setPage(1);
              }}
            >
              Hoje
            </button>
          </div>
        ) : (
          <div className="zc-filters">
            <div className="trace-search">
              <Search size={17} />
              <input
                aria-label="Buscar ordens"
                placeholder="Buscar OS, placa, associado ou técnico…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <select
              aria-label="Situação"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as situações</option>
              {meta.statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              aria-label="Base"
              value={archive}
              onChange={(e) => {
                setArchive(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as bases</option>
              {["HOT", "WARM", "COLD"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        {loading || error ? (
          <Loading error={error} />
        ) : !data.items.length ? (
          <Empty
            description={
              agenda
                ? "Nenhum atendimento nesta data."
                : "Ajuste os filtros ou cadastre uma nova OS."
            }
          />
        ) : (
          <>
            <div className="zc-table-scroll">
              <table className="zc-table zc-responsive-table">
                <thead>
                  <tr>
                    <th>ORDEM / ASSOCIADO</th>
                    <th>VEÍCULO</th>
                    <th>SERVIÇO / TÉCNICO</th>
                    <th>AGENDAMENTO</th>
                    <th>SITUAÇÃO</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((o) => (
                    <tr key={o.id}>
                      <td data-label="Ordem / associado">
                        <button
                          className="zc-link zc-mono"
                          onClick={() => openOrder(o.id)}
                        >
                          {o.id}
                        </button>
                        <small>
                          {o.customer_name || "Associado não informado"}
                        </small>
                      </td>
                      <td data-label="Veículo">
                        <span className="zc-plate">
                          {o.vehicle || "Sem identificação"}
                        </span>
                        {!!o.group_imeis?.length && (
                          <small>
                            IMEI/serial: {o.group_imeis.join(" · ")}
                          </small>
                        )}
                        {o.vehicle_electric && <small>Veículo elétrico</small>}
                      </td>
                      <td data-label="Serviço / técnico">
                        <strong>
                          {o.service_label || o.service || "Não informado"}
                        </strong>
                        <small>{o.technician_name || "Sem técnico"}</small>
                        {o.additional_orders?.map((extra) => (
                          <button
                            className="zc-link"
                            key={extra.id}
                            onClick={() => openOrder(extra.id)}
                          >
                            + {extra.additional_equipment} · {extra.status}
                          </button>
                        ))}
                      </td>
                      <td data-label="Agendamento">
                        <strong>{format(o.scheduled_at, true)}</strong>
                        <small>{o.location || "Local não informado"}</small>
                      </td>
                      <td data-label="Situação">
                        <Badge value={o.group_status || o.status} />
                        {o.group_status && o.group_status !== o.status && (
                          <small>OS principal: {o.status}</small>
                        )}
                        {o.legacy_status &&
                          !meta.statuses.includes(o.legacy_status) && (
                            <small>Legado: {o.legacy_status}</small>
                          )}
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={"Abrir " + o.id}
                          onClick={() => openOrder(o.id)}
                        >
                          <ArrowRight size={16} />
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
    </>
  );
}
export function OrderEditor({
  id,
  meta,
  user,
  refresh,
  onClose,
  navigate,
  openOrder,
}) {
  const [order, setOrder] = useState(null),
    [values, setValues] = useState({
      vehicle: "",
      customer_name: "",
      service: "Instalação",
      status: "PENDENTE",
      technician_id: "",
      scheduled_at: "",
      additional: "",
      tracker_waiver_authorized: false,
      document_data: {
        scheduled_service: "Instalação",
        service_address_same: true,
        equipment_counts: { tracker: 1, tag: 0 },
        reinstallation: false,
        reuse_equipment: false,
        visit_outcome: "",
      },
    }),
    [techs, setTechs] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [action, setAction] = useState(null);
  const admin = ["admin", "operador"].includes(user.papel);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/technicians"),
      id
        ? api.get("/orders/" + encodeURIComponent(id))
        : Promise.resolve({ data: null }),
    ])
      .then(([t, o]) => {
        if (active) {
          setTechs(t.data.items);
          if (o.data) {
            setOrder(o.data);
            setValues(o.data);
          }
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  const change = (e) =>
    setValues((v) => ({
      ...v,
      [e.target.name]:
        e.target.name === "contact"
          ? formatPhone(e.target.value)
          : e.target.value,
    }));
  const documentData = values.document_data || {};
  const equipmentCounts =
    documentData.equipment_counts ||
    [order, ...(order?.additional_orders || [])].filter(Boolean).reduce(
      (counts, item) => {
        for (const key of item.document_data?.equipment ||
          (item.service.startsWith("Instalação") ||
          item.service.startsWith("Reinstalação")
            ? ["tracker"]
            : []))
          counts[key === "tag" ? "tag" : "tracker"]++;
        return counts;
      },
      { tracker: 0, tag: 0 },
    );
  const scheduleType =
    documentData.scheduled_service ||
    (values.service?.startsWith("Reinstalação")
      ? "Instalação"
      : values.service);
  const installation =
    scheduleType === "Instalação" && !documentData.visit_outcome;
  const fipe = classifyFipe({
    value: values.fipe_value,
    vehicleType: documentData.vehicle_type,
    region: documentData.fipe_region,
  });
  const changeDocument = (key, value) =>
    setValues((v) => ({
      ...v,
      document_data: {
        ...v.document_data,
        [key]: value,
        ...(["customer_", "service_"].some((prefix) =>
          addressFields.some(([field]) => key === prefix + field),
        ) && v.document_data?.service_address_same === undefined
          ? {
              service_address_same:
                !order?.location ||
                order.location === order.document_data?.customer_address,
            }
          : {}),
      },
    }));
  const documentField = (label, key, opts = {}) => (
    <Field
      key={key}
      label={label}
      name={"document_" + key}
      value={documentData[key]}
      onChange={(e) => changeDocument(key, e.target.value)}
      {...opts}
    />
  );
  const addressInputs = (prefix) =>
    addressFields.map(([key, label, max]) =>
      documentField(
        label + (prefix === "service" ? " do atendimento" : ""),
        prefix + "_" + key,
        key === "state"
          ? {
              options: [
                ["", "Selecione a UF"],
                ...brazilStates.map((uf) => [uf, uf]),
              ],
            }
          : { maxLength: max },
      ),
    );
  const technician = techs.find(
    (t) => String(t.id) === String(values.technician_id),
  );
  const dirty =
    !!order &&
    [
      "vehicle",
      "customer_name",
      "service",
      "status",
      "technician_id",
      "scheduled_at",
      "contact",
      "chassis",
      "sga_id",
      "fipe_value",
      "volunteer",
      "location",
      "shift",
      "notes",
      "document_data",
      "tracker_waiver_authorized",
    ].some(
      (k) => JSON.stringify(values[k] ?? "") !== JSON.stringify(order[k] ?? ""),
    );
  async function reload() {
    if (!id) return;
    const { data } = await api.get("/orders/" + encodeURIComponent(id));
    setOrder(data);
    setValues(data);
    refresh();
  }
  async function save(e) {
    e.preventDefault();
    const generate = e.nativeEvent?.submitter?.value === "pdf";
    setBusy(true);
    setError("");
    try {
      const fields = [
        "vehicle",
        "customer_name",
        "service",
        "status",
        "technician_id",
        "scheduled_at",
        "additional",
        "contact",
        "chassis",
        "sga_id",
        "fipe_value",
        "volunteer",
        "location",
        "shift",
        "notes",
        "document_data",
        "tracker_waiver_authorized",
        "sga_classification",
        "sga_status",
      ];
      const data = Object.fromEntries(
        fields
          .filter((k) => values[k] !== undefined)
          .map((k) => [k, values[k]]),
      );
      let savedId = id;
      if (id) {
        data.version = order.version;
        await api.patch("/orders/" + encodeURIComponent(id), data);
      } else savedId = (await api.post("/orders", data)).data.id;
      let generated = false;
      if (generate) {
        try {
          await download(
            "/orders/" + encodeURIComponent(savedId) + "/pdf",
            savedId + ".pdf",
          );
          generated = true;
        } catch (error) {
          notify(
            "A OS foi salva. Abra o registro para tentar baixar o PDF novamente: " +
              errorMessage(error),
            "error",
          );
        }
      }
      notify(
        generated
          ? "OS salva e PDF gerado com os dados do agendamento."
          : id
            ? "Ordem de serviço atualizada."
            : "Ordem de serviço criada.",
      );
      refresh();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function lookup() {
    setBusy(true);
    try {
      const { data } = await api.post("/sga/lookup", {
        term: values.vehicle,
        sga_id: values.sga_id,
        chassis: values.chassis,
      });
      setValues((v) => ({
        ...v,
        ...data,
        location: v.location || data.location,
        document_data: { ...v.document_data, ...data.document_data },
      }));
      notify("Cadastro consultado. Confira os campos antes de salvar.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const field = (label, name, opts = {}) => (
    <Field
      key={name}
      label={label}
      name={name}
      value={values[name]}
      onChange={change}
      {...opts}
    />
  );
  return (
    <Modal
      title={id ? "Ordem de serviço" : "Nova ordem de serviço"}
      wide
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <p className="dialog-description">
          {id || "Preencha os dados do atendimento."}
        </p>
        {order?.parent_order_id && (
          <div className="zc-notice">
            <b>OS de equipamento adicional · {order.additional_equipment}</b>
            <p>
              OS principal: {order.parent_order_id}. Conferência e remuneração
              independentes.
            </p>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => openOrder(order.parent_order_id)}
            >
              Abrir OS principal
            </button>
          </div>
        )}
        {!!order?.additional_orders?.length && (
          <div className="zc-notice">
            <b>Equipamentos adicionais deste atendimento</b>
            <p>
              Exibidos junto à OS principal. Cada instalação mantém seu registro
              de serviço e remuneração.
            </p>
            {order.document_data?.equipment_counts ? (
              <p>
                {order.additional_orders.length} instalação(ões) adicional(is)
                para contabilização. O atendimento e o PDF são únicos.
              </p>
            ) : (
              order.additional_orders.map((extra) => (
                <button
                  type="button"
                  className="secondary-button"
                  key={extra.id}
                  disabled={busy}
                  onClick={() => openOrder(extra.id)}
                >
                  {extra.id} · {extra.additional_equipment} · {extra.status}
                </button>
              ))
            )}
          </div>
        )}
        {id && order && (
          <div className="zc-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || dirty}
              title={
                dirty
                  ? "Salve as alterações ou use Salvar e gerar PDF."
                  : "Documento com os dados salvos da OS."
              }
              onClick={() =>
                download(
                  "/orders/" + encodeURIComponent(id) + "/pdf",
                  id + ".pdf",
                ).catch((e) => setError(errorMessage(e)))
              }
            >
              <Download size={15} />
              PDF da OS
            </button>
            {admin && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy || dirty}
                onClick={() =>
                  download(
                    "/orders/" + encodeURIComponent(id) + "/pdf?integral=1",
                    id + "-integral.pdf",
                  ).catch((e) => setError(errorMessage(e)))
                }
              >
                PDF integral
              </button>
            )}
            {!["CONCLUÍDO", "CANCELADO"].includes(order.status) && (
              <>
                {order.workflow_mode !== "controlled" && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setAction("dispatch")}
                  >
                    <Send size={15} />
                    Encaminhar ao técnico
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (order.workflow_mode === "controlled") {
                      onClose();
                      navigate("batches");
                    } else setAction("complete");
                  }}
                >
                  <CheckCheck size={15} />
                  {order.workflow_mode === "controlled"
                    ? "Conferir retorno"
                    : "Concluir"}
                </button>
              </>
            )}
            {admin && order.status === "CONCLUÍDO" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAction("reopen")}
              >
                <RefreshCw size={15} />
                Reabrir
              </button>
            )}
            {admin && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAction("extra")}
              >
                <Wallet size={15} />
                Adicionar valor extra
              </button>
            )}
          </div>
        )}
        {order?.legacy_status &&
          !meta.statuses.includes(order.legacy_status) && (
            <div className="zc-notice amber">
              Situação legada preservada: <b>{order.legacy_status}</b>. Confira
              os dados antes de alterar.
            </div>
          )}
        <fieldset className="zc-fieldset">
          <legend>01 · Veículo e associado</legend>
          <div className="zc-form-grid">
            {field("Placa ou chassi", "vehicle", { required: true })}
            <div className="zc-lookup">
              <span>Consulta do cadastro</span>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={lookup}
              >
                <Search size={15} />
                Consultar SGA
              </button>
            </div>
            {field("Associado", "customer_name", { required: true })}
            {field("Contato", "contact", {
              type: "tel",
              autoComplete: "tel-national",
              maxLength: 20,
            })}
            {documentField("CPF / CNPJ", "cpf_cnpj")}
            {documentField("RG", "rg")}
            <div className="zc-full">
              <b>Endereço do associado</b>
              {documentData.customer_address &&
                !documentData.customer_street && (
                  <small className="zc-muted">
                    Endereço anterior: {documentData.customer_address}. Preencha
                    os campos abaixo para atualizar.
                  </small>
                )}
            </div>
            {addressInputs("customer")}
            {field("Chassi", "chassis")}
            {documentField("Renavam", "renavam")}
            {documentField("Marca", "brand")}
            {documentField("Modelo", "model")}
            {documentField("Ano de fabricação/modelo", "year")}
            {documentField("Tipo de veículo", "vehicle_type", {
              options: [
                ["", "Selecione o tipo"],
                ["Automóvel", "Automóvel"],
                ["Moto", "Moto"],
                ["Outro", "Outro tipo de veículo"],
                ...(documentData.vehicle_type &&
                !["Automóvel", "Moto", "Outro"].includes(
                  documentData.vehicle_type,
                )
                  ? [[documentData.vehicle_type, documentData.vehicle_type]]
                  : []),
              ],
            })}
            {documentField("Categoria", "category")}
            {field("Código do veículo SGA", "sga_id")}
            {field("Valor FIPE", "fipe_value")}
            {documentField("Regra regional FIPE", "fipe_region", {
              options: [["", "Selecione a regra regional"], ...fipeRegions],
            })}
            <label className="zc-fipe-result zc-full">
              Tipo FIPE (automático)
              <output aria-live="polite">
                {fipe.label || "Não classificado"}
              </output>
              <small>{fipe.message}</small>
              {!!order?.fipe_risk && fipe.status !== "classified" && (
                <small>
                  Registro anterior: {order.fipe_risk}. Informe os dados de
                  classificação para atualizar.
                </small>
              )}
            </label>
            {field("Voluntário", "volunteer")}
            <div className="zc-full zc-document-equipment">
              <label className="zc-checkbox">
                <input
                  type="checkbox"
                  checked={documentData.vehicle_electric === true}
                  onChange={(e) =>
                    changeDocument("vehicle_electric", e.target.checked)
                  }
                />
                Veículo elétrico
              </label>
              {documentData.vehicle_electric === true && (
                <small>
                  Confirme com o cliente a autorização para instalar o
                  rastreador. Se houver impedimento, registre as observações e a
                  autorização de dispensa correspondente.
                </small>
              )}
            </div>
          </div>
        </fieldset>
        <fieldset className="zc-fieldset">
          <legend>02 · Atendimento e responsável</legend>
          <div className="zc-form-grid">
            <Field
              label="Serviço"
              name="service"
              value={scheduleType}
              disabled={!!order?.parent_order_id}
              options={[
                ...schedulingServices,
                ...(scheduleType && !schedulingServices.includes(scheduleType)
                  ? [scheduleType]
                  : []),
              ].map((service) => [service, service])}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  service: e.target.value,
                  document_data: {
                    ...v.document_data,
                    scheduled_service: e.target.value,
                    equipment_counts:
                      e.target.value === "Instalação"
                        ? v.document_data?.equipment_counts?.tracker +
                            v.document_data?.equipment_counts?.tag >
                          0
                          ? v.document_data.equipment_counts
                          : { tracker: 1, tag: 0 }
                        : { tracker: 0, tag: 0 },
                    reinstallation: false,
                    reuse_equipment: false,
                    visit_outcome: "",
                  },
                }))
              }
            />
            {documentField("Sinalização do atendimento", "visit_outcome", {
              options: [
                ["", "Atendimento previsto"],
                ["unproductive", "Visita improdutiva"],
                ["reschedule", "Reagendamento"],
              ],
            })}
            {scheduleType === "Instalação" && (
              <div className="zc-full zc-document-equipment">
                <label className="zc-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      documentData.reinstallation ??
                      values.service?.startsWith("Reinstalação")
                    }
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        document_data: {
                          ...v.document_data,
                          scheduled_service: "Instalação",
                          reinstallation: e.target.checked,
                          reuse_equipment: false,
                        },
                      }))
                    }
                  />
                  Reinstalação
                </label>
                {(documentData.reinstallation ??
                  values.service?.startsWith("Reinstalação")) && (
                  <label className="zc-checkbox">
                    <input
                      type="checkbox"
                      checked={documentData.reuse_equipment === true}
                      onChange={(e) =>
                        changeDocument("reuse_equipment", e.target.checked)
                      }
                    />
                    Reaproveitar os equipamentos existentes
                  </label>
                )}
                {(documentData.reinstallation ??
                  values.service?.startsWith("Reinstalação")) && (
                  <small>
                    {documentData.reuse_equipment
                      ? "A central conferirá as fotos dos equipamentos existentes. O reaproveitamento não consome novos aparelhos da carga."
                      : "Serão utilizados equipamentos da carga do técnico."}
                  </small>
                )}
              </div>
            )}
            {field("Técnico", "technician_id", {
              options: [
                ["", "Ainda não definido"],
                ...techs
                  .filter((t) => t.active || t.id === order?.technician_id)
                  .map((t) => [t.id, t.name]),
              ],
            })}
            {field("Data e horário", "scheduled_at", {
              type: "datetime-local",
            })}
            {field("Turno", "shift", {
              options: [
                ["", "Não definido"],
                ["Manhã", "Manhã"],
                ["Tarde", "Tarde"],
                ["Noite", "Noite"],
              ],
            })}
            {field("Situação", "status", {
              options: meta.statuses
                .filter((s) => s !== "CONCLUÍDO" || order?.status === s)
                .map((s) => [s, s]),
              disabled: order?.status === "CONCLUÍDO",
            })}
            <div className="zc-full zc-document-equipment">
              <label className="zc-checkbox">
                <input
                  type="checkbox"
                  checked={values.tracker_waiver_authorized === true}
                  disabled={order?.status === "CONCLUÍDO"}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      tracker_waiver_authorized: e.target.checked,
                    }))
                  }
                />
                Dispensa de rastreador autorizada
              </label>
              <small>
                Cliente autorizado a permanecer sem rastreador. Esta OS não
                entra na remuneração nem no fechamento do técnico, incluindo
                adicionais e ajustes. A conclusão exige checklist assinado e
                conferência da central, sem registrar instalação no estoque.
              </small>
            </div>
            <div className="zc-full zc-document-equipment">
              <b>Endereço do atendimento</b>
              <label className="zc-checkbox">
                <input
                  type="checkbox"
                  checked={
                    documentData.service_address_same ??
                    (!order?.location ||
                      order.location === documentData.customer_address)
                  }
                  onChange={(e) =>
                    changeDocument("service_address_same", e.target.checked)
                  }
                />
                Atendimento no endereço do associado
              </label>
              {documentData.service_address_same === undefined &&
                order?.location && (
                  <small>Local anterior: {order.location}</small>
                )}
            </div>
            {(documentData.service_address_same === false ||
              (documentData.service_address_same === undefined &&
                order?.location &&
                order.location !== documentData.customer_address)) &&
              addressInputs("service")}
            {installation && !values.tracker_waiver_authorized && (
              <div className="zc-full zc-document-equipment">
                <b>Quantidade de equipamentos a instalar</b>
                <div className="zc-equipment-quantities">
                  {[
                    ["tracker", "Rastreadores"],
                    ["tag", "TAGs"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        max="20"
                        step="1"
                        value={equipmentCounts[key]}
                        disabled={!!order?.parent_order_id}
                        onChange={(e) =>
                          changeDocument("equipment_counts", {
                            ...equipmentCounts,
                            [key]:
                              e.target.value === ""
                                ? 0
                                : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <small>
                  {equipmentCounts.tracker + equipmentCounts.tag}{" "}
                  equipamento(s): 1 serviço principal e{" "}
                  {Math.max(
                    0,
                    equipmentCounts.tracker + equipmentCounts.tag - 1,
                  )}{" "}
                  instalação(ões) adicional(is), conforme as tarifas do técnico.
                  Todas as fotos e equipamentos são registrados na mesma OS e no
                  mesmo PDF.
                </small>
              </div>
            )}
            {field("Observações da central", "notes", {
              type: "textarea",
              full: true,
            })}
          </div>
        </fieldset>
        {order && (
          <section className="zc-detail-section">
            <h3>Retorno do técnico</h3>
            <p>
              Os IMEIs/seriais aparecem após o envio para validação no ZenField.
            </p>
            {(order.document_data?.equipment_counts
              ? [order]
              : [order, ...(order.additional_orders || [])]
            ).map((item) => (
              <div className="zc-return" key={item.id}>
                <b>
                  {item.parent_order_id
                    ? `Equipamento adicional · ${item.additional_equipment}`
                    : "Equipamentos da OS principal"}
                </b>
                <p>
                  {item.reported_imeis?.length
                    ? item.reported_imeis.join(" · ")
                    : item.imei_submitted_at
                      ? "Nenhum equipamento instalado neste envio"
                      : "Aguardando envio do técnico"}
                </p>
                {item.imei_submission_state === "rejected" && (
                  <small>
                    Envio devolvido para correção. Aguarde nova validação.
                  </small>
                )}
                <label className="zc-field">
                  Observações do técnico
                  <textarea
                    readOnly
                    aria-label="Observações do técnico"
                    rows={3}
                    value={item.technician_notes || ""}
                    placeholder="Preenchidas pelo técnico no ZenField"
                  />
                </label>
              </div>
            ))}
          </section>
        )}
        {order?.audit_summary && (
          <section className="zc-detail-section">
            <h3>Responsáveis pela OS</h3>
            <div className="zc-audit-summary">
              {[
                [
                  "Abertura",
                  order.audit_summary.opened_by,
                  order.audit_summary.opened_at,
                ],
                [
                  "Baixa",
                  order.audit_summary.closed_by || "Aguardando conclusão",
                  order.audit_summary.closed_at,
                ],
                [
                  "Última modificação",
                  order.audit_summary.last_modified_by,
                  order.audit_summary.last_modified_at,
                ],
              ].map(([label, name, at]) => (
                <div key={label}>
                  <small>{label}</small>
                  <b>{name}</b>
                  {at && <small>{format(at, at.includes("T"))}</small>}
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="zc-notice zc-document-notice">
          <b>Preenchimento automático do PDF</b>
          <span>
            {values.service || "Serviço pendente"} ·{" "}
            {technician?.name || "Técnico pendente"} ·{" "}
            {values.scheduled_at
              ? format(values.scheduled_at, true)
              : "Agendamento pendente"}
          </span>
          <small>
            O documento usa os dados salvos desta OS. CPF/CNPJ, RG, Renavam e
            parte do nome ficam ocultos na versão padrão.
          </small>
        </div>
        {order?.completed_at && (
          <div className="zc-notice">
            Concluída em {format(order.completed_at)} por{" "}
            {order.closed_by || "Operação legada"}.
          </div>
        )}
        {order?.sga_classification && (
          <div className="zc-notice">
            SGA: {order.sga_classification} ·{" "}
            {order.sga_status || "Situação não informada"}
          </div>
        )}
        {!!order?.jobs?.length && (
          <div className="zc-detail-section">
            <h3>Envios e integrações</h3>
            {order.jobs.map((j) => (
              <div className="zc-info-row" key={j.id}>
                <div>
                  <b>{jobLabel(j.kind)}</b>
                  <small>{j.last_error || format(j.created_at, true)}</small>
                </div>
                <Badge value={j.state} />
              </div>
            ))}
          </div>
        )}
        {!!order?.extras?.length && (
          <div className="zc-detail-section">
            <h3>Valores adicionais</h3>
            {order.extras.map((x) => (
              <div className="zc-info-row" key={x.id}>
                <div>
                  <b>{x.type}</b>
                  <small>{x.description}</small>
                </div>
                <strong>{money(x.amount_cents)}</strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remover adicional"
                  onClick={async () => {
                    if (await confirmAction("Remover este valor adicional?"))
                      try {
                        await api.delete("/extras/" + x.id);
                        await reload();
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        {!!order?.history?.length && (
          <div className="zc-detail-section">
            <h3>Histórico desta OS</h3>
            {order.history.map((a) => (
              <div className="zc-timeline" key={a.id}>
                <i />
                <div>
                  <b>{actionLabel(a.action)}</b>
                  <small>
                    {a.actor} · {format(a.created_at, true)}
                  </small>
                  {a.order_id !== order.id && (
                    <small>Equipamento adicional · {a.order_id}</small>
                  )}
                  {a.detail?.changes && (
                    <details>
                      <summary>Ver alterações</summary>
                      {Object.entries(a.detail.changes).map(([key, change]) => (
                        <div key={key} className="zc-audit-change">
                          <b>{auditFieldLabel(key)}</b>
                          <span>
                            {auditValue(change.before)} →{" "}
                            {auditValue(change.after)}
                          </span>
                        </div>
                      ))}
                    </details>
                  )}
                  {a.detail?.reason && <small>{a.detail.reason}</small>}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          {admin && id && (
            <button
              type="button"
              className="danger-button"
              onClick={() => setAction("delete")}
            >
              Arquivar
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="secondary-button"
            type="submit"
            name="intent"
            value="pdf"
            disabled={busy || (!!id && !order)}
          >
            Salvar e gerar PDF
          </button>
          <button
            className="primary-button"
            disabled={busy || (!!id && !order)}
          >
            {busy
              ? "Salvando…"
              : id
                ? "Salvar alterações"
                : "Criar ordem de serviço"}
          </button>
        </div>
      </form>
      {action && (
        <FormModal
          key={action}
          title={
            {
              dispatch: "Encaminhar ao técnico",
              complete: "Concluir atendimento",
              reopen: "Reabrir ordem",
              extra: "Adicionar valor extra",
              delete: "Arquivar registro",
            }[action]
          }
          description={
            action === "dispatch"
              ? "A OS será colocada na fila de envio. Confira o técnico e o agendamento salvos."
              : action === "delete"
                ? "O registro sai da listagem; seu histórico permanece preservado."
                : ""
          }
          initial={action === "dispatch" ? { masked: true } : {}}
          fields={
            action === "dispatch"
              ? admin
                ? [
                    {
                      name: "masked",
                      label:
                        "Ocultar CPF/CNPJ, RG, Renavam e parte do nome no PDF",
                      type: "checkbox",
                    },
                  ]
                : []
              : action === "extra"
                ? [
                    { name: "type", label: "Tipo", required: true },
                    {
                      name: "amount",
                      label: "Valor (R$)",
                      type: "number",
                      required: true,
                    },
                    {
                      name: "description",
                      label: "Descrição",
                      type: "textarea",
                      full: true,
                    },
                  ]
                : [
                    {
                      name: "reason",
                      label: "Motivo / evidência",
                      type: "textarea",
                      full: true,
                      required: true,
                    },
                  ]
          }
          onClose={() => setAction(null)}
          onSave={async (data) => {
            const base = "/orders/" + encodeURIComponent(id);
            if (action === "extra") await api.post(base + "/extras", data);
            else if (action === "delete")
              await api.delete(base, {
                data: { ...data, version: order.version },
              });
            else
              await api.post(base + "/" + action, {
                ...data,
                version: order.version,
              });
            setAction(null);
            if (action === "delete") {
              refresh();
              onClose();
            } else await reload();
            notify(
              action === "dispatch"
                ? "Envio adicionado à fila."
                : "Operação registrada.",
            );
          }}
        />
      )}
    </Modal>
  );
}
export const jobLabel = (k) =>
  ({
    dispatch: "Envio ao técnico",
    sga_classification: "Classificação SGA",
    download_evidence: "Download de fotos",
    stock_installation: "Confirmar instalação no Estoque Pro",
    upload_evidence: "Fotos para o SGA",
  })[k] || k;
export const actionLabel = (k) =>
  ({
    created: "Registro criado",
    updated: "Registro atualizado",
    completed: "OS concluída",
    dispatched: "OS enviada ao técnico",
    dispatch_queued: "Envio adicionado à fila",
    saved: "Cadastro atualizado",
    evidence_ready: "Fotos recebidas",
    approved: "Lote aprovado",
    legacy_import: "Dados legados importados",
    settled: "Fechamento registrado",
    deleted: "Registro arquivado",
    reopened: "OS reaberta",
    portal_draft: "Registro iniciado pelo técnico",
    portal_draft_updated: "Rascunho atualizado",
    portal_photo_added: "Evidência recebida",
    portal_photo_removed: "Evidência removida",
    portal_submitted: "Técnico enviou para validação",
    portal_approved: "Envio técnico aprovado",
    portal_correction_requested: "Correção solicitada",
    execution_finished: "Execução finalizada pelo técnico",
    conference_started: "Conferência iniciada",
    approved_for_stock: "Instalação aprovada",
    stock_installation_confirmed: "Instalação confirmada no estoque",
    additional_order_created: "Equipamento adicional incluído",
    operational_service_created: "Bloqueio operacional registrado",
    operational_service_updated: "Bloqueio operacional atualizado",
  })[k] || k.replaceAll("_", " ");
const auditFieldLabel = (key) =>
  ({
    vehicle: "Veículo",
    customer_name: "Associado",
    service: "Serviço",
    status: "Situação",
    technician_id: "Código do técnico",
    technician_name: "Técnico",
    fipe_value: "Valor FIPE",
    fipe_risk: "Tipo FIPE",
    notes: "Observações da central",
    document_data: "Dados do veículo e documento",
    scheduled_at: "Agendamento",
    tracker_waiver_authorized: "Dispensa de rastreador",
    vehicle_electric: "Veículo elétrico",
    fipe_region: "Regra regional FIPE",
    vehicle_type: "Tipo de veículo",
    equipment: "Equipamentos",
  })[key] || key;
const auditValue = (value) =>
  value == null || value === ""
    ? "Não informado"
    : typeof value === "boolean"
      ? value
        ? "Sim"
        : "Não"
      : typeof value === "object"
        ? Object.entries(value)
            .map(
              ([key, entry]) =>
                `${auditFieldLabel(key)}: ${Array.isArray(entry) ? entry.join(", ") : String(entry)}`,
            )
            .join("; ")
        : String(value);
export function Technicians({ user, revision, refresh }) {
  const { data: catalog } = useLoad(
    ["admin", "operador"].includes(user.papel) ? "/stock/catalog" : "/meta",
    revision,
  );
  const admin = ["admin", "operador"].includes(user.papel);
  const [access, setAccess] = useState(null);
  const { data, loading, error } = useLoad("/technicians", revision);
  const [showInactive, setShowInactive] = useState(false),
    [edit, setEdit] = useState(null),
    [q, setQ] = useState("");
  const prices = [
    "price_install",
    "price_maintenance",
    "price_removal",
    "price_visit",
  ];
  const list = (data?.items || []).filter(
    (t) =>
      (showInactive || t.active) &&
      t.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
  );
  return (
    <>
      <Intro
        title="Sua equipe, conectada."
        subtitle="Distribua serviços e gerencie o acesso individual ao ZenField."
      >
        <button
          className="secondary-button"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Somente ativos" : "Ver inativos"}
        </button>
        {admin && (
          <button className="primary-button" onClick={() => setEdit({})}>
            <Plus size={16} />
            Cadastrar técnico
          </button>
        )}
      </Intro>
      <div className="trace-search zc-standalone-search">
        <Search size={17} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar técnico…"
          aria-label="Buscar técnico"
        />
      </div>
      {loading || error ? (
        <Loading error={error} />
      ) : !list.length ? (
        <Empty description="Cadastre os técnicos para organizar os atendimentos." />
      ) : (
        <div className="zc-cards">
          {list.map((t) => (
            <article className="dashboard-panel zc-tech-card" key={t.id}>
              <div className="zc-tech-heading">
                <span className="avatar">{initials(t.name)}</span>
                <div>
                  <h3>{t.name}</h3>
                  <p>{t.tags || "Técnico de campo"}</p>
                </div>
                {!t.active && <Badge value="Inativo" />}
              </div>
              <p>
                <Phone size={14} />
                {t.phone || "Telefone não informado"}
              </p>
              <p>
                <MapPin size={14} />
                {t.address || "Região não informada"}
              </p>
              <p>
                <Send size={14} />
                ZenField · notificações internas
              </p>
              {admin && t.active && (
                <button
                  className="secondary-button"
                  onClick={async () => {
                    if (
                      !(await confirmAction(
                        "Gerar novo código de ativação? As sessões deste acesso serão encerradas.",
                      ))
                    )
                      return;
                    try {
                      const { data } = await api.post(
                        "/technicians/" + t.id + "/activation",
                      );
                      setAccess(data);
                    } catch (e) {
                      notify(errorMessage(e), "error");
                    }
                  }}
                >
                  Gerar código de acesso ZenField
                </button>
              )}
              <div className="zc-tech-footer">
                <span>
                  {admin ? (
                    <>
                      Instalação <b>{money(t.price_install)}</b>
                    </>
                  ) : t.active ? (
                    "Cadastro ativo"
                  ) : (
                    "Cadastro inativo"
                  )}
                </span>
                {admin && (
                  <button
                    className="secondary-button"
                    onClick={() =>
                      setEdit({
                        ...t,
                        ...Object.fromEntries(
                          prices.map((k) => [k, (t[k] / 100).toFixed(2)]),
                        ),
                      })
                    }
                  >
                    Gerenciar
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {access && (
        <Modal
          title="Acesso individual ao ZenField"
          onClose={() => setAccess(null)}
        >
          <div className="eco-card">
            <p>
              Entregue estes dados ao técnico por um canal administrativo
              verificado.
            </p>
            <p>
              Login: <strong>{access.login}</strong>
            </p>
            <p>
              Senha provisória: <strong>{access.temporary_password}</strong>
            </p>
            <p>
              Código de uso único:{" "}
              <strong style={{ overflowWrap: "anywhere" }}>
                {access.code}
              </strong>
            </p>
            <p>
              Válido até {new Date(access.expires_at).toLocaleString("pt-BR")}.
              O código só é mostrado nesta emissão.
            </p>
            <p>
              No ZenField, marque “Primeiro acesso ou redefinição” e cadastre
              uma nova senha de pelo menos 8 caracteres, com maiúscula,
              minúscula, número e símbolo.
            </p>
            <button className="primary-button" onClick={() => setAccess(null)}>
              Concluir
            </button>
          </div>
        </Modal>
      )}
      {edit && (
        <FormModal
          title={edit.id ? "Editar técnico" : "Cadastrar técnico"}
          wide
          initial={{ active: true, ...edit }}
          fields={[
            { name: "name", label: "Nome", required: true, full: true },
            { name: "phone", label: "Telefone com DDI e DDD" },
            {
              name: "stock_technician_id",
              label: "Cadastro correspondente no Estoque Pro",
              full: true,
              options: [
                ["", "Sem vínculo"],
                ...(catalog?.technicians || []).map((t) => [t.id, t.nome]),
                ...(edit.stock_technician_id &&
                !catalog?.technicians?.some(
                  (t) => t.id === edit.stock_technician_id,
                )
                  ? [
                      [
                        edit.stock_technician_id,
                        "Vínculo atual (conecte o Estoque Pro para conferir)",
                      ],
                    ]
                  : []),
              ],
            },
            { name: "tags", label: "Habilidades / tags" },
            { name: "address", label: "Endereço / região base", full: true },
            ...prices.map((k, i) => ({
              name: k,
              label: [
                "Instalação (R$)",
                "Manutenção (R$)",
                "Retirada (R$)",
                "Visita / improdutiva (R$)",
              ][i],
              type: "number",
            })),
            { name: "active", label: "Técnico ativo", type: "checkbox" },
          ]}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            const payload = Object.fromEntries(
              [
                "name",
                "phone",
                "stock_technician_id",
                "tags",
                "address",
                "active",
                ...prices,
              ]
                .filter((k) => v[k] !== undefined)
                .map((k) => [k, v[k]]),
            );
            if (edit.id)
              await api.patch("/technicians/" + edit.id, {
                ...payload,
                version: edit.version,
              });
            else {
              const { data } = await api.post("/technicians", payload);
              setAccess(data.access);
            }
            setEdit(null);
            refresh();
            notify("Cadastro do técnico salvo.");
          }}
        />
      )}
    </>
  );
}
export function Volunteers({ user, revision, refresh }) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState(false);
  const { data, loading, error } = useLoad(
    "/volunteers?" + new URLSearchParams({ q, page, limit: 25 }),
    revision,
  );
  return (
    <>
      <Intro
        title="Vínculos dos associados."
        subtitle="Mantenha os voluntários e seus códigos SGA organizados."
      >
        <button className="primary-button" onClick={() => setEdit(true)}>
          <Plus size={16} />
          Cadastrar voluntário
        </button>
      </Intro>
      <Panel>
        <div className="zc-filters">
          <div className="trace-search">
            <Search size={17} />
            <input
              placeholder="Buscar nome ou código SGA…"
              aria-label="Buscar voluntários"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {loading || error ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="zc-table-scroll">
              <table className="zc-table">
                <thead>
                  <tr>
                    <th>VOLUNTÁRIO</th>
                    <th>CÓDIGO SGA</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <strong>{v.name}</strong>
                      </td>
                      <td>{v.sga_code || "Não informado"}</td>
                      <td>
                        {["admin", "operador"].includes(user.papel) && (
                          <button
                            className="icon-button"
                            aria-label={"Remover " + v.name}
                            onClick={async () => {
                              if (
                                await confirmAction(
                                  "Remover este vínculo? O histórico das ordens permanece preservado.",
                                )
                              )
                                try {
                                  await api.delete("/volunteers/" + v.id);
                                  refresh();
                                } catch (e) {
                                  notify(errorMessage(e), "error");
                                }
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && <Empty />}
            <Pager data={data} onPage={setPage} />
          </>
        )}
      </Panel>
      {edit && (
        <FormModal
          title="Cadastrar voluntário"
          fields={[
            { name: "name", label: "Nome", required: true, full: true },
            { name: "sga_code", label: "Código no SGA", full: true },
          ]}
          onClose={() => setEdit(false)}
          onSave={async (v) => {
            await api.post("/volunteers", v);
            setEdit(false);
            refresh();
            notify("Voluntário cadastrado.");
          }}
        />
      )}
    </>
  );
}
export function UsersPage({ revision, refresh }) {
  const { data: technicians } = useLoad("/technicians", revision);
  const { data, loading, error } = useLoad("/users", revision),
    [edit, setEdit] = useState(null);
  return (
    <>
      <Intro
        title="Equipe e permissões."
        subtitle="Os acessos seguem o mesmo padrão do Estoque Pro."
      >
        <button className="primary-button" onClick={() => setEdit({})}>
          <Plus size={16} />
          Adicionar pessoa
        </button>
      </Intro>
      <Panel>
        {loading || error ? (
          <Loading error={error} />
        ) : (
          <div className="zc-table-scroll">
            <table className="zc-table">
              <thead>
                <tr>
                  <th>PESSOA</th>
                  <th>USUÁRIO</th>
                  <th>PERFIL</th>
                  <th>ACESSO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="zc-person">
                        <span className="avatar">{initials(u.nome)}</span>
                        <strong>{u.nome}</strong>
                      </div>
                    </td>
                    <td>{u.login}</td>
                    <td>
                      {u.papel === "admin"
                        ? "Administrador"
                        : u.papel === "tecnico"
                          ? "Técnico"
                          : "Operador"}
                    </td>
                    <td>
                      <Badge value={u.ativo ? "approved" : "CANCELADO"} />
                    </td>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => setEdit(u)}
                      >
                        Gerenciar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {edit && (
        <FormModal
          title={edit.id ? "Editar acesso" : "Adicionar pessoa"}
          description={passwordRequirements}
          initial={{ ativo: true, papel: "operador", ...edit }}
          fields={[
            { name: "nome", label: "Nome", required: true },
            { name: "login", label: "Usuário", required: true },
            {
              name: "papel",
              label: "Perfil",
              options: [
                ["operador", "Operador"],
                ["admin", "Administrador"],
                ["tecnico", "Técnico"],
              ],
            },
            {
              name: "technician_id",
              label: "Cadastro do técnico (obrigatório no perfil Técnico)",
              options: [
                ["", "Selecione o técnico"],
                ...(technicians?.items || [])
                  .filter((t) => t.active)
                  .map((t) => [t.id, t.name]),
              ],
              full: true,
            },
            {
              name: "password",
              ...passwordInputProps,
              title: passwordRequirements,
              label: edit.id ? "Nova senha (opcional)" : "Senha inicial",
              type: "password",
              required: !edit.id,
            },
            { name: "ativo", label: "Acesso ativo", type: "checkbox" },
          ]}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            const payload = {
              nome: v.nome,
              login: v.login,
              papel: v.papel,
              technician_id: v.technician_id,
              ativo: v.ativo,
              ...(v.password ? { password: v.password } : {}),
            };
            if (edit.id) await api.patch("/users/" + edit.id, payload);
            else await api.post("/users", payload);
            setEdit(null);
            refresh();
            notify("Acesso salvo.");
          }}
        />
      )}
    </>
  );
}
