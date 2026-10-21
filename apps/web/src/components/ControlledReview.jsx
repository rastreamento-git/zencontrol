import { useState, useEffect } from "react";
import { CheckCheck, Send, Undo2, RefreshCw } from "lucide-react";
import { api, errorMessage } from "@zen/ui/lib/api";
import { notify, confirmAction } from "@zen/ui/lib/feedback";
import { EvidencePhoto } from "@zen/ui/components/ServiceEvidence";
import { Badge } from "./common";
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
  const reuse =
    batch.current_order?.document_data?.reinstallation &&
    batch.current_order?.document_data?.reuse_equipment;
  useEffect(() => {
    setReason("");
    setError("");
  }, [batch.id, batch.version]);
  const codes = batch.imeis || [];
  const [reason, setReason] = useState(""),
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
        {reuse
          ? "Confira se as etiquetas e fotos correspondem aos equipamentos reaproveitados neste veículo. A aprovação registra a reinstalação sem consumir novamente a carga do técnico."
          : batch.rule?.stock_action === "install"
            ? "Confira as fotos e o checklist enviado pelo técnico. Os equipamentos já estão identificados neste registro; basta confirmar para concluir a OS. A confirmação no Estoque Pro é automática."
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
          <EvidencePhoto key={f.id} file={f} prefix="" />
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
      {codes.length > 0 && (
        <div className="portal-review-codes">
          <h3>Equipamentos registrados pelo técnico</h3>
          <div
            className="portal-code-list"
            aria-label="IMEIs e seriais registrados"
          >
            {codes.map((code) => (
              <code key={code}>{code}</code>
            ))}
          </div>
        </div>
      )}
      {(reviewable || correctable) && (
        <label className="zc-field zc-full">
          Observações da conferência (opcionais para confirmar)
          <textarea
            value={reason}
            disabled={busy}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            maxLength={1000}
            rows={3}
            placeholder="Se precisar devolver o envio, descreva o que deve ser corrigido."
          />
        </label>
      )}
      {reviewable && (
        <p className="zc-muted">
          Ao confirmar, você declara que conferiu as fotos, o veículo e o
          checklist preenchido e assinado.
          {reuse &&
            " A confirmação também atesta o reaproveitamento dos equipamentos fotografados neste veículo."}
        </p>
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
            disabled={busy}
            onClick={() =>
              act(async () => {
                const r = await api.post("/batches/" + batch.id + "/approve", {
                  version: batch.version,
                  order_version: batch.current_order.version,
                  reason,
                  checklist_reviewed: true,
                  reuse_confirmed: Boolean(reuse),
                });
                notify(
                  r.data.status === "AGUARDANDO ESTOQUE"
                    ? "Conferência confirmada. A OS será concluída automaticamente após a confirmação do estoque."
                    : "OS concluída.",
                );
              })
            }
          >
            <CheckCheck size={16} />
            Confirmar e concluir OS
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
