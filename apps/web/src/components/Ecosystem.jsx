import { useState, useEffect, useRef, useId, cloneElement } from "react";
import {
  Bell,
  RefreshCw,
  Download,
  Check,
  Package,
  Wallet,
  CalendarDays,
} from "lucide-react";
import { api, errorMessage } from "@zen/ui/lib/api";
import "./ecosystem.css";
const brl = (n) =>
  ((n || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const services = [
  "Instalação",
  "Manutenção",
  "Retirada",
  "Reinstalação",
  "Improdutiva",
  "Visita",
];
const states = {
  legacy_unverified: "Histórico a conferir",
  no_payment_due: "Sem valor a pagar",
  cancelled: "Cancelado",
  pending: "Aguardando decisão",
  approved: "Aprovado",
  rejected: "Rejeitado",
  information_requested: "Informações solicitadas",
  counteroffer: "Contraproposta aguardando aceite",
  draft: "Em conferência",
  awaiting_payment: "Aguardando pagamento",
  partial: "Pagamento parcial",
  paid: "Quitado",
  awaiting_approval: "Aguardando aprovação",
};
const stockActions = {
  replenishment: "Reposição",
  receipt: "Recebimento",
  return: "Devolução",
  transfer: "Transferência",
};
function useData(path, revision = 0) {
  const [state, set] = useState({ path, data: null, error: "", loading: true });
  useEffect(() => {
    let active = true;
    set((x) =>
      x.path === path
        ? { ...x, error: "", loading: true }
        : { path, data: null, error: "", loading: true },
    );
    api
      .get(path)
      .then(
        (r) => active && set({ path, data: r.data, error: "", loading: false }),
      )
      .catch(
        (e) =>
          active &&
          set({ path, data: null, error: errorMessage(e), loading: false }),
      );
    return () => {
      active = false;
    };
  }, [path, revision]);
  return state.path === path ? state : { data: null, error: "", loading: true };
}
function Field({ label, children, ...props }) {
  const id = useId();
  return (
    <div className="eco-field">
      <label htmlFor={id}>{label}</label>
      {children ? cloneElement(children, { id }) : <input id={id} {...props} />}
    </div>
  );
}
function ErrorLine({ error }) {
  return error ? (
    <p className="error-banner" role="alert">
      {error}
    </p>
  ) : null;
}
function Loader({ state }) {
  return state.error ? (
    <ErrorLine error={state.error} />
  ) : state.loading ? (
    <p role="status">Carregando…</p>
  ) : null;
}
async function download(path, name) {
  const r = await api.get(path, { responseType: "blob" }),
    url = URL.createObjectURL(r.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function NoticeBell({ onOpen }) {
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0),
    [page, setPage] = useState(1),
    [failure, setFailure] = useState("");
  const state = useData("/notifications?limit=20&page=" + page, revision);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setRevision((x) => x + 1);
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <div className="eco-bell">
      <button
        className="icon-button"
        aria-label={`Notificações, ${state.data?.unread || 0} não lidas`}
        onClick={() => {
          setOpen(!open);
          setRevision((x) => x + 1);
        }}
      >
        <Bell size={20} />
        {state.data?.unread > 0 && (
          <b className="eco-count">{state.data.unread}</b>
        )}
      </button>
      {open && (
        <section className="eco-notices" aria-label="Histórico de notificações">
          <div className="eco-row">
            <h2>Notificações</h2>
            <button className="secondary-button" onClick={() => setOpen(false)}>
              Fechar
            </button>
          </div>
          <Loader state={state} />
          <ErrorLine error={failure} />
          {state.data?.items.length === 0 && <p>Nenhum alerta recebido.</p>}
          {state.data?.items.map((n) => (
            <button
              className={"eco-notice " + (!n.read_at ? "is-unread" : "")}
              key={n.id}
              onClick={async () => {
                try {
                  await api.post("/notifications/" + n.id + "/read");
                  setRevision((x) => x + 1);
                  onOpen?.(n);
                  setOpen(false);
                } catch (e) {
                  setFailure(errorMessage(e));
                }
              }}
            >
              <strong>
                {!n.read_at ? "● " : ""}
                {n.title}
              </strong>
              <small>
                {n.detail.order_id ||
                  n.detail.technician ||
                  n.detail.reason ||
                  ""}
              </small>
              <time>{new Date(n.created_at).toLocaleString("pt-BR")}</time>
            </button>
          ))}
          <div className="eco-row">
            <button disabled={page === 1} onClick={() => setPage((x) => x - 1)}>
              Anteriores
            </button>
            <span>Página {page}</span>
            <button
              disabled={(state.data?.items.length || 0) < 20}
              onClick={() => setPage((x) => x + 1)}
            >
              Mais antigas
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
function PriceFields({ value, onChange }) {
  return (
    <div className="eco-grid">
      {services.map((s) => (
        <Field
          key={s}
          label={s + " (R$)"}
          type="number"
          min="0"
          step="0.01"
          required
          value={(value[s] ?? 0) / 100}
          onChange={(e) =>
            onChange({
              ...value,
              [s]: Math.round(Number(e.target.value) * 100),
            })
          }
        />
      ))}
    </div>
  );
}
function ExpensePhoto({ id }) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError("");
    let active = true,
      object;
    api
      .get("/requests/" + id + "/receipt", { responseType: "blob" })
      .then(({ data }) => {
        object = URL.createObjectURL(data);
        if (active) setUrl(object);
        else URL.revokeObjectURL(object);
      })
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
      if (object) URL.revokeObjectURL(object);
    };
  }, [id, open]);
  return (
    <div>
      <button
        type="button"
        className="secondary-button"
        onClick={() => setOpen(!open)}
      >
        {open ? "Ocultar comprovante" : "Ver comprovante"}
      </button>
      {open && (
        <>
          <ErrorLine error={error} />
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              <img
                src={url}
                alt="Comprovante da despesa"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  width: 320,
                  maxHeight: 260,
                  objectFit: "contain",
                  marginTop: 12,
                }}
              />
            </a>
          ) : (
            !error && <p role="status">Carregando comprovante…</p>
          )}
        </>
      )}
    </div>
  );
}
export function Requests({
  technical = false,
  kind,
  revision: external = 0,
  onDecided,
}) {
  const [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [action, setAction] = useState("approve"),
    [reason, setReason] = useState(""),
    [effective, setEffective] = useState(today()),
    [prices, setPrices] = useState(
      Object.fromEntries(services.map((s) => [s, 0])),
    ),
    [busy, setBusy] = useState(false);
  const state = useData(
    technical ? "/technician/requests" : "/requests",
    revision + external,
  );
  const list = (state.data?.items || []).filter(
    (r) => !kind || r.kind === kind,
  );
  async function decide(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post(
        (technical ? "/technician/requests/" : "/requests/") +
          selected.id +
          (technical ? "/respond" : "/decision"),
        {
          version: selected.version,
          action,
          reason,
          proposed: { effective_on: effective, prices },
        },
      );
      setSelected(null);
      setRevision((x) => x + 1);
      onDecided?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="eco-section">
      <h2>{technical ? "Minhas solicitações" : "Solicitações dos técnicos"}</h2>
      <Loader state={state} />
      <ErrorLine error={error} />
      {!state.loading && !list.length && <p>Nenhuma solicitação.</p>}
      {list.map((r) => (
        <article className="dashboard-panel eco-card" key={r.id}>
          <div className="eco-row">
            <h3>
              {
                {
                  rate: "Reajuste de tarifas",
                  dispute: "Contestação da OS",
                  expense: "Despesa extra · reembolso",
                  stock: "Solicitação de estoque",
                }[r.kind]
              }{" "}
              {r.order_id || ""}
            </h3>
            <span className="eco-tag">{states[r.state] || r.state}</span>
          </div>
          <p>
            {r.technician_name} ·{" "}
            {new Date(r.created_at).toLocaleDateString("pt-BR")}
          </p>
          <p>{r.reason}</p>
          {r.kind === "rate" ? (
            <>
              <p>Vigência solicitada: {r.proposed.effective_on}</p>
              <div className="eco-grid">
                {Object.entries(r.proposed.prices).map(([s, n]) => (
                  <p key={s}>
                    {s}: <strong>{brl(n)}</strong>
                  </p>
                ))}
              </div>
              {r.counterproposal && (
                <div className="eco-info">
                  <strong>
                    Contraproposta · {r.counterproposal.effective_on}
                  </strong>
                  {Object.entries(r.counterproposal.prices).map(([s, n]) => (
                    <p key={s}>
                      {s}: {brl(n)}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : r.kind === "stock" ? (
            <p>
              {stockActions[r.proposed.action]} · {r.proposed.quantity} ·{" "}
              {r.proposed.model} · {r.proposed.serials} ·{" "}
              {r.proposed.destination}
            </p>
          ) : (
            <p>
              {r.kind === "expense"
                ? "Reembolso solicitado"
                : "Ajuste solicitado"}
              : {brl(r.proposed.amount_cents)}
            </p>
          )}
          {r.kind === "expense" && <ExpensePhoto id={r.id} />}
          <details>
            <summary>Histórico de decisões</summary>
            {r.history.map((h, i) => (
              <p key={i}>
                {new Date(h.at).toLocaleString("pt-BR")} · {h.actor}: {h.reason}{" "}
                ({h.action})
              </p>
            ))}
          </details>
          {(technical
            ? ["counteroffer", "information_requested"].includes(r.state)
            : ["pending", "information_requested"].includes(r.state)) && (
            <button
              className="secondary-button"
              onClick={() => {
                setSelected(r);
                setAction(
                  technical
                    ? r.state === "counteroffer"
                      ? "accept"
                      : "resubmit"
                    : "approve",
                );
                setPrices(r.proposed.prices || prices);
                setEffective(r.proposed.effective_on || today());
                setReason("");
              }}
            >
              Responder solicitação
            </button>
          )}
        </article>
      ))}
      {selected && (
        <form className="dashboard-panel eco-card" onSubmit={decide}>
          <h3>Resposta à solicitação</h3>
          <Field label="Decisão">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {(technical
                ? selected.state === "counteroffer"
                  ? [
                      ["accept", "Aceitar contraproposta"],
                      ["decline", "Recusar contraproposta"],
                    ]
                  : [["resubmit", "Enviar informações"]]
                : [
                    ["approve", "Aprovar"],
                    ["reject", "Rejeitar"],
                    ["information", "Solicitar informações"],
                    ...(selected.kind === "rate"
                      ? [["counteroffer", "Apresentar contraproposta"]]
                      : []),
                  ]
              ).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          {action === "counteroffer" && (
            <>
              <Field
                label="Vigência da contraproposta"
                type="date"
                required
                min={today()}
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
              />
              <PriceFields value={prices} onChange={setPrices} />
            </>
          )}
          <Field label="Resposta e justificativa">
            <textarea
              required
              value={reason}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {selected.kind === "stock" && (
            <p>
              A aprovação autoriza a solicitação. A movimentação oficial deve
              ser registrada e conferida no Estoque Pro.
            </p>
          )}
          <div className="eco-row">
            <button className="primary-button" disabled={busy}>
              Registrar decisão
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelected(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
export function NewRequest({
  kind,
  onSaved,
  initialPrices,
  initialOrderId = "",
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [effective, setEffective] = useState(today()),
    [prices, setPrices] = useState(
      initialPrices || Object.fromEntries(services.map((s) => [s, 0])),
    ),
    [orderId, setOrderId] = useState(initialOrderId),
    [amount, setAmount] = useState(""),
    [stock, setStock] = useState({
      action: "replenishment",
      quantity: 1,
      model: "",
      serials: "",
      destination: "",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const [receipt, setReceipt] = useState(""),
    [reading, setReading] = useState(false),
    [orders, setOrders] = useState([]);
  const orderList = useId();
  useEffect(() => {
    if (kind !== "expense" || !open) return;
    let active = true;
    api
      .get("/technician/orders?limit=100")
      .then(
        ({ data }) =>
          active &&
          setOrders(
            data.items.filter(
              (o) => !o.tracker_waiver_authorized && o.status !== "CANCELADO",
            ),
          ),
      )
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, kind]);
  async function readReceipt(file) {
    setReceipt("");
    setError("");
    if (!file) return;
    setReading(true);
    let uri;
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 20 * 1024 * 1024
      )
        throw Error("Escolha uma foto JPEG, PNG ou WebP de até 20 MB.");
      uri = URL.createObjectURL(file);
      const image = new Image();
      image.src = uri;
      await image.decode();
      const scale = Math.min(
        1,
        2000 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.88);
      if (data.length > 5500000)
        throw Error("A foto está muito grande. Envie uma imagem menor.");
      setReceipt(data);
    } catch (e) {
      setError(e.message || "Não foi possível abrir a foto do comprovante.");
    } finally {
      if (uri) URL.revokeObjectURL(uri);
      setReading(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (kind === "expense" && !receipt)
        throw Error("Anexe a foto do comprovante antes de enviar.");
      await api.post("/technician/requests", {
        kind,
        reason,
        order_id: orderId,
        request_key: key.current,
        ...(kind === "expense" ? { receipt } : {}),
        proposed:
          kind === "rate"
            ? { prices, effective_on: effective }
            : kind === "stock"
              ? stock
              : { amount_cents: Math.round(Number(amount) * 100) },
      });
      key.current = crypto.randomUUID();
      setOpen(false);
      setReceipt("");
      setReason("");
      setAmount("");
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button
        className="secondary-button"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        {" "}
        {
          {
            rate: "Solicitar reajuste",
            dispute: "Contestar valor de uma OS",
            expense: "Declarar despesa extra",
            stock: "Solicitar movimentação",
          }[kind]
        }
      </button>
    );
  return (
    <form className="dashboard-panel eco-card" onSubmit={submit}>
      <h3>
        {kind === "rate"
          ? "Proposta de novas tarifas"
          : kind === "stock"
            ? "Solicitação de estoque"
            : kind === "expense"
              ? "Declarar despesa extra"
              : "Contestação de valor"}
      </h3>
      <ErrorLine error={error} />
      {kind === "rate" ? (
        <>
          <Field
            label="Vigência desejada"
            type="date"
            min={today()}
            required
            value={effective}
            onChange={(e) => setEffective(e.target.value)}
          />
          <PriceFields value={prices} onChange={setPrices} />
        </>
      ) : kind === "stock" ? (
        <>
          <Field label="Tipo">
            <select
              value={stock.action}
              onChange={(e) => setStock({ ...stock, action: e.target.value })}
            >
              {Object.entries(stockActions).map(([k, v]) => (
                <option value={k} key={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="eco-grid">
            <Field
              label="Quantidade"
              type="number"
              min="1"
              max="1000"
              required
              value={stock.quantity}
              onChange={(e) =>
                setStock({ ...stock, quantity: Number(e.target.value) })
              }
            />
            <Field
              label="Modelo ou categoria"
              value={stock.model}
              maxLength={200}
              onChange={(e) => setStock({ ...stock, model: e.target.value })}
            />
            <Field
              label="Seriais / IMEIs"
              value={stock.serials}
              maxLength={3000}
              onChange={(e) => setStock({ ...stock, serials: e.target.value })}
            />
            <Field
              label="Destino (para transferência)"
              value={stock.destination}
              maxLength={200}
              onChange={(e) =>
                setStock({ ...stock, destination: e.target.value })
              }
            />
          </div>
        </>
      ) : (
        <div className="eco-grid">
          <Field
            label="Número completo da OS"
            list={kind === "expense" ? orderList : undefined}
            readOnly={Boolean(initialOrderId)}
            required
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
          <Field
            label={
              kind === "expense"
                ? "Valor da despesa (R$)"
                : "Ajuste desejado (R$, pode ser negativo)"
            }
            min={kind === "expense" ? "0.01" : undefined}
            type="number"
            step="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      )}
      {kind === "expense" && (
        <>
          <datalist id={orderList}>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.vehicle} · {o.service}
              </option>
            ))}
          </datalist>
          <Field label="Foto do comprovante (obrigatória)">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || reading}
              onChange={(e) => readReceipt(e.target.files?.[0])}
            />
          </Field>
          {reading && <p role="status">Preparando comprovante…</p>}
          {receipt && (
            <img
              src={receipt}
              alt="Prévia do comprovante"
              style={{ maxWidth: "100%", maxHeight: 220 }}
            />
          )}
          <p>
            A despesa só será incluída no pagamento após aprovação da central. O
            comprovante deve permitir a leitura do gasto e do valor.
          </p>
        </>
      )}
      <Field
        label={
          kind === "expense"
            ? "Descrição do gasto (obrigatória)"
            : "Justificativa"
        }
      >
        <textarea
          required
          minLength={kind === "expense" ? 5 : undefined}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className="eco-row">
        <button
          className="primary-button"
          disabled={busy || reading || (kind === "expense" && !receipt)}
        >
          {busy ? "Enviando…" : "Enviar para aprovação"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setOpen(false)}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
export function Rates() {
  const [revision, setRevision] = useState(0),
    state = useData("/technician/rates", revision);
  const current = state.data?.items.find(
    (r) => r.effective_on <= state.data.today,
  );
  return (
    <section className="eco-section">
      <h1>Meus valores</h1>
      <p>
        As tarifas são aplicadas pela data da execução. Reajustes preservam os
        serviços já registrados.
      </p>
      <Loader state={state} />
      {current && (
        <NewRequest
          kind="rate"
          initialPrices={current.prices}
          onSaved={() => setRevision((x) => x + 1)}
        />
      )}
      <div className="eco-grid">
        {state.data?.items.map((r) => (
          <article key={r.id} className="dashboard-panel eco-card">
            <h2>
              {r === current
                ? "Tarifas vigentes"
                : r.effective_on > state.data.today
                  ? "Vigência futura"
                  : "Versão anterior"}
            </h2>
            <p>Desde {r.effective_on}</p>
            {Object.entries(r.prices).map(([s, n]) => (
              <div className="eco-row" key={s}>
                <span>{s}</span>
                <strong>{brl(n)}</strong>
              </div>
            ))}
          </article>
        ))}
      </div>
      <Requests technical kind="rate" revision={revision} />
      <Requests technical kind="dispute" revision={revision} />
    </section>
  );
}
export function Stock() {
  const [revision, setRevision] = useState(0),
    [page, setPage] = useState(1),
    load = useData("/technician/stock", revision),
    history = useData("/technician/stock/history?page=" + page, revision);
  const items = load.data?.items || [];
  return (
    <section className="eco-section">
      <div className="eco-row">
        <div>
          <h1>Meu estoque</h1>
          <p>Carga oficial e histórico do Estoque Pro.</p>
        </div>
        <button
          className="secondary-button"
          onClick={() => setRevision((x) => x + 1)}
        >
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>
      <Loader state={load} />
      {load.data?.linked === false && (
        <p>Solicite à central o vínculo com seu cadastro no Estoque Pro.</p>
      )}
      <div className="eco-grid">
        <article className="dashboard-panel eco-card">
          <Package />
          <h2>{items.length}</h2>
          <p>Equipamentos em carga</p>
        </article>
        {["RASTREADOR", "TAG"].map((cat) => (
          <article className="dashboard-panel eco-card" key={cat}>
            <h2>{items.filter((i) => i.categoria === cat).length}</h2>
            <p>{cat}</p>
          </article>
        ))}
      </div>
      <NewRequest kind="stock" onSaved={() => setRevision((x) => x + 1)} />
      <div className="eco-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Serial / IMEI</th>
              <th>Modelo</th>
              <th>Situação</th>
              <th>OS vinculada</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.codigo_serial}>
                <td>{i.codigo_serial}</td>
                <td>
                  {i.produto}
                  <small>{i.categoria}</small>
                </td>
                <td>{i.availability || "Disponível"}</td>
                <td>{i.orders?.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Reservas exibidas pertencem aos rascunhos e envios do ZenControl. A
        confirmação da carga sempre ocorre no Estoque Pro.
      </p>
      <h2>Movimentações</h2>
      <Loader state={history} />
      {history.data?.items.map((e) => (
        <article className="dashboard-panel eco-card" key={e.id}>
          <strong>
            {e.codigo_serial} · {e.modelo}
          </strong>
          <p>
            {e.tipo} · {e.status_anterior || "Entrada"} → {e.status_novo} ·{" "}
            {new Date(e.data).toLocaleString("pt-BR")}
          </p>
          {e.order_id && <p>OS: {e.order_id}</p>}
        </article>
      ))}
      <div className="eco-row">
        <button
          className="secondary-button"
          disabled={page === 1}
          onClick={() => setPage((x) => x - 1)}
        >
          Anterior
        </button>
        <span>Página {page}</span>
        <button
          className="secondary-button"
          disabled={(history.data?.items.length || 0) < 50}
          onClick={() => setPage((x) => x + 1)}
        >
          Próxima
        </button>
      </div>
      <Requests technical kind="stock" revision={revision} />
    </section>
  );
}
export function FinancePanel({ technical = false }) {
  const [tid, setTid] = useState(""),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(null),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(today()),
    [extra, setExtra] = useState(false),
    [reason, setReason] = useState(""),
    [pay, setPay] = useState(null),
    [amount, setAmount] = useState(""),
    [reference, setReference] = useState(""),
    [paidOn, setPaidOn] = useState(today()),
    [receipt, setReceipt] = useState("");
  const techs = useData(technical ? "/technician/me" : "/technicians");
  const state = useData(
    technical
      ? "/technician/finance"
      : tid
        ? "/finance-v2/technicians/" + tid
        : "/meta",
    revision,
  );
  const data = technical || tid ? state.data : null,
    closeKey = useRef(crypto.randomUUID()),
    paymentKey = useRef(crypto.randomUUID());
  const [policy, setPolicy] = useState(null),
    [ratePrices, setRatePrices] = useState(null),
    [rateDate, setRateDate] = useState(today()),
    [holiday, setHoliday] = useState({ day: "", name: "" });
  useEffect(() => {
    if (data?.cycle) {
      setPolicy(data.cycle.policy);
      setStart(data.cycle.current.start);
      setEnd(data.cycle.current.end);
      setPreview(null);
    }
  }, [data]);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.response ? errorMessage(e) : e.message || errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function changeTech(id) {
    setTid(id);
    setRatePrices(null);
    api
      .get("/finance-v2/technicians/" + id + "/rates")
      .then((r) =>
        setRatePrices(
          r.data.items.find((x) => x.effective_on <= today())?.prices ||
            Object.fromEntries(services.map((s) => [s, 0])),
        ),
      )
      .catch((e) => setError(errorMessage(e)));
  }
  return (
    <section className="eco-section">
      <h1>{technical ? "Meu financeiro" : "Fechamentos e pagamentos"}</h1>
      <p>
        Valores em reais. Pagamentos são registros de operações realizadas
        externamente.
      </p>
      {!technical && (
        <Field label="Técnico">
          <select value={tid} onChange={(e) => changeTech(e.target.value)}>
            <option value="">Selecione um técnico</option>
            {techs.data?.items?.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ErrorLine error={error} />
      <Loader state={state} />
      {data && (
        <>
          <div className="eco-grid">
            {[
              ["Estimado, aguardando aprovação", data.estimated_cents],
              ["Conferido, ainda sem fechamento", data.confirmed_cents],
              ["Saldo confirmado dos fechamentos", data.balance_cents],
            ].map(([label, value]) => (
              <article className="dashboard-panel eco-card" key={label}>
                <Wallet size={20} />
                <h2>{brl(value)}</h2>
                <p>{label}</p>
              </article>
            ))}
          </div>
          <div className="eco-info">
            <CalendarDays size={20} />
            <p>
              Ciclo atual:{" "}
              <strong>
                {data.cycle.current.start} a {data.cycle.current.end}
              </strong>{" "}
              · Vencimento {data.cycle.current.due_on}
            </p>
            <p>
              Próximo ciclo: {data.cycle.next.start} a {data.cycle.next.end}
            </p>
          </div>
          {!technical && policy && (
            <details className="dashboard-panel eco-card">
              <summary>Política de fechamento e tarifas</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() =>
                    api.put("/finance-v2/technicians/" + tid + "/policy", {
                      version: data.cycle.version,
                      policy,
                    }),
                  );
                }}
              >
                <div className="eco-grid">
                  <Field label="Periodicidade">
                    <select
                      value={policy.unit}
                      onChange={(e) =>
                        setPolicy({ ...policy, unit: e.target.value })
                      }
                    >
                      <option value="weeks">Semanas</option>
                      <option value="days">Dias</option>
                      <option value="months">Meses</option>
                      <option value="twice_monthly">Duas vezes por mês</option>
                    </select>
                  </Field>
                  <Field
                    label="A cada N períodos"
                    type="number"
                    min="1"
                    max="366"
                    value={policy.every || 1}
                    onChange={(e) =>
                      setPolicy({ ...policy, every: Number(e.target.value) })
                    }
                  />
                  <Field
                    label="Data de referência"
                    type="date"
                    required
                    value={policy.anchor}
                    onChange={(e) =>
                      setPolicy({ ...policy, anchor: e.target.value })
                    }
                  />
                  <Field
                    label="Dia de corte mensal"
                    type="number"
                    min="1"
                    max="31"
                    value={policy.cut_day || 31}
                    onChange={(e) =>
                      setPolicy({ ...policy, cut_day: Number(e.target.value) })
                    }
                  />
                  <Field
                    label="Primeiro corte do mês"
                    type="number"
                    min="1"
                    max="30"
                    value={policy.days?.[0] || 15}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        days: [Number(e.target.value), policy.days?.[1] || 31],
                      })
                    }
                  />
                  <Field
                    label="Segundo corte do mês"
                    type="number"
                    min="2"
                    max="31"
                    value={policy.days?.[1] || 31}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        days: [policy.days?.[0] || 15, Number(e.target.value)],
                      })
                    }
                  />
                  <Field
                    label="Vencimento após N dias"
                    type="number"
                    min="0"
                    max="365"
                    value={policy.due_days}
                    onChange={(e) =>
                      setPolicy({ ...policy, due_days: Number(e.target.value) })
                    }
                  />
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={policy.business_days || false}
                    onChange={(e) =>
                      setPolicy({ ...policy, business_days: e.target.checked })
                    }
                  />{" "}
                  Contar dias úteis nos ciclos em dias
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={policy.due_business_days || false}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        due_business_days: e.target.checked,
                      })
                    }
                  />{" "}
                  Vencimento em dias úteis
                </label>
                <button className="primary-button" disabled={busy}>
                  Salvar política
                </button>
              </form>
              {ratePrices && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(() =>
                      api.post("/finance-v2/technicians/" + tid + "/rates", {
                        prices: ratePrices,
                        effective_on: rateDate,
                      }),
                    );
                  }}
                >
                  <h3>Autorizar nova versão de tarifas</h3>
                  <Field
                    label="Vigência"
                    type="date"
                    min={today()}
                    required
                    value={rateDate}
                    onChange={(e) => setRateDate(e.target.value)}
                  />
                  <PriceFields value={ratePrices} onChange={setRatePrices} />
                  <button className="primary-button" disabled={busy}>
                    Autorizar tarifas
                  </button>
                </form>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  act(() =>
                    api.put("/finance-v2/holidays/" + holiday.day, {
                      name: holiday.name,
                    }),
                  );
                }}
              >
                <h3>Cadastrar feriado</h3>
                <div className="eco-grid">
                  <Field
                    label="Data do feriado"
                    type="date"
                    required
                    value={holiday.day}
                    onChange={(e) =>
                      setHoliday({ ...holiday, day: e.target.value })
                    }
                  />
                  <Field
                    label="Nome do feriado"
                    required
                    value={holiday.name}
                    onChange={(e) =>
                      setHoliday({ ...holiday, name: e.target.value })
                    }
                  />
                </div>
                <button className="secondary-button" disabled={busy}>
                  Cadastrar feriado
                </button>
              </form>
            </details>
          )}
          {!technical && (
            <form
              className="dashboard-panel eco-card"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                api
                  .get("/finance-v2/preview", {
                    params: { technician_id: tid, start, end },
                  })
                  .then((r) => {
                    setPreview(r.data);
                    closeKey.current = crypto.randomUUID();
                  })
                  .catch((e) => setError(errorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <h2>Conferir período</h2>
              <div className="eco-grid">
                <Field
                  label="Início"
                  type="date"
                  required
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setPreview(null);
                  }}
                />
                <Field
                  label="Fim"
                  type="date"
                  required
                  value={end}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setPreview(null);
                  }}
                />
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={extra}
                  onChange={(e) => setExtra(e.target.checked)}
                />{" "}
                Fechamento extraordinário autorizado
              </label>
              {extra && (
                <Field
                  label="Justificativa do fechamento"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
              <button className="secondary-button" disabled={busy}>
                Gerar prévia
              </button>
              {preview && (
                <div>
                  <h3>
                    {preview.orders.length} OS · Total{" "}
                    {brl(preview.total_cents)}
                  </h3>
                  {preview.orders.map((o) => (
                    <p key={o.id}>
                      {o.id} · {o.executed_on} · {brl(o.total_cents)}{" "}
                      {o.late ? "· Competência anterior" : ""}
                    </p>
                  ))}
                  {preview.carry_adjustments?.map((a) => (
                    <p key={a.id}>
                      Ajuste de OS já fechada: {a.order_id} ·{" "}
                      {brl(a.amount_cents)}
                    </p>
                  ))}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await api.post("/finance-v2/closings", {
                          technician_id: Number(tid),
                          start,
                          end,
                          extraordinary: extra,
                          reason,
                          preview_hash: preview.preview_hash,
                          request_key: closeKey.current,
                        });
                        setPreview(null);
                      })
                    }
                  >
                    Criar fechamento para conferência
                  </button>
                </div>
              )}
            </form>
          )}
          {data.unverified_cents > 0 && (
            <p className="eco-info">
              Há {brl(data.unverified_cents)} em fechamentos legados sem
              confirmação do histórico de pagamentos. Esses valores não compõem
              o saldo confirmado.
            </p>
          )}
          {data.pending_closing_cents > 0 && (
            <p className="eco-info">
              {brl(data.pending_closing_cents)} em fechamentos aguardando
              conferência financeira.
            </p>
          )}
          <h2>Serviços e composição</h2>
          <div className="eco-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>OS / execução</th>
                  <th>Serviço</th>
                  <th>Tarifa</th>
                  <th>Adicionais</th>
                  <th>Total</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((l) => (
                  <tr key={l.order_id}>
                    <td>
                      {l.order_id}
                      <small>
                        {l.executed_on} · {l.vehicle}
                      </small>
                    </td>
                    <td>{l.service}</td>
                    <td>
                      {brl(l.base_cents)}
                      <small>Versão {l.rate_id.slice(0, 12)}</small>
                    </td>
                    <td>
                      {l.extras.map((x, i) => (
                        <small key={i}>
                          {x.description || x.type}: {brl(x.amount_cents)}
                        </small>
                      ))}
                    </td>
                    <td>
                      {brl(l.total_cents + l.adjustment_cents)}
                      {l.adjustment_cents !== 0 && (
                        <small>
                          Ajustes e reembolsos: {brl(l.adjustment_cents)}
                        </small>
                      )}
                    </td>
                    <td>
                      {l.settlement_id
                        ? "Incluído no fechamento"
                        : states[l.state] || l.state}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {technical && (
            <NewRequest
              kind="dispute"
              onSaved={() => setRevision((x) => x + 1)}
            />
          )}
          <h2>Fechamentos anteriores</h2>
          {data.settlements.length === 0 && <p>Nenhum fechamento.</p>}
          {data.settlements.map((s) => (
            <article className="dashboard-panel eco-card" key={s.id}>
              <div className="eco-row">
                <h3>
                  {s.start_date} a {s.end_date}
                </h3>
                <span className="eco-tag">{states[s.state] || s.state}</span>
              </div>
              <p>
                Total {brl(s.total_cents)} · Pago {brl(s.paid_cents)} · Saldo{" "}
                <strong>
                  {s.balance_cents === null
                    ? "A conferir"
                    : brl(s.balance_cents)}
                </strong>
              </p>
              <p>
                Vencimento: {s.due_on || "Legado"} · Responsável: {s.created_by}
              </p>
              <div className="eco-row">
                <button
                  className="secondary-button"
                  onClick={() =>
                    download(
                      "/finance-v2/closings/" + s.id + "/pdf",
                      "Fechamento-" + s.id + ".pdf",
                    ).catch((e) => setError(errorMessage(e)))
                  }
                >
                  <Download size={16} />
                  PDF
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    download(
                      "/finance-v2/closings/" + s.id + "/export",
                      "Fechamento-" + s.id + ".json",
                    ).catch((e) => setError(errorMessage(e)))
                  }
                >
                  Exportar composição
                </button>
                {!technical &&
                  ["draft", "legacy_unverified"].includes(s.state) && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          api.post("/finance-v2/closings/" + s.id + "/approve"),
                        )
                      }
                    >
                      Aprovar fechamento
                    </button>
                  )}
                {!technical &&
                  ["approved", "awaiting_payment", "partial"].includes(
                    s.state,
                  ) &&
                  s.balance_cents > 0 && (
                    <button
                      className="primary-button"
                      onClick={() => {
                        setPay(s);
                        setAmount((s.balance_cents / 100).toFixed(2));
                        setReference("");
                        setReceipt("");
                        paymentKey.current = crypto.randomUUID();
                      }}
                    >
                      Registrar pagamento externo
                    </button>
                  )}
              </div>
              {s.payments.map((p) => (
                <p key={p.id}>
                  {p.paid_on} · {brl(p.amount_cents)} · {p.reference}{" "}
                  {p.receipt_mime && (
                    <button
                      onClick={() =>
                        download(
                          "/payments/" + p.id + "/receipt",
                          "Comprovante." +
                            (p.receipt_mime === "application/pdf"
                              ? "pdf"
                              : "jpg"),
                        ).catch((e) => setError(errorMessage(e)))
                      }
                    >
                      Comprovante
                    </button>
                  )}
                </p>
              ))}
            </article>
          ))}
          {pay && (
            <form
              className="dashboard-panel eco-card"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  await api.post(
                    "/finance-v2/closings/" + pay.id + "/payments",
                    {
                      amount_cents: Math.round(Number(amount) * 100),
                      paid_on: paidOn,
                      reference,
                      receipt,
                      request_key: paymentKey.current,
                    },
                  );
                  setPay(null);
                });
              }}
            >
              <h3>Registrar pagamento já efetuado</h3>
              <p>
                Saldo {brl(pay.balance_cents)}. Esta ação não transfere
                dinheiro.
              </p>
              <div className="eco-grid">
                <Field
                  label="Valor pago (R$)"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={pay.balance_cents / 100}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <Field
                  label="Data do pagamento"
                  type="date"
                  max={today()}
                  required
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                />
                <Field
                  label="Referência do pagamento externo"
                  required
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <Field
                  label="Comprovante (PDF ou foto, até 4 MB)"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setReceipt("");
                    if (!file) return;
                    if (file.size > 4 * 1024 * 1024) {
                      setError("Comprovante excede 4 MB.");
                      e.target.value = "";
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setReceipt(reader.result);
                    reader.readAsDataURL(file);
                  }}
                />
              </div>
              <div className="eco-row">
                <button className="primary-button" disabled={busy}>
                  Confirmar registro
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setPay(null)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
          <h2>Ajustes e reembolsos</h2>
          {data.adjustments.map((a) => (
            <p key={a.id}>
              {a.order_id} · {brl(a.amount_cents)} · {a.reason} ·{" "}
              {a.settlement_id
                ? "Incluído em fechamento"
                : "Próximo fechamento elegível"}
            </p>
          ))}
        </>
      )}
      {!technical && <Requests onDecided={() => setRevision((x) => x + 1)} />}
      {technical && (
        <section className="eco-section">
          <h2>Despesas extras</h2>
          <NewRequest
            kind="expense"
            onSaved={() => setRevision((x) => x + 1)}
          />
          <Requests technical kind="expense" revision={revision} />
        </section>
      )}
      {technical && <Requests technical kind="dispute" revision={revision} />}
    </section>
  );
}
export function Home({ items, onOpen, onNavigate }) {
  const state = useData("/technician/finance"),
    stockState = useData("/technician/stock"),
    open = items.filter((o) => !["CONCLUÍDO", "CANCELADO"].includes(o.status));
  return (
    <section className="eco-section">
      <h1>Seu dia em campo</h1>
      <p>
        Confira seus próximos serviços e acompanhe as confirmações da central.
      </p>
      <div className="eco-grid">
        {[
          ["Em atendimento", open.length],
          [
            "Concluídos nesta lista",
            items.filter((o) => o.status === "CONCLUÍDO").length,
          ],
          [
            "Pendências de correção",
            items.filter((o) => o.status === "CORREÇÃO SOLICITADA").length,
          ],
        ].map(([title, n]) => (
          <article className="dashboard-panel eco-card" key={title}>
            <h2>{n}</h2>
            <p>{title}</p>
          </article>
        ))}
      </div>
      <Loader state={state} />
      {state.data && (
        <button
          className="dashboard-panel eco-card eco-link"
          onClick={() => onNavigate("finance")}
        >
          <Wallet />
          <h2>
            {brl(state.data.estimated_cents + state.data.confirmed_cents)}
          </h2>
          <p>
            Previsão de serviços ainda sem fechamento · consultar financeiro
          </p>
        </button>
      )}
      <article className="dashboard-panel eco-card">
        <h2>{stockState.data?.items.length ?? "—"}</h2>
        <p>Equipamentos em carga individual</p>
        <Loader state={stockState} />
      </article>
      <h2>Próximos serviços</h2>
      {open.slice(0, 5).map((o) => (
        <button
          className="dashboard-panel eco-card eco-link"
          key={o.id}
          onClick={() => onOpen(o.id)}
        >
          <strong>
            {o.vehicle} · {o.service}
          </strong>
          <p>
            {o.scheduled_at?.replace("T", " ")} · {o.location}
          </p>
          <small>
            {o.id} · {o.status}
          </small>
        </button>
      ))}
      <button className="primary-button" onClick={() => onNavigate("stock")}>
        <Package size={18} /> Consultar meu estoque
      </button>
    </section>
  );
}
