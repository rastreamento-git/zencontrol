const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const { createMediaStore } = require("./media-store");
const { identifyEquipment } = require("./equipment-photo");
const { PDFDocument } = require("pdf-lib");
const { transaction } = require("./database");
const { fail, integer, serials } = require("./errors");
const d = require("./domain"),
  o = require("./orders");
const kinds = [
  "vehicle",
  "label",
  "installed",
  "service",
  "other",
  "inspection",
  "checklist",
];
async function technician(db, userId) {
  const scope = require("./field-access").context.getStore();
  if (
    scope?.delegated &&
    scope.actor.id === userId &&
    ["admin", "operador"].includes(scope.actor.papel)
  ) {
    const selected = await d.one(
      db,
      "SELECT * FROM zc_technicians WHERE id=$1 AND active=true",
      [scope.technician.id],
    );
    if (!selected) fail(403, "Técnico selecionado está inativo.");
    return selected;
  }
  const t = await d.one(
    db,
    "SELECT t.* FROM zc_technician_accounts a JOIN zc_technicians t ON t.id=a.technician_id WHERE a.user_id=$1 AND t.active=true",
    [userId],
  );
  if (!t) fail(403, "Acesso técnico sem cadastro ativo vinculado.");
  return t;
}
async function ownOrder(db, userId, id) {
  const t = await technician(db, userId),
    order = await o.get(db, id);
  if (order.technician_id !== t.id)
    fail(404, "Serviço indisponível para este acesso.");
  return { t, order };
}
async function batch(db, id) {
  const b = await d.one(db, "SELECT * FROM zc_batches WHERE id=$1", [id]);
  if (!b) fail(404, "Envio não encontrado.");
  return b;
}
function generalPhotoMinimum(rule, captureVersion = 2) {
  const general = rule.required_photos.filter(
    (p) => !["label", "checklist"].includes(p.kind),
  );
  const total = general.reduce((sum, p) => sum + p.min, 0);
  const inspection = general.find((p) => p.kind === "inspection")?.min || 0;
  return total + (captureVersion >= 2 ? Math.max(0, 1 - inspection) : 0);
}
async function rule(db, service, order = null) {
  const key = d.services.find((s) => service.startsWith(s));
  let r = await d.one(db, "SELECT * FROM zc_service_rules WHERE service=$1", [
    key || service,
  ]);
  if (!r) fail(409, "Defina as regras deste serviço antes de continuar.");
  if (order?.tracker_waiver_authorized)
    r = {
      ...r,
      stock_action: "none",
      min_serials: 0,
      required_photos: r.required_photos.filter(
        (p) => !["label", "installed"].includes(p.kind),
      ),
    };
  return { ...r, general_photo_min: generalPhotoMinimum(r) };
}
const snapshot = (order) => ({
  id: order.id,
  vehicle: order.vehicle,
  chassis: order.chassis,
  service: order.service,
  tracker_waiver_authorized: order.tracker_waiver_authorized,
  technician_id: order.technician_id,
  customer_name: order.customer_name,
  scheduled_at: order.scheduled_at,
});
const publicOrder = (order) =>
  Object.fromEntries(
    [
      "id",
      "vehicle",
      "chassis",
      "customer_name",
      "contact",
      "service",
      "location",
      "scheduled_at",
      "notes",
      "status",
      "version",
      "stock_sync_state",
      "workflow_mode",
      "tracker_waiver_authorized",
      "executed_on",
      "execution_finished_at",
      "conference_started_at",
    ].map((k) => [k, order[k]]),
  );
async function ownBatch(db, userId, id) {
  const b = await batch(db, id);
  const { t, order } = await ownOrder(db, userId, b.order_id);
  if (b.source !== "portal" || b.technician_id !== t.id)
    fail(404, "Envio indisponível.");
  return { b, t, order };
}
function editable(b, order, version) {
  if (b.state !== "draft") fail(409, "Este envio não está mais em edição.");
  if (b.version !== version) fail(409, "O envio mudou. Atualize a tela.");
  if (b.order_version !== order.version)
    fail(
      409,
      "A OS foi alterada. Descarte o rascunho e revise os dados atuais.",
    );
  if (["CONCLUÍDO", "CANCELADO"].includes(order.status))
    fail(409, "Serviço encerrado.");
}
async function startDraft(pool, userId, id, version) {
  return transaction(pool, async (db) => {
    const { t, order } = await ownOrder(db, userId, id);
    if (order.workflow_mode !== "controlled")
      fail(
        409,
        "Esta OS pertence ao fluxo anterior. A administração precisa criar uma OS do fluxo integrado.",
      );
    if (order.version !== version) fail(409, "A OS mudou. Atualize a tela.");
    if (["CONCLUÍDO", "CANCELADO", "AGUARDANDO ESTOQUE"].includes(order.status))
      fail(409, "Serviço indisponível para novo envio.");
    const existing = await d.one(
      db,
      "SELECT * FROM zc_batches WHERE order_id=$1 AND source='portal' AND state IN ('draft','submitted','approved_sync','stock_failed')",
      [id],
    );
    if (existing) {
      if (
        existing.state === "draft" &&
        (existing.order_version !== order.version ||
          existing.technician_id !== t.id)
      ) {
        await o.update(
          db,
          "zc_batches",
          "id",
          existing.id,
          {
            state: "withdrawn",
            reason: "Rascunho substituído após alteração da OS.",
          },
          true,
        );
      } else return existing;
    }
    const updated = await o.update(
      db,
      "zc_orders",
      "id",
      id,
      { status: "EM EXECUÇÃO", updated_at: d.now() },
      true,
    );
    const result = await o.insert(db, "zc_batches", {
      id: randomUUID(),
      order_id: id,
      technician_id: t.id,
      source: "portal",
      capture_version: 2,
      source_user_id: userId,
      sender: "portal",
      vehicle: order.vehicle,
      state: "draft",
      created_at: d.now(),
      order_version: updated.version,
      order_snapshot: JSON.stringify(snapshot(order)),
    });
    await d.audit(db, String(userId), "portal_draft", "batch", result.id, {
      order_id: id,
    });
    return result;
  });
}
async function upload(pool, cfg, userId, id, input) {
  const kind = input.kind ?? "other";
  if (!kinds.includes(kind)) fail(400, "Selecione o tipo de foto.");
  const initial = await ownBatch(pool, userId, id);
  editable(initial.b, initial.order, input.version);
  if (typeof input.image !== "string" || input.image.length > 12 * 1024 * 1024)
    fail(400, "Arquivo inválido ou acima do limite.");
  const raw = Buffer.from(input.image.split(",").at(-1), "base64");
  let bytes,
    mime = "image/jpeg",
    extension = ".jpg";
  if (kind === "checklist" && raw.subarray(0, 5).toString() === "%PDF-") {
    try {
      const pdf = await PDFDocument.load(raw);
      if (
        !pdf.getPageCount() ||
        pdf.getPageCount() > 30 ||
        raw.length > 8 * 1024 * 1024
      )
        throw Error();
      // Parse the file to reject malformed and encrypted PDFs; preserve signed originals.
      bytes = raw;
      mime = "application/pdf";
      extension = ".pdf";
    } catch {
      fail(
        400,
        "Checklist inválido. Envie um PDF sem senha de até 8 MB e 30 páginas, ou fotos das páginas assinadas.",
      );
    }
  } else {
    try {
      const image = sharp(raw, { limitInputPixels: 24000000 });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format)) throw Error();
      bytes = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      fail(
        400,
        "A foto não pôde ser processada. Use JPEG, PNG ou WebP; o checklist também aceita PDF.",
      );
    }
  }
  const equipment =
    kind === "label"
      ? await identifyEquipment(bytes, initial.t, cfg)
      : { serial_code: "", equipment_type: "", equipment_model: "" };
  return transaction(pool, async (db) => {
    const { b, order } = await ownBatch(db, userId, id);
    editable(b, order, input.version);
    if (
      Number(
        (
          await d.one(
            db,
            "SELECT count(*) n FROM zc_evidence WHERE batch_id=$1",
            [id],
          )
        ).n,
      ) >= 30
    )
      fail(400, "Limite de 30 fotos por serviço.");
    const eid = randomUUID(),
      sha = createHash("sha256").update(bytes).digest("hex"),
      name = eid + "-" + sha.slice(0, 12) + extension;
    await createMediaStore(cfg).put(name, bytes);
    await o.insert(db, "zc_evidence", {
      id: eid,
      batch_id: id,
      message_id: "portal:" + eid,
      path: name,
      mime,
      sha256: sha,
      state: "ready",
      kind,
      ...equipment,
    });
    await db.query(
      "UPDATE zc_batches SET version=version+1,expected_count=expected_count+1 WHERE id=$1",
      [id],
    );
    await d.audit(db, String(userId), "portal_photo_added", "batch", id, {
      evidence_id: eid,
      kind,
    });
    return { id: eid, version: b.version + 1, ...equipment };
  });
}
function requiredEquipment(order) {
  const selected = order.tracker_waiver_authorized
    ? []
    : order.document_data?.equipment || [];
  return {
    RASTREADOR:
      Number(selected.includes("tracker")) +
      Number(selected.includes("tracker_extra")),
    TAG: Number(selected.includes("tag")),
  };
}
async function verifyEvidence(db, b, r, codes, order) {
  if (order.tracker_waiver_authorized && codes.length)
    fail(
      400,
      "OS com dispensa de rastreador não registra instalação de equipamentos.",
    );
  const files = await d.rows(
    db,
    "SELECT * FROM zc_evidence WHERE batch_id=$1",
    [b.id],
  );
  if (
    !files.length ||
    files.some((f) => f.state !== "ready") ||
    files.length !== b.expected_count
  )
    fail(400, "Todas as fotos precisam estar prontas.");
  const requiredPhotos = r.required_photos.filter((p) =>
    ["label", "checklist"].includes(p.kind),
  );
  for (const required of requiredPhotos)
    if (files.filter((f) => f.kind === required.kind).length < required.min)
      fail(400, "Foto obrigatória pendente: " + required.label + ".");
  {
    const minimum = generalPhotoMinimum(r, b.capture_version);
    const received = files.filter(
      (f) => !["label", "checklist"].includes(f.kind),
    ).length;
    if (received < minimum)
      fail(
        400,
        "Anexe pelo menos " +
          minimum +
          " fotos do atendimento. Recebidas: " +
          received +
          ".",
      );
  }
  if (b.capture_version >= 2 && !files.some((f) => f.kind === "checklist"))
    fail(400, "Anexe o checklist preenchido e assinado (PDF ou fotos).");
  if (codes.length < r.min_serials)
    fail(400, "Informe os IMEIs/seriais exigidos para este serviço.");
  if (
    r.stock_action === "install" &&
    codes.some(
      (code) =>
        !files.some((f) => f.kind === "label" && f.serial_code === code),
    )
  )
    fail(400, "Vincule uma foto da etiqueta a cada IMEI/serial informado.");
  if (
    b.capture_version >= 2 &&
    r.stock_action === "install" &&
    files.some(
      (f) =>
        f.kind === "label" &&
        (!codes.includes(f.serial_code) ||
          !["RASTREADOR", "TAG"].includes(f.equipment_type)),
    )
  )
    fail(
      400,
      "Confira os equipamentos identificados nas fotos antes de enviar.",
    );
  if (b.capture_version >= 2 && r.stock_action === "install") {
    for (const [type, min] of Object.entries(requiredEquipment(order))) {
      const received = new Set(
        files
          .filter(
            (f) =>
              f.kind === "label" &&
              f.equipment_type === type &&
              codes.includes(f.serial_code),
          )
          .map((f) => f.serial_code),
      );
      if (received.size < min)
        fail(
          400,
          "A OS exige " +
            min +
            " equipamento(s) do tipo " +
            type +
            ". Envie a foto de cada etiqueta.",
        );
    }
  }
  return files;
}
async function submit(pool, userId, id, input) {
  return transaction(pool, async (db) => {
    const { b, order } = await ownBatch(db, userId, id);
    editable(b, order, input.version);
    if (input.confirmed !== true)
      fail(400, "Confira o veículo, as fotos e os IMEIs antes de enviar.");
    if (b.capture_version >= 2 && input.checklist_signed !== true)
      fail(400, "Confirme que o checklist está preenchido e assinado.");
    const codes = input.serials?.length ? serials(input.serials).sort() : [];
    if (codes.length > 20) fail(400, "Limite de 20 equipamentos por serviço.");
    const r = await rule(db, order.service, order);
    await verifyEvidence(db, b, r, codes, order);
    const notes = d.string(input.notes || "", "Relato do serviço", 6000);
    const executedOn =
      input.executed_on || b.executed_on || order.executed_on || d.today();
    require("./financial-calendar").date(executedOn);
    if (executedOn > d.today()) fail(400, "Execução não pode ter data futura.");
    await require("./finance-engine").capture(db, order, executedOn);
    const updated = await o.update(
      db,
      "zc_orders",
      "id",
      order.id,
      {
        status: "AGUARDANDO CONFERÊNCIA",
        executed_on: executedOn,
        execution_finished_at: order.execution_finished_at || d.now(),
        updated_at: d.now(),
      },
      true,
    );
    await o.update(
      db,
      "zc_batches",
      "id",
      id,
      {
        state: "submitted",
        checklist_signed: input.checklist_signed === true,
        submitted_at: d.now(),
        notes,
        imeis: JSON.stringify(codes),
        order_version: updated.version,
        order_snapshot: JSON.stringify(snapshot(order)),
      },
      true,
    );
    await require("./notifications").orderEvent(db, updated, "submitted");
    await d.audit(db, String(userId), "portal_submitted", "batch", id, {
      order_id: order.id,
      serials: codes,
    });
    return { ok: true, status: updated.status };
  });
}
async function approve(pool, cfg, id, input, actor) {
  return transaction(pool, async (db) => {
    const b = await batch(db, id),
      order = await o.get(db, b.order_id);
    if (!["submitted", "ready", "needs_review"].includes(b.state))
      fail(409, "Envio indisponível para aprovação.");
    if (
      b.version !== input.version ||
      b.order_version !== order.version ||
      input.order_version !== order.version
    )
      fail(409, "A OS ou o envio mudou. Refaça a conferência.");
    if (
      order.technician_id !== b.technician_id ||
      ![d.vehicle(order.vehicle), d.vehicle(order.chassis)].includes(
        d.vehicle(b.vehicle),
      )
    )
      fail(409, "Técnico ou veículo não corresponde à OS.");
    if (["CONCLUÍDO", "CANCELADO"].includes(order.status))
      fail(409, "Serviço encerrado.");
    if (
      b.capture_version >= 2 &&
      (!b.checklist_signed || input.checklist_reviewed !== true)
    )
      fail(
        400,
        "Confira se o checklist anexado está preenchido e assinado antes de aprovar.",
      );
    const reason = d.string(input.reason, "Conferência", 1000, true);
    if (reason.length < 5) fail(400, "Descreva a conferência.");
    const codes =
      input.serials !== undefined
        ? input.serials.length
          ? serials(input.serials).sort()
          : []
        : [...b.imeis].sort();
    const r = await rule(db, order.service, order);
    await verifyEvidence(db, b, r, codes, order);
    const tech = await d.one(
      db,
      "SELECT * FROM zc_technicians WHERE id=$1 AND active=true",
      [b.technician_id],
    );
    if (!tech) fail(409, "Técnico inativo.");
    if (r.stock_action === "install") {
      if (!cfg.STOCK_ENABLED)
        fail(
          409,
          "Configure a integração com o Estoque Pro antes de aprovar uma instalação.",
        );
      if (!tech.stock_technician_id)
        fail(409, "Vincule o técnico ao cadastro do Estoque Pro.");
      const payload = {
        source_system: cfg.STOCK_SOURCE_SYSTEM,
        order_id: order.id,
        submission_id: b.id,
        technician_id: tech.stock_technician_id,
        serials: codes,
        operator: actor,
      };
      await o.update(
        db,
        "zc_batches",
        "id",
        id,
        {
          state: "approved_sync",
          reviewed_by: actor,
          reviewed_at: d.now(),
          reason,
          imeis: JSON.stringify(codes),
          approval_payload: JSON.stringify(payload),
        },
        true,
      );
      await o.update(
        db,
        "zc_orders",
        "id",
        order.id,
        {
          status: "AGUARDANDO ESTOQUE",
          imei: codes.join(", "),
          stock_sync_state: "pending",
          updated_at: d.now(),
        },
        true,
      );
      await o.enqueue(
        db,
        "stock_installation",
        order.id,
        { batch_id: id },
        "stock:" + cfg.STOCK_SOURCE_SYSTEM + ":" + id,
      );
      await d.audit(db, actor, "approved_for_stock", "batch", id, {
        order_id: order.id,
        serials: codes,
      });
      await require("./notifications").orderEvent(
        db,
        { ...order, version: order.version + 1 },
        "approved",
      );
      return { ok: true, status: "AGUARDANDO ESTOQUE" };
    }
    if (codes.length)
      fail(
        400,
        "Este tipo de serviço não registra instalação no estoque. Use uma OS de instalação para equipamentos novos.",
      );
    await o.update(
      db,
      "zc_batches",
      "id",
      id,
      { state: "completed", reviewed_by: actor, reviewed_at: d.now(), reason },
      true,
    );
    await o.complete(db, order.id, actor, reason, cfg, id, {
      confirmedSubmission: id,
    });
    await require("./notifications").orderEvent(
      db,
      { ...order, version: order.version + 1 },
      "approved",
    );
    await d.audit(db, actor, "portal_approved", "batch", id, {
      order_id: order.id,
    });
    return { ok: true, status: "CONCLUÍDO" };
  });
}
async function reject(pool, id, input, actor) {
  return transaction(pool, async (db) => {
    const b = await batch(db, id),
      order = await o.get(db, b.order_id);
    if (
      !["submitted", "stock_failed"].includes(b.state) ||
      input.version !== b.version
    )
      fail(409, "Envio indisponível para correção.");
    if (
      await d.one(
        db,
        "SELECT 1 FROM zc_jobs WHERE order_id=$1 AND kind='stock_installation' AND state IN ('running','pending','uncertain')",
        [order.id],
      )
    )
      fail(
        409,
        "Aguarde a confirmação do estoque antes de solicitar correção.",
      );
    const reason = d.string(input.reason, "Correção necessária", 1000, true);
    if (reason.length < 5) fail(400, "Descreva o que precisa ser corrigido.");
    await o.update(
      db,
      "zc_batches",
      "id",
      id,
      {
        state: "rejected",
        reviewed_by: actor,
        reviewed_at: d.now(),
        rejection_reason: reason,
      },
      true,
    );
    await o.update(
      db,
      "zc_orders",
      "id",
      order.id,
      {
        status: "CORREÇÃO SOLICITADA",
        stock_sync_state: "",
        updated_at: d.now(),
      },
      true,
    );
    await require("./notifications").orderEvent(
      db,
      { ...order, version: order.version + 1 },
      "correction",
      { reason },
    );
    await d.audit(db, actor, "portal_correction_requested", "batch", id, {
      reason,
    });
    return { ok: true };
  });
}
async function confirmStock(pool, cfg, job, stock) {
  const b = await batch(pool, job.payload.batch_id),
    order = await o.get(pool, job.order_id);
  if (b.state === "completed" && order.status === "CONCLUÍDO") return;
  if (
    b.state !== "approved_sync" ||
    !b.approval_payload ||
    order.status !== "AGUARDANDO ESTOQUE"
  )
    fail(409, "A aprovação não está disponível para confirmar o estoque.");
  const receipt = await stock.install(b.approval_payload, job.idempotency_key);
  await transaction(pool, async (db) => {
    const current = await batch(db, b.id),
      fresh = await o.get(db, order.id);
    if (current.state === "completed" && fresh.status === "CONCLUÍDO") return;
    if (
      current.state !== "approved_sync" ||
      fresh.technician_id !== current.technician_id ||
      fresh.status !== "AGUARDANDO ESTOQUE"
    )
      fail(409, "A OS mudou durante a confirmação do estoque.");
    await o.update(
      db,
      "zc_orders",
      "id",
      order.id,
      {
        stock_receipt: JSON.stringify(receipt),
        stock_sync_state: "confirmed",
        updated_at: d.now(),
      },
      true,
    );
    await o.update(db, "zc_batches", "id", b.id, { state: "completed" }, true);
    await o.complete(db, order.id, b.reviewed_by, b.reason, cfg, b.id, {
      confirmedSubmission: b.id,
      stockReceipt: receipt,
      jobId: job.id,
    });
    await d.audit(
      db,
      b.reviewed_by,
      "stock_installation_confirmed",
      "order",
      order.id,
      {
        receipt_id: receipt.receipt_id,
        submission_id: b.id,
        serials: receipt.serials,
      },
    );
  });
}
module.exports = {
  technician,
  ownOrder,
  ownBatch,
  batch,
  rule,
  publicOrder,
  startDraft,
  upload,
  submit,
  approve,
  reject,
  confirmStock,
  kinds,
  requiredEquipment,
  generalPhotoMinimum,
};
