import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Camera,
  CheckCheck,
  ClipboardList,
  LogOut,
  MapPin,
  RefreshCw,
  Send,
  Trash2,
  Package,
  KeyRound,
} from "lucide-react";
import { api, errorMessage, saveToken } from "@zen/ui/lib/api";
import { useSession } from "@zen/ui/lib/session";
import { notify, confirmAction } from "@zen/ui/lib/feedback";
import LeitorSeriais from "@zen/ui/components/LeitorSeriais";
import AppFooter from "@zen/ui/components/AppFooter";
import { Badge, Loading, Empty, format, FormModal } from "../components/common";
export const photoLabels = {
  vehicle: "Veículo e identificação",
  label: "Etiqueta do equipamento",
  installed: "Equipamento instalado",
  service: "Serviço realizado",
  other: "Foto complementar",
};
export function EvidencePhoto({ file, prefix = "/technician", children }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      uri;
    setError(false);
    api
      .get(prefix + "/evidence/" + file.id, { responseType: "blob" })
      .then((r) => {
        uri = URL.createObjectURL(r.data);
        if (active) setUrl(uri);
        else URL.revokeObjectURL(uri);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [prefix, file.id, file.sha256]);
  return (
    <article className="zc-photo portal-photo">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={photoLabels[file.kind] || "Foto do atendimento"}
          />
        </a>
      ) : (
        <div className="zc-photo-placeholder">
          {error
            ? "Não foi possível carregar a foto. Atualize para tentar novamente."
            : "Carregando foto…"}
        </div>
      )}
      <div className="portal-photo-caption">
        <strong>{photoLabels[file.kind] || "Foto"}</strong>
        {file.serial_code && <code>{file.serial_code}</code>}
        {children}
      </div>
    </article>
  );
}
async function compressedImage(file) {
  if (!file.type.startsWith("image/")) throw Error("Escolha uma imagem.");
  if (file.size > 24 * 1024 * 1024) throw Error("Use uma foto de até 24 MB.");
  const uri = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = uri;
    await image.decode();
    const scale = Math.min(
        1,
        2400 / Math.max(image.naturalWidth, image.naturalHeight),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(uri);
  }
}
function Service({ id, onBack, onChanged }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [codes, setCodes] = useState([]),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [stock, setStock] = useState(null),
    [stockError, setStockError] = useState("");
  const loadedBatch = useRef(null);
  async function reload() {
    const { data: next } = await api.get(
      "/technician/orders/" + encodeURIComponent(id),
    );
    setData(next);
    const active = next.submissions.find((b) =>
      ["draft", "submitted", "approved_sync", "stock_failed"].includes(b.state),
    );
    if (active?.id !== loadedBatch.current) {
      loadedBatch.current = active?.id;
      setCodes(active?.imeis || []);
      setNotes(active?.notes || "");
      setConfirmed(false);
    }
    return next;
  }
  useEffect(() => {
    let active = true;
    reload().catch((e) => {
      if (active) setError(errorMessage(e));
    });
    api
      .get("/technician/stock")
      .then((r) => {
        if (active) setStock(r.data);
      })
      .catch((e) => {
        if (active) setStockError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!data || data.submissions.some((b) => b.state === "draft")) return;
    const t = setInterval(() => {
      if (!document.hidden && !busy) reload().catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [data, busy]);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
      onChanged();
    } catch (e) {
      setError(e.response ? errorMessage(e) : e.message || errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <button className="secondary-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Meus serviços
        </button>
        <Loading error={error} />
      </>
    );
  const { order, rule, submissions } = data,
    batch = submissions.find((b) =>
      ["draft", "submitted", "approved_sync", "stock_failed"].includes(b.state),
    ),
    draft = batch?.state === "draft",
    closed = ["CONCLUÍDO", "CANCELADO"].includes(order.status),
    rejected = submissions.find((b) => b.state === "rejected"),
    files = batch?.files || [],
    stale = draft && batch.order_version !== order.version;
  const available = new Set(stock?.items?.map((e) => e.codigo_serial) || []);
  return (
    <div className="portal-service">
      <button className="secondary-button" disabled={busy} onClick={onBack}>
        <ArrowLeft size={16} />
        Meus serviços
      </button>
      <section className="dashboard-panel portal-service-summary">
        <div>
          <p className="portal-eyebrow">{order.id}</p>
          <h1>{order.vehicle}</h1>
          <p>
            {order.service} · {order.customer_name || "Associado"}
          </p>
        </div>
        <Badge value={order.status} />
        <dl>
          <div>
            <dt>Agendamento</dt>
            <dd>{format(order.scheduled_at, true)}</dd>
          </div>
          <div>
            <dt>Contato</dt>
            <dd>{order.contact || "Não informado"}</dd>
          </div>
          <div>
            <dt>Local</dt>
            <dd>{order.location || "A confirmar"}</dd>
          </div>
        </dl>
        {order.notes && <p className="zc-comments">{order.notes}</p>}
      </section>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {rejected && !batch && !closed && (
        <div className="zc-notice amber">
          <b>Correção solicitada pela central</b>
          <p>{rejected.rejection_reason}</p>
        </div>
      )}
      {batch && !draft && (
        <div className="zc-notice">
          <CheckCheck size={20} />
          <div>
            <b>
              {batch.state === "submitted"
                ? "Enviado para conferência"
                : batch.state === "stock_failed"
                  ? "A central está conferindo o estoque"
                  : "Aguardando confirmação do estoque"}
            </b>
            <p>
              O serviço será concluído após a confirmação no ZenControl.{" "}
              {batch.reviewed_by && "Conferido por " + batch.reviewed_by + "."}
            </p>
          </div>
        </div>
      )}
      {closed && (
        <div className="zc-notice">
          <CheckCheck size={20} />{" "}
          {order.status === "CONCLUÍDO"
            ? "Atendimento confirmado pela central."
            : "Atendimento cancelado."}
        </div>
      )}
      {!batch && !closed && (
        <section className="dashboard-panel portal-step">
          <div className="portal-step-title">
            <span>1</span>
            <div>
              <h2>Registrar atendimento</h2>
              <p>Confira o veículo e prepare as evidências do serviço.</p>
            </div>
          </div>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() =>
              act(() =>
                api.post(
                  "/technician/orders/" + encodeURIComponent(id) + "/draft",
                  { version: order.version },
                ),
              )
            }
          >
            <Camera size={18} />
            Iniciar registro
          </button>
        </section>
      )}
      {draft && (
        <>
          {stale && (
            <div className="zc-notice amber">
              A OS foi alterada pela central. Descarte este rascunho e inicie um
              registro com os dados atualizados.
            </div>
          )}
          <section className="dashboard-panel portal-step">
            <div className="portal-step-title">
              <span>1</span>
              <div>
                <h2>Fotos do serviço</h2>
                <p>
                  Fotografe cada evidência com boa iluminação e identificação
                  legível.
                </p>
              </div>
            </div>
            <div className="portal-photo-requirements">
              {rule.required_photos.map((required) => {
                const count = files.filter(
                  (f) => f.kind === required.kind,
                ).length;
                return (
                  <div className="portal-photo-requirement" key={required.kind}>
                    <div>
                      <strong>{required.label}</strong>
                      <small>
                        {count} de {required.min} foto(s) ·{" "}
                        {count >= required.min ? "Recebido" : "Obrigatório"}
                      </small>
                    </div>
                    <label
                      className={
                        "secondary-button " +
                        (busy || stale ? "is-disabled" : "")
                      }
                    >
                      <Camera size={18} />
                      Fotografar
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={busy || stale}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file)
                            act(async () => {
                              const image = await compressedImage(file);
                              await api.post(
                                "/technician/batches/" + batch.id + "/photos",
                                {
                                  version: batch.version,
                                  kind: required.kind,
                                  image,
                                },
                              );
                              setConfirmed(false);
                            });
                        }}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
            {!!files.length && (
              <div className="zc-evidence-grid">
                {files.map((f) => (
                  <EvidencePhoto key={f.id} file={f}>
                    {f.kind === "label" && (
                      <label className="portal-photo-code">
                        IMEI/serial desta etiqueta
                        <select
                          value={f.serial_code || ""}
                          disabled={busy || stale}
                          onChange={(e) =>
                            act(async () => {
                              await api.patch("/technician/photos/" + f.id, {
                                version: batch.version,
                                serial_code: e.target.value,
                              });
                              setConfirmed(false);
                            })
                          }
                        >
                          <option value="">Selecione após a leitura</option>
                          {[
                            ...new Set([
                              ...codes,
                              ...(f.serial_code ? [f.serial_code] : []),
                            ]),
                          ].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      className="secondary-button"
                      disabled={busy || stale}
                      onClick={() =>
                        act(async () => {
                          await api.delete("/technician/photos/" + f.id, {
                            data: { version: batch.version },
                          });
                          setConfirmed(false);
                        })
                      }
                    >
                      <Trash2 size={14} />
                      Remover
                    </button>
                  </EvidencePhoto>
                ))}
              </div>
            )}
          </section>
          {rule.stock_action === "install" && (
            <section className="dashboard-panel portal-step">
              <div className="portal-step-title">
                <span>2</span>
                <div>
                  <h2>Identificar equipamentos</h2>
                  <p>
                    Use o leitor do Estoque Pro. Confira o código detectado e
                    vincule-o à foto da etiqueta acima.
                  </p>
                </div>
              </div>
              <fieldset
                disabled={busy || stale}
                className="portal-scanner-field"
              >
                <LeitorSeriais
                  maxBatch={20}
                  seriais={codes}
                  setSeriais={(v) => {
                    setCodes(v);
                    setConfirmed(false);
                  }}
                />
              </fieldset>
              {stockError && (
                <p className="zc-muted">
                  A consulta da carga está indisponível. A central fará a
                  validação no estoque: {stockError}
                </p>
              )}
              {stock?.linked && codes.some((c) => !available.has(c)) && (
                <div className="zc-notice amber">
                  Há código(s) que não aparecem na sua carga. Confira a leitura
                  e informe a central antes da aprovação.
                </div>
              )}
              {stock && !stock.linked && (
                <div className="zc-notice amber">
                  Solicite à central o vínculo do seu cadastro ao Estoque Pro.
                </div>
              )}
              <p className="zc-muted">
                {stock?.items?.length ?? "—"} equipamento(s) disponível(is) na
                sua carga.
              </p>
            </section>
          )}
          <section className="dashboard-panel portal-step">
            <div className="portal-step-title">
              <span>{rule.stock_action === "install" ? "3" : "2"}</span>
              <div>
                <h2>Enviar para a central</h2>
                <p>
                  A central confere as evidências antes de confirmar o
                  atendimento.
                </p>
              </div>
            </div>
            <label className="zc-field zc-full">
              Relato do atendimento
              <textarea
                rows={4}
                maxLength={6000}
                value={notes}
                disabled={busy || stale}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setConfirmed(false);
                }}
                placeholder="Descreva o serviço realizado e eventuais observações."
              />
            </label>
            <label className="zc-checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || stale}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Conferi o veículo, todas as fotos e os IMEIs/seriais informados.
            </label>
            <div className="portal-submit-actions">
              <button
                className="secondary-button"
                disabled={busy || stale}
                onClick={() =>
                  act(async () => {
                    await api.patch("/technician/batches/" + batch.id, {
                      version: batch.version,
                      serials: codes,
                      notes,
                    });
                    notify("Rascunho salvo.");
                  })
                }
              >
                Salvar rascunho
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirmAction(
                      "Descartar este rascunho? As fotos deste registro serão retiradas da conferência.",
                    )
                  )
                    act(() =>
                      api.post("/technician/batches/" + batch.id + "/discard", {
                        version: batch.version,
                      }),
                    );
                }}
              >
                Descartar rascunho
              </button>
              <button
                className="primary-button"
                disabled={busy || stale || !confirmed}
                onClick={() =>
                  act(async () => {
                    await api.post(
                      "/technician/batches/" + batch.id + "/submit",
                      {
                        version: batch.version,
                        serials: codes,
                        notes,
                        confirmed,
                      },
                    );
                    notify("Enviado para conferência da central.");
                  })
                }
              >
                <Send size={17} />
                {busy ? "Salvando…" : "Enviar para conferência"}
              </button>
            </div>
          </section>
        </>
      )}
      {!draft && !!submissions.length && (
        <section className="dashboard-panel portal-step">
          <h2>Evidências e histórico</h2>
          {submissions
            .filter((b) => b.state !== "withdrawn")
            .map((b) => (
              <div key={b.id} className="portal-history">
                <div className="portal-history-heading">
                  <Badge value={b.state} />
                  <small>{format(b.submitted_at || b.reviewed_at, true)}</small>
                </div>
                {b.rejection_reason && <p>{b.rejection_reason}</p>}
                {b.notes && <p>{b.notes}</p>}
                <div className="portal-code-list">
                  {b.imeis.map((c) => (
                    <code key={c}>{c}</code>
                  ))}
                </div>
                <div className="zc-evidence-grid">
                  {b.files.map((f) => (
                    <EvidencePhoto key={f.id} file={f} />
                  ))}
                </div>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}
export default function TechnicianPortal() {
  const user = useSession(),
    [items, setItems] = useState(null),
    [me, setMe] = useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [revision, setRevision] = useState(0),
    [filter, setFilter] = useState("open"),
    [password, setPassword] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      api.get("/technician/me"),
      api.get("/technician/orders?limit=100"),
    ])
      .then(([m, r]) => {
        if (active) {
          setMe(m.data);
          setItems(r.data.items);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    if (selected) return;
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((r) => r + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [selected]);
  const list = (items || []).filter(
    (o) =>
      (filter === "closed") === ["CONCLUÍDO", "CANCELADO"].includes(o.status),
  );
  function logout() {
    saveToken(null);
    window.dispatchEvent(
      new CustomEvent("invent:unauthorized", { detail: { reason: "logout" } }),
    );
  }
  return (
    <div className="inventory-app portal-app">
      <header className="portal-header">
        <div className="brand">
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <div>
            <strong>
              Zen<span>Control</span>
            </strong>
            <small>Portal do técnico</small>
          </div>
        </div>
        <div className="portal-header-user">
          <span>{me?.name || user.nome}</span>
          <button
            className="icon-button"
            aria-label="Alterar senha"
            onClick={() => setPassword(true)}
          >
            <KeyRound size={18} />
          </button>
          <button className="icon-button" aria-label="Sair" onClick={logout}>
            <LogOut size={19} />
          </button>
        </div>
      </header>
      <main className="portal-main">
        {selected ? (
          <Service
            key={selected}
            id={selected}
            onBack={() => setSelected(null)}
            onChanged={() => setRevision((r) => r + 1)}
          />
        ) : (
          <>
            <div className="portal-intro">
              <div>
                <p className="portal-eyebrow">CAMPO · ATENDIMENTOS</p>
                <h1>Meus serviços</h1>
                <p>Registre o atendimento. A central confirma a conclusão.</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => setRevision((r) => r + 1)}
              >
                <RefreshCw size={16} />
                Atualizar
              </button>
            </div>
            <div className="portal-tabs">
              <button
                className={filter === "open" ? "is-active" : ""}
                onClick={() => setFilter("open")}
              >
                <ClipboardList size={17} />
                Em atendimento
              </button>
              <button
                className={filter === "closed" ? "is-active" : ""}
                onClick={() => setFilter("closed")}
              >
                <CheckCheck size={17} />
                Finalizados
              </button>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {!items ? (
              <Loading error={error} />
            ) : !list.length ? (
              <Empty
                title="Nenhum serviço nesta lista"
                description="Os atendimentos atribuídos a você aparecerão aqui."
              />
            ) : (
              <div className="portal-orders">
                {list.map((o) => (
                  <button
                    key={o.id}
                    className="dashboard-panel portal-order"
                    onClick={() => setSelected(o.id)}
                  >
                    <div className="portal-order-top">
                      <span>{o.id}</span>
                      <Badge value={o.status} />
                    </div>
                    <h2>{o.vehicle}</h2>
                    <strong>{o.service}</strong>
                    <p>{o.customer_name || "Associado"}</p>
                    <div className="portal-order-bottom">
                      <span>
                        <MapPin size={14} />
                        {o.location || "Local a confirmar"}
                      </span>
                      <span>{format(o.scheduled_at, true)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <AppFooter />
      {password && (
        <FormModal
          title="Alterar senha"
          description="Use uma senha de 12 a 128 caracteres."
          fields={[
            {
              name: "current_password",
              label: "Senha atual",
              type: "password",
              required: true,
              full: true,
            },
            {
              name: "new_password",
              label: "Nova senha",
              type: "password",
              required: true,
              full: true,
            },
          ]}
          onClose={() => setPassword(false)}
          onSave={async (values) => {
            await api.post("/auth/password", values);
            logout();
          }}
        />
      )}
    </div>
  );
}
