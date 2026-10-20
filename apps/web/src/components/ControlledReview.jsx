import { useState, useEffect } from "react";
import { CheckCheck, Send, Undo2, RefreshCw } from "lucide-react";
import LeitorSeriais from "@zen/ui/components/LeitorSeriais";
import { api, errorMessage } from "@zen/ui/lib/api";
import { notify, confirmAction } from "@zen/ui/lib/feedback";
import { EvidencePhoto, photoLabels } from "@zen/ui/components/ServiceEvidence";
import { Badge } from "./common";
function Classification({ file, batch, reload, disabled }) {
  const [kind, setKind] = useState(file.kind),
    [serial, setSerial] = useState(file.serial_code || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="portal-review-kinds">
      <label>
        Tipo de evidência
        <select
          disabled={disabled || busy}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          {Object.entries(photoLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {kind === "label" && (
        <label>
          IMEI/serial da etiqueta
          <input
            disabled={disabled || busy}
            value={serial}
            maxLength={128}
            onChange={(e) => setSerial(e.target.value)}
          />
        </label>
      )}
      {!disabled && (
        <button
          className="secondary-button"
          disabled={
            busy || (kind === file.kind && serial === (file.serial_code || ""))
          }
          type="button"
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api.patch("/evidence/" + file.id + "/classify", {
                version: batch.version,
                kind,
                serial_code: serial,
              });
              await reload();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar classificação
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export default function ControlledReview({ batch, reload, onSaved }) {
  useEffect(() => {
    if (
      batch.current_order?.id &&
      ["submitted", "ready", "needs_review"].includes(batch.state)
    )
      api
        .post("/orders/" + batch.current_order.id + "/conference")
        .catch(() => {});
  }, [batch.id]);
  const [checklistReviewed, setChecklistReviewed] = useState(false);
  const [codes, setCodes] = useState(batch.imeis || []),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const reviewable = ["submitted", "ready", "needs_review"].includes(
      batch.state,
    ),
    correctable = ["submitted", "stock_failed"].includes(batch.state);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="portal-controlled-review">
      <div className="dialog-description">
        <b>
          {batch.vehicle} · {batch.order_id}
        </b>{" "}
        <Badge value={batch.state} />
      </div>
      {batch.current_order?.tracker_waiver_authorized && (
        <div className="zc-notice">
          <b>Dispensa de rastreador autorizada</b>
          <p>
            Esta OS não integra a remuneração do técnico, incluindo adicionais e
            ajustes. Confira a vistoria e o checklist assinado. A aprovação não
            registra instalação no estoque.
          </p>
        </div>
      )}
      <div className="zc-notice">
        {batch.rule?.stock_action === "install"
          ? "Ao aprovar, o Estoque Pro valida os IMEIs na carga do técnico e registra a instalação. A OS será concluída após o recibo de confirmação."
          : "A conclusão deste serviço exige sua conferência das evidências. Este serviço não registra instalação no estoque."}
      </div>
      {batch.state === "stock_failed" && (
        <div className="zc-notice amber">
          O estoque recusou a instalação. Confira a carga e o vínculo do
          técnico. Solicite correção do envio ou, após corrigir o
          cadastro/carga, revise a tentativa na fila de integrações.
        </div>
      )}
      {batch.reason && (
        <p className="zc-comments">Conferência: {batch.reason}</p>
      )}
      {batch.rejection_reason && (
        <p className="zc-comments">Correção: {batch.rejection_reason}</p>
      )}
      <p className="zc-comments">{batch.notes || "Sem relato adicional."}</p>
      <div className="zc-evidence-grid">
        {batch.files.map((f) => (
          <EvidencePhoto key={f.id} file={f} prefix="">
            {(batch.capture_version < 2 ||
              !["label", "checklist"].includes(f.kind)) && (
              <Classification
                key={f.id + ":" + f.kind + ":" + f.serial_code}
                file={f}
                batch={batch}
                reload={reload}
                disabled={!reviewable || busy}
              />
            )}
          </EvidencePhoto>
        ))}
      </div>
      {batch.rule && (
        <div className="portal-code-list">
          <span className="zc-badge gray">Fotos gerais: opcionais</span>
          {Object.entries(batch.required_equipment || {})
            .filter(([, quantity]) => quantity > 0)
            .map(([type, quantity]) => (
              <span className="zc-badge gray" key={type}>
                {type}:{" "}
                {
                  new Set(
                    batch.files
                      .filter(
                        (f) =>
                          f.kind === "label" &&
                          f.equipment_type === type &&
                          f.state === "ready",
                      )
                      .map((f) => f.serial_code),
                  ).size
                }
                /{quantity}
              </span>
            ))}
        </div>
      )}
      {reviewable && batch.rule?.stock_action === "install" && (
        <div className="portal-review-codes">
          <h3>IMEIs/seriais conferidos</h3>
          <fieldset className="portal-scanner-field" disabled={busy}>
            <LeitorSeriais
              maxBatch={20}
              seriais={codes}
              setSeriais={(next) => {
                setCodes(next);
                setConfirmed(false);
              }}
            />
          </fieldset>
          <p className="zc-muted">
            Cada código precisa corresponder à foto de etiqueta e à carga do
            técnico responsável.
          </p>
        </div>
      )}
      {!reviewable && (
        <div className="portal-code-list">
          {codes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>
      )}
      {(reviewable || correctable) && (
        <label className="zc-field zc-full">
          Resultado da conferência / correção necessária
          <textarea
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirmed(false);
            }}
            maxLength={1000}
            rows={3}
            placeholder="Descreva a conferência ou o que precisa ser corrigido."
          />
        </label>
      )}
      {reviewable && batch.capture_version >= 2 && (
        <label className="zc-checkbox">
          <input
            type="checkbox"
            checked={checklistReviewed}
            disabled={busy}
            onChange={(e) => setChecklistReviewed(e.target.checked)}
          />
          Abri o checklist e conferi o preenchimento e a assinatura.
        </label>
      )}
      {reviewable && (
        <label className="zc-checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Conferi veículo, técnico, fotos e códigos deste serviço.
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {correctable && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || reason.trim().length < 5}
            onClick={async () => {
              if (
                await confirmAction(
                  "Solicitar correção ao técnico com este motivo?",
                )
              )
                act(() =>
                  api.post("/batches/" + batch.id + "/reject", {
                    version: batch.version,
                    reason,
                  }),
                );
            }}
          >
            <Undo2 size={16} />
            Solicitar correção
          </button>
        )}
        {reviewable && (
          <button
            type="button"
            className="primary-button"
            disabled={
              busy ||
              !confirmed ||
              reason.trim().length < 5 ||
              (batch.capture_version >= 2 && !checklistReviewed)
            }
            onClick={() =>
              act(async () => {
                const r = await api.post("/batches/" + batch.id + "/approve", {
                  version: batch.version,
                  order_version: batch.current_order.version,
                  reason,
                  serials: codes,
                  checklist_reviewed: checklistReviewed,
                });
                notify(
                  r.data.status === "AGUARDANDO ESTOQUE"
                    ? "Conferência aprovada. Aguardando o Estoque Pro."
                    : "Serviço confirmado.",
                );
              })
            }
          >
            <CheckCheck size={16} />
            Aprovar conferência
          </button>
        )}
        {batch.state === "completed" && !batch.sga_uploaded_at && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              act(() => api.post("/batches/" + batch.id + "/upload"))
            }
          >
            <Send size={16} />
            Enviar fotos ao SGA
          </button>
        )}
        {!reviewable && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => act(async () => {})}
          >
            <RefreshCw size={16} />
            Atualizar situação
          </button>
        )}
      </div>
    </div>
  );
}
