import { useEffect, useState } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { api, errorMessage } from "@zen/ui/lib/api";
export { api, errorMessage };
export const money = (n) =>
  (Number(n || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
export function format(value, time = false) {
  if (!value) return "A combinar";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(
    "pt-BR",
    time
      ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "2-digit", year: "numeric" },
  );
}
export const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase();
export function Badge({ value }) {
  const map = {
    PENDENTE: ["amber", "Pendente"],
    AGENDADO: ["blue", "Agendado"],
    "EM EXECUÇÃO": ["violet", "Em execução"],
    "AGUARDANDO VALIDAÇÃO": ["violet", "Aguardando validação"],
    CONCLUÍDO: ["mint", "Concluído"],
    CANCELADO: ["gray", "Cancelado"],
    REAGENDAR: ["red", "Reagendar"],
    "AGUARDANDO ESTOQUE": ["amber", "Confirmando estoque"],
    "CORREÇÃO SOLICITADA": ["red", "Correção solicitada"],
    draft: ["gray", "Rascunho"],
    submitted: ["violet", "Aguardando central"],
    approved_sync: ["amber", "Confirmando estoque"],
    stock_failed: ["red", "Estoque recusou"],
    rejected: ["red", "Correção solicitada"],
    withdrawn: ["gray", "Rascunho descartado"],
    pending: ["amber", "Na fila"],
    running: ["blue", "Em execução"],
    succeeded: ["mint", "Confirmado"],
    failed: ["red", "Falhou"],
    uncertain: ["violet", "Conferir envio"],
    downloading: ["blue", "Baixando fotos"],
    needs_review: ["amber", "Conferência necessária"],
    ready: ["blue", "Pronto para validar"],
    approved: ["mint", "Aprovado"],
    completed: ["mint", "Concluído"],
  };
  const [color, label] = map[value] || ["gray", value];
  return (
    <span className={"zc-badge " + color}>
      <i />
      {label}
    </span>
  );
}
export function useLoad(path, revision = 0) {
  const [state, set] = useState({ data: null, loading: true, error: "" });
  useEffect(() => {
    let active = true;
    set((s) => ({ ...s, loading: true, error: "" }));
    api
      .get(path)
      .then((r) => {
        if (active) set({ data: r.data, loading: false, error: "" });
      })
      .catch((e) => {
        if (active) set({ data: null, loading: false, error: errorMessage(e) });
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return state;
}
export function Panel({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={"dashboard-panel " + className}>
      {title && (
        <div className="panel-heading">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Intro({ title, subtitle, children }) {
  return (
    <div className="page-intro">
      <div>
        <span className="eyebrow">ZENCONTROL</span>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="page-intro-actions">{children}</div>
    </div>
  );
}
export function Empty({
  title = "Nenhum registro encontrado",
  description = "Os dados aparecerão aqui quando estiverem disponíveis.",
  children,
}) {
  return (
    <div className="zc-empty">
      <ClipboardList size={32} />
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Loading({ error }) {
  return error ? (
    <div className="error-banner" role="alert">
      {error}
    </div>
  ) : (
    <div className="loading-card" role="status">
      <RefreshCw className="zc-spin" size={18} /> Carregando operação…
    </div>
  );
}
export function Pager({ data, onPage }) {
  return (
    <div className="table-pagination">
      <span>
        {data.total
          ? `${(data.page - 1) * data.limit + 1}–${Math.min(data.page * data.limit, data.total)} de ${data.total}`
          : "Nenhum registro"}
      </span>
      <div>
        <button
          className="secondary-button"
          disabled={data.page <= 1}
          onClick={() => onPage(data.page - 1)}
        >
          Anterior
        </button>
        <button
          className="secondary-button"
          disabled={data.page * data.limit >= data.total}
          onClick={() => onPage(data.page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
export async function download(path, filename) {
  const r = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function Field({
  label,
  name,
  value,
  onChange,
  options,
  type = "text",
  required = false,
  full = false,
  disabled = false,
  rows = 3,
}) {
  return (
    <label className={full ? "zc-full" : ""}>
      {label}
      {type === "textarea" ? (
        <textarea
          name={name}
          value={value ?? ""}
          onChange={onChange}
          rows={rows}
          maxLength={6000}
        />
      ) : options ? (
        <select
          name={name}
          value={value ?? ""}
          onChange={onChange}
          disabled={disabled}
          required={required}
        >
          {options.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={name}
          type={type}
          value={value ?? ""}
          onChange={onChange}
          required={required}
          disabled={disabled}
          autoComplete={type === "password" ? "new-password" : undefined}
          min={type === "number" ? 0 : undefined}
          step={type === "number" ? "0.01" : undefined}
        />
      )}
    </label>
  );
}
export function FormModal({
  title,
  description,
  initial = {},
  fields,
  onSave,
  onClose,
  submit = "Salvar",
  wide = false,
  children,
}) {
  const [values, set] = useState(initial),
    [busy, b] = useState(false),
    [error, e] = useState("");
  const change = (event) =>
    set((s) => ({
      ...s,
      [event.target.name]:
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value,
    }));
  async function save(event) {
    event.preventDefault();
    b(true);
    e("");
    try {
      await onSave(values);
    } catch (err) {
      e(errorMessage(err));
    } finally {
      b(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} busy={busy} wide={wide}>
      <form onSubmit={save}>
        {description && <p className="dialog-description">{description}</p>}
        <div className="zc-form-grid">
          {fields.map((f) =>
            f.type === "checkbox" ? (
              <label key={f.name} className="zc-checkbox zc-full">
                <input
                  type="checkbox"
                  name={f.name}
                  checked={!!values[f.name]}
                  onChange={change}
                />
                {f.label}
              </label>
            ) : (
              <Field
                key={f.name}
                {...f}
                value={values[f.name]}
                onChange={change}
              />
            ),
          )}
        </div>
        {children}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Salvando…" : submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
