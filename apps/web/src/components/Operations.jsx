import { useEffect, useRef, useState } from "react";
import {
  CheckCheck,
  Download,
  Eye,
  FileText,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  RotateCw,
  Undo2,
  ScanBarcode,
  ArrowRight,
} from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { notify, confirmAction } from "@zen/ui/lib/feedback";
import { createDecoder } from "@zen/ui/lib/scanner-client";
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
  money,
  useLoad,
} from "./common";
import { jobLabel, actionLabel } from "./Records";
import ControlledReview from "./ControlledReview";
import ServiceRules from "./ServiceRules";
function JobTable({ items, user, onRetry }) {
  return !items.length ? (
    <Empty
      title="A fila está vazia"
      description="Envios e sincronizações aparecerão aqui."
    />
  ) : (
    <div className="zc-table-scroll">
      <table className="zc-table">
        <thead>
          <tr>
            <th>TAREFA</th>
            <th>ORDEM</th>
            <th>SITUAÇÃO</th>
            <th>DETALHE</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((j) => (
            <tr key={j.id}>
              <td>
                <strong>{jobLabel(j.kind)}</strong>
                <small>{format(j.created_at, true)}</small>
              </td>
              <td className="zc-mono">{j.order_id || "—"}</td>
              <td>
                <Badge value={j.state} />
              </td>
              <td className="zc-job-error">{j.last_error || "—"}</td>
              <td>
                {["admin", "operador"].includes(user.papel) &&
                  ["failed", "uncertain"].includes(j.state) && (
                    <button
                      className="secondary-button"
                      onClick={() => onRetry(j)}
                    >
                      Revisar tentativa
                    </button>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Queue({ user, revision, refresh }) {
  const { data, loading, error } = useLoad("/jobs", revision),
    [retry, setRetry] = useState(null);
  return (
    <>
      <Intro
        title="Envios e confirmações."
        subtitle="Acompanhe as tarefas e confira falhas antes de repetir operações."
      />
      <Panel>
        {loading || error ? (
          <Loading error={error} />
        ) : (
          <JobTable items={data.items} user={user} onRetry={setRetry} />
        )}
      </Panel>
      {retry && (
        <FormModal
          title="Conferir nova tentativa"
          description={
            retry.state === "uncertain"
              ? "O envio pode ter ocorrido. Confira o serviço externo para evitar duplicação."
              : "Confira o erro e o resultado anterior antes de autorizar outra tentativa."
          }
          fields={[
            {
              name: "confirmed_no_effect",
              label: "Conferi no serviço externo que a operação não ocorreu.",
              type: "checkbox",
            },
          ]}
          submit="Autorizar nova tentativa"
          onClose={() => setRetry(null)}
          onSave={async (v) => {
            if (!v.confirmed_no_effect)
              throw Object.assign(Error("Confirmação necessária"), {
                response: {
                  data: { error: "Confirme a conferência antes de repetir." },
                },
              });
            await api.post("/jobs/" + retry.id + "/retry", v);
            setRetry(null);
            refresh();
            notify("Nova tentativa autorizada.");
          }}
        />
      )}
    </>
  );
}
function Photo({ file, onEdit }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true,
      uri;
    api
      .get("/evidence/" + file.id, { responseType: "blob" })
      .then((r) => {
        uri = URL.createObjectURL(r.data);
        if (active) setUrl(uri);
        else URL.revokeObjectURL(uri);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [file.id, file.sha256]);
  return (
    <div className="zc-photo">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="Foto do atendimento" />
        </a>
      ) : (
        <div className="zc-photo-placeholder">Foto indisponível</div>
      )}
      {onEdit && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => onEdit(file)}
        >
          Editar foto
        </button>
      )}
    </div>
  );
}
function PhotoEditor({ file, onClose, onSaved }) {
  const canvas = useRef(null),
    original = useRef(null),
    drag = useRef(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      uri;
    api
      .get("/evidence/" + file.id, { responseType: "blob" })
      .then(async (r) => {
        uri = URL.createObjectURL(r.data);
        const image = new Image();
        image.src = uri;
        await image.decode();
        if (!active) return;
        original.current = image;
        const c = canvas.current;
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        c.getContext("2d").drawImage(image, 0, 0);
        setBusy(false);
      })
      .catch((e) => {
        if (active) {
          setError(errorMessage(e));
          setBusy(false);
        }
      });
    return () => {
      active = false;
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [file.id]);
  function point(e) {
    const c = canvas.current,
      r = c.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * c.width) / r.width,
      ((e.clientY - r.top) * c.height) / r.height,
    ];
  }
  function rotate() {
    const c = canvas.current,
      t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    t.getContext("2d").drawImage(c, 0, 0);
    c.width = t.height;
    c.height = t.width;
    const x = c.getContext("2d");
    x.translate(c.width / 2, c.height / 2);
    x.rotate(Math.PI / 2);
    x.drawImage(t, -t.width / 2, -t.height / 2);
    x.setTransform(1, 0, 0, 1, 0, 0);
  }
  return (
    <Modal title="Editar foto" wide busy={busy} onClose={onClose}>
      <p className="dialog-description">
        Arraste sobre a imagem para cobrir uma área. O original será preservado.
      </p>
      <div className="zc-actions">
        <button className="secondary-button" disabled={busy} onClick={rotate}>
          <RotateCw size={15} />
          Girar 90°
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            const c = canvas.current,
              img = original.current;
            if (!img) return;
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext("2d").drawImage(img, 0, 0);
          }}
        >
          <Undo2 size={15} />
          Desfazer edição
        </button>
      </div>
      <canvas
        ref={canvas}
        className="zc-canvas"
        aria-label="Fotografia para edição"
        onPointerDown={(e) => {
          if (busy) return;
          const c = canvas.current;
          drag.current = {
            point: point(e),
            image: c.getContext("2d").getImageData(0, 0, c.width, c.height),
          };
          c.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const c = canvas.current,
            x = c.getContext("2d"),
            p = point(e),
            s = drag.current.point;
          x.putImageData(drag.current.image, 0, 0);
          x.fillStyle = "#172032";
          x.fillRect(s[0], s[1], p[0] - s[0], p[1] - s[1]);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary-button" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
        <button
          className="primary-button"
          disabled={busy || !original.current}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api.post("/evidence/" + file.id + "/edit", {
                image: canvas.current.toDataURL("image/jpeg", 0.94),
                sha256: file.sha256,
              });
              await onSaved();
              onClose();
              notify("Foto editada. Original preservado.");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar edição
        </button>
      </div>
    </Modal>
  );
}
export function Batches({ revision, refresh }) {
  const { data, loading, error } = useLoad("/batches", revision),
    [id, setId] = useState(null);
  return (
    <>
      <Intro
        title="Conferência de retornos."
        subtitle="Fotos, evidências e baixa dos atendimentos."
      />
      <div className="zc-notice">
        Confira os serviços enviados pelo portal dos técnicos. Instalações só
        são concluídas após a aprovação da central e a confirmação do Estoque
        Pro.
      </div>
      <Panel>
        {loading || error ? (
          <Loading error={error} />
        ) : !data.items.length ? (
          <Empty
            title="Nenhum retorno recebido"
            description="Os blocos enviados pelos técnicos aparecerão aqui."
          />
        ) : (
          <div className="zc-table-scroll">
            <table className="zc-table">
              <thead>
                <tr>
                  <th>VEÍCULO / OS</th>
                  <th>TÉCNICO</th>
                  <th>FOTOS</th>
                  <th>SITUAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.vehicle || "Identificação pendente"}</strong>
                      <small>{b.order_id || "Vínculo pendente"}</small>
                    </td>
                    <td>{b.technician_name}</td>
                    <td>
                      {b.ready_count} / {b.expected_count}
                    </td>
                    <td>
                      <Badge value={b.state} />
                    </td>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => setId(b.id)}
                      >
                        <Eye size={15} />
                        Conferir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {id && (
        <BatchReview id={id} onClose={() => setId(null)} onSaved={refresh} />
      )}
    </>
  );
}
function BatchReview({ id, onClose, onSaved }) {
  const [batch, setBatch] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(null),
    [values, setValues] = useState({
      order_id: "",
      reason: "",
      imeis: "",
      complete: false,
    });
  const decoder = useRef(null);
  async function reload() {
    const { data } = await api.get("/batches/" + id);
    setBatch(data);
    setValues((v) => ({
      ...v,
      order_id: data.order_id || v.order_id,
      imeis: v.imeis || (data.imeis || []).join(", "),
    }));
  }
  useEffect(() => {
    reload().catch((e) => setError(errorMessage(e)));
    return () => decoder.current?.close();
  }, [id]);
  useEffect(() => {
    if (batch?.state !== "approved_sync") return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const { data } = await api.get("/batches/" + id);
        if (active) {
          setBatch(data);
          if (data.state !== "approved_sync") onSaved();
        }
      } catch (e) {
        if (active) setError(errorMessage(e));
      }
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id, batch?.state]);
  const approved = ["approved", "completed"].includes(batch?.state);
  async function scan() {
    setBusy(true);
    setError("");
    try {
      decoder.current = createDecoder();
      await decoder.current.ready();
      const found = new Set();
      for (const f of batch.files.filter((f) => f.state === "ready")) {
        const { data } = await api.get("/evidence/" + f.id, {
          responseType: "blob",
        });
        const image = await createImageBitmap(data);
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const c = canvas.getContext("2d");
        c.drawImage(image, 0, 0);
        image.close();
        const results = await decoder.current.decode(
          c.getImageData(0, 0, canvas.width, canvas.height),
          "auto",
          "accurate",
        );
        for (const r of results)
          for (const code of r.text.match(/(?<!\d)\d{15}(?!\d)/g) || [])
            found.add(code);
      }
      setValues((v) => ({
        ...v,
        imeis: [
          ...new Set([
            ...v.imeis
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            ...found,
          ]),
        ].join(", "),
      }));
      notify(
        found.size
          ? `${found.size} candidato(s) detectado(s). Confira os números.`
          : "Nenhum IMEI detectado. Você pode digitá-lo.",
      );
    } catch (e) {
      setError(e.message || "Não foi possível ler as etiquetas.");
    } finally {
      decoder.current?.close();
      decoder.current = null;
      setBusy(false);
    }
  }
  if (
    batch &&
    (batch.source === "portal" ||
      batch.current_order?.workflow_mode === "controlled")
  )
    return (
      <Modal title="Conferir atendimento" wide onClose={onClose}>
        <ControlledReview
          key={batch.id}
          batch={batch}
          reload={reload}
          onSaved={onSaved}
        />
      </Modal>
    );
  return (
    <Modal title="Conferir retorno" wide busy={busy} onClose={onClose}>
      {!batch ? (
        <Loading error={error} />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api.post("/batches/" + id + "/review", values);
              await reload();
              onSaved();
              notify("Conferência registrada.");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="dialog-description">
            <b>{batch.vehicle || "Veículo sem identificação"}</b> ·{" "}
            <Badge value={batch.state} />
          </div>
          {batch.reason && (
            <div className="zc-notice amber">{batch.reason}</div>
          )}
          <div className="zc-evidence-grid">
            {batch.files.map((f) =>
              f.state === "ready" ? (
                <Photo
                  key={f.id}
                  file={f}
                  onEdit={approved ? undefined : setEdit}
                />
              ) : (
                <div key={f.id} className="zc-photo-placeholder">
                  Foto pendente / falhou
                </div>
              ),
            )}
          </div>
          <p className="zc-comments">{batch.notes}</p>
          {!approved && (
            <div className="zc-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !batch.expected_count}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      "Solicitar novo download das fotos deste lote?",
                    ))
                  )
                    return;
                  setBusy(true);
                  try {
                    await api.post("/batches/" + id + "/redownload");
                    await reload();
                    onSaved();
                    notify("Novo download solicitado.");
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={15} />
                Baixar fotos novamente
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !batch.files.some((f) => f.state === "ready")}
                onClick={scan}
              >
                <ScanBarcode size={15} />
                Ler IMEIs das fotos
              </button>
            </div>
          )}
          {approved ? (
            <div className="zc-notice">
              Lote revisado por {batch.reviewed_by}.{" "}
              {batch.sga_uploaded_at
                ? "Envio ao SGA confirmado."
                : "As fotos podem ser enviadas ao SGA."}
            </div>
          ) : (
            <div className="zc-form-grid">
              <Field
                label="OS correspondente"
                name="order_id"
                value={values.order_id}
                required
                full
                onChange={(e) =>
                  setValues((v) => ({ ...v, order_id: e.target.value }))
                }
              />
              <Field
                label="IMEIs conferidos (separados por vírgula)"
                name="imeis"
                value={values.imeis}
                full
                onChange={(e) =>
                  setValues((v) => ({ ...v, imeis: e.target.value }))
                }
              />
              <Field
                label="Resultado da conferência"
                name="reason"
                value={values.reason}
                required
                type="textarea"
                full
                onChange={(e) =>
                  setValues((v) => ({ ...v, reason: e.target.value }))
                }
              />
              <label className="zc-checkbox zc-full">
                <input
                  type="checkbox"
                  checked={values.complete}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, complete: e.target.checked }))
                  }
                />
                Concluir a OS após aprovar as fotos
              </label>
            </div>
          )}
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
              Fechar
            </button>
            {approved && !batch.sga_uploaded_at && (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post("/batches/" + id + "/upload");
                    notify("Envio de fotos adicionado à fila.");
                    onSaved();
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Send size={15} />
                Enviar fotos ao SGA
              </button>
            )}
            {!approved && (
              <button className="primary-button" disabled={busy}>
                Aprovar conferência
              </button>
            )}
          </div>
        </form>
      )}
      {edit && (
        <PhotoEditor
          file={edit}
          onClose={() => setEdit(null)}
          onSaved={reload}
        />
      )}
    </Modal>
  );
}
export function Finance({ revision, refresh }) {
  const { data: techs } = useLoad("/technicians", revision),
    {
      data: settlements,
      loading,
      error,
    } = useLoad("/finance/settlements", revision);
  const [values, setValues] = useState({
      technician_id: "",
      start: new Date().toISOString().slice(0, 7) + "-01",
      end: new Date().toISOString().slice(0, 10),
    }),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState("");
  return (
    <>
      <Intro
        title="Fechamentos com clareza."
        subtitle="Confira valores, adicionais e serviços antes de registrar o fechamento."
      />
      <div className="zc-notice">
        Entram na prévia apenas serviços concluídos, com data válida e ainda sem
        fechamento. Os valores vêm do cadastro do técnico e dos adicionais da
        OS.
      </div>
      <Panel title="Novo fechamento" subtitle="Selecione o técnico e o período">
        <form
          className="zc-filters"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFailure("");
            try {
              setPreview(
                (
                  await api.get(
                    "/finance/preview?" + new URLSearchParams(values),
                  )
                ).data,
              );
            } catch (e) {
              setFailure(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <select
            aria-label="Técnico"
            required
            value={values.technician_id}
            onChange={(e) =>
              setValues((v) => ({ ...v, technician_id: e.target.value }))
            }
          >
            <option value="">Selecione um técnico</option>
            {techs?.items.map((t) => (
              <option value={t.id} key={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Início do período"
            required
            value={values.start}
            onChange={(e) =>
              setValues((v) => ({ ...v, start: e.target.value }))
            }
          />
          <span>até</span>
          <input
            type="date"
            aria-label="Fim do período"
            required
            value={values.end}
            onChange={(e) => setValues((v) => ({ ...v, end: e.target.value }))}
          />
          <button className="primary-button" disabled={busy}>
            Calcular prévia
          </button>
        </form>
        {failure && (
          <div className="form-error" role="alert">
            {failure}
          </div>
        )}
        {!preview ? (
          <Empty
            title="Confira antes de fechar"
            description="Os serviços e o valor total aparecerão aqui."
          />
        ) : !preview.orders.length ? (
          <Empty
            title="Nenhum serviço elegível"
            description="Confira o técnico, o período e as datas de conclusão."
          />
        ) : (
          <>
            <div className="zc-table-scroll">
              <table className="zc-table">
                <thead>
                  <tr>
                    <th>ORDEM / VEÍCULO</th>
                    <th>SERVIÇO</th>
                    <th>BASE</th>
                    <th>ADICIONAIS</th>
                    <th>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.orders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.id}</strong>
                        <small>{o.vehicle}</small>
                      </td>
                      <td>{o.service}</td>
                      <td>{money(o.base_cents)}</td>
                      <td>{money(o.total_cents - o.base_cents)}</td>
                      <td>
                        <strong>{money(o.total_cents)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="zc-finance-total">
              <div>
                <span>{preview.orders.length} serviço(s)</span>
                <strong>{money(preview.total_cents)}</strong>
              </div>
              <button
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await confirmAction(
                      `Registrar o fechamento de ${preview.technician.name} no valor de ${money(preview.total_cents)}?`,
                      { title: "Registrar fechamento" },
                    ))
                  )
                    return;
                  setBusy(true);
                  try {
                    await api.post("/finance/settlements", {
                      technician_id: preview.technician.id,
                      start: preview.start,
                      end: preview.end,
                      expected_total: preview.total_cents,
                      order_ids: preview.orders.map((o) => o.id),
                    });
                    setPreview(null);
                    refresh();
                    notify("Fechamento registrado.");
                  } catch (e) {
                    setFailure(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <CheckCheck size={16} />
                Registrar fechamento
              </button>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Fechamentos registrados" className="zc-section-gap">
        {loading || error ? (
          <Loading error={error} />
        ) : !settlements.items.length ? (
          <Empty description="Os fechamentos registrados aparecerão aqui." />
        ) : (
          <div className="zc-table-scroll">
            <table className="zc-table">
              <thead>
                <tr>
                  <th>TÉCNICO</th>
                  <th>PERÍODO</th>
                  <th>TOTAL</th>
                  <th>RESPONSÁVEL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settlements.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.technician_name}</strong>
                    </td>
                    <td>
                      {format(s.start_date)} a {format(s.end_date)}
                    </td>
                    <td>{money(s.total_cents)}</td>
                    <td>{s.created_by}</td>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          download(
                            "/finance/settlements/" + s.id + "/pdf",
                            "Fechamento-" + s.id + ".pdf",
                          ).catch((e) => notify(errorMessage(e), "error"))
                        }
                      >
                        <Download size={14} />
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
export function HistoryPage({ revision }) {
  const [page, setPage] = useState(1),
    { data, loading, error } = useLoad(
      "/audit?page=" + page + "&limit=25",
      revision,
    );
  return (
    <>
      <Intro
        title="Cada alteração tem um registro."
        subtitle="Acompanhe a pessoa responsável, a data e a referência da operação."
      />
      <Panel>
        {loading || error ? (
          <Loading error={error} />
        ) : (
          <>
            <div className="zc-table-scroll">
              <table className="zc-table">
                <thead>
                  <tr>
                    <th>DATA E HORA</th>
                    <th>RESPONSÁVEL</th>
                    <th>AÇÃO</th>
                    <th>REFERÊNCIA</th>
                    <th>DETALHES</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td>{format(a.created_at, true)}</td>
                      <td>{a.actor}</td>
                      <td>{actionLabel(a.action)}</td>
                      <td className="zc-mono">{a.entity_id.slice(0, 25)}</td>
                      <td>
                        <details>
                          <summary>Ver alterações</summary>
                          <pre className="zc-pre">
                            {JSON.stringify(a.detail, null, 2)}
                          </pre>
                        </details>
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
export function SettingsPage({ revision, refresh, navigate }) {
  const { data, loading, error } = useLoad("/settings", revision),
    [qr, setQr] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [preview, setPreview] = useState(null);
  async function call(path, method = "get") {
    setBusy(true);
    try {
      const r = await api[method](path);
      if (method === "post")
        notify(
          "Inicialização solicitada. Aguarde o QR Code ou confira a conexão.",
        );
      else
        setResult({
          title: path.includes("groups")
            ? "Grupos disponíveis"
            : "Conexão do WhatsApp",
          data: r.data,
        });
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  if (loading || error) return <Loading error={error} />;
  return (
    <>
      <Intro
        title="Sua operação, bem configurada."
        subtitle="Integrações, continuidade e organização dos dados."
      />
      <div className="zc-settings-grid">
        <Panel
          title="Integrações da operação"
          subtitle="Controle dos canais e das confirmações"
        >
          <div className="zc-panel-padding">
            {[
              [
                "Integrações externas",
                data.integrations_enabled,
                "Habilitação dos serviços no servidor.",
              ],
              [
                "Estoque Pro",
                data.stock_enabled && data.stock_configured,
                "Instalação registrada após aprovação da central.",
              ],
              [
                "Portal dos técnicos",
                data.portal_requires_central_approval,
                "Acesso individual, fotos e IMEIs vinculados ao serviço.",
              ],
              [
                "SGA Hinova",
                data.sga_configured,
                "Consulta, classificação e fotos do veículo.",
              ],
              [
                "Baixa automática",
                data.auto_close_enabled,
                "Aplicável somente às OS do fluxo legado. O portal exige a central.",
              ],
              [
                "Classificação no SGA",
                data.sga_sync_enabled,
                "Atualização após envio confirmado ou baixa.",
              ],
            ].map(([title, on, description]) => (
              <div className="zc-info-row" key={title}>
                <div>
                  <b>{title}</b>
                  <small>{description}</small>
                </div>
                <span className={"zc-state " + (on ? "on" : "")}>
                  {on ? "Configurado / ativo" : "Desativado"}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Dados e continuidade"
          subtitle="Exporte e preserve o histórico"
        >
          <div className="zc-panel-padding">
            <div className="zc-notice">
              A migração importa os bancos antigos em uma transação, com
              simulação e cópias prévias. Os arquivos originais permanecem
              preservados.
            </div>
            <div className="zc-info-row">
              <div>
                <b>Envios e sincronizações</b>
                <small>{data.pending_jobs} tarefa(s) por concluir</small>
              </div>
              <button
                className="secondary-button"
                onClick={() => navigate("queue")}
              >
                Abrir fila
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="zc-actions zc-section-gap">
              <button
                className="secondary-button"
                onClick={() =>
                  download("/backup", "ZenControl-backup.zip").catch((e) =>
                    notify(errorMessage(e), "error"),
                  )
                }
              >
                <Download size={14} />
                Baixar backup
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  download("/export/orders.csv", "ZenControl-ordens.csv").catch(
                    (e) => notify(errorMessage(e), "error"),
                  )
                }
              >
                <FileText size={14} />
                Exportar CSV
              </button>
            </div>
            <h3 className="zc-section-gap">Organizar bases por mês</h3>
            <p className="zc-muted">
              Ordens abertas permanecem no HOT. Serviços encerrados seguem para
              WARM e COLD sem excluir dados.
            </p>
            <form
              className="zc-actions"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  setPreview(
                    (await api.post("/archive-month", { month, dry_run: true }))
                      .data,
                  );
                } catch (e) {
                  notify(errorMessage(e), "error");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <input
                type="month"
                aria-label="Mês de referência"
                required
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setPreview(null);
                }}
              />
              <button className="secondary-button" disabled={busy}>
                Simular organização
              </button>
            </form>
            {preview && (
              <div className="zc-notice zc-section-gap">
                {preview.count} OS terão a base alterada.
                {preview.count > 0 && (
                  <button
                    type="button"
                    className="zc-link"
                    onClick={async () => {
                      if (
                        !(await confirmAction(
                          "Aplicar a organização das bases referente a " +
                            preview.month +
                            "?",
                        ))
                      )
                        return;
                      try {
                        const { data } = await api.post("/archive-month", {
                          month: preview.month,
                          dry_run: false,
                        });
                        notify(`${data.count} registro(s) reorganizados.`);
                        setPreview(null);
                        refresh();
                      } catch (e) {
                        notify(errorMessage(e), "error");
                      }
                    }}
                  >
                    Aplicar organização
                  </button>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>
      <ServiceRules revision={revision} refresh={refresh} />
      {result && (
        <Modal title={result.title} onClose={() => setResult(null)}>
          {result.data.items ? (
            <div className="zc-panel-padding">
              {result.data.items.map((g) => (
                <div className="zc-info-row" key={g.id}>
                  <div>
                    <b>{g.name || g.id}</b>
                    <small className="zc-mono">{g.id}</small>
                  </div>
                </div>
              ))}
              {!result.data.items.length && <p>Nenhum grupo retornado.</p>}
            </div>
          ) : (
            <pre className="zc-pre zc-panel-padding">
              {JSON.stringify(result.data.result, null, 2)}
            </pre>
          )}
          <div className="dialog-actions">
            <button
              className="secondary-button"
              onClick={() => setResult(null)}
            >
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
