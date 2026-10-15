const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const sharp = require("sharp");
const { transaction } = require("./database");
const d = require("./domain"),
  o = require("./orders");
const { IntegrationError, WPPClient, SGAClient } = require("./integrations");
const { orderPdf } = require("./pdf");
const { StockClient, StockError } = require("./stock-client");
const { confirmStock } = require("./portal-service");
async function runOne(pool, cfg, adapters = {}) {
  if (!cfg.INTEGRATIONS_ENABLED && !cfg.STOCK_ENABLED) return false;
  const job = await transaction(pool, async (db) => {
    await db.query(
      "UPDATE zc_jobs SET state=CASE WHEN kind IN ('download_evidence','stock_installation') THEN 'pending' ELSE 'uncertain' END,last_error='Execução interrompida. Confira o serviço externo.' WHERE state='running' AND started_at<$1",
      [Date.now() - 900000],
    );
    const j = await d.one(
      db,
      "SELECT * FROM zc_jobs WHERE state='pending' AND available_at<=$1 AND ((kind='stock_installation' AND $2) OR (kind<>'stock_installation' AND $3)) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      [Date.now(), !!cfg.STOCK_ENABLED, !!cfg.INTEGRATIONS_ENABLED],
    );
    if (j)
      await db.query(
        "UPDATE zc_jobs SET state='running',attempts=attempts+1,started_at=$1 WHERE id=$2",
        [Date.now(), j.id],
      );
    return j;
  });
  if (!job) return false;
  try {
    if (job.kind === "stock_installation")
      await confirmStock(
        pool,
        cfg,
        job,
        adapters.stock || new StockClient(cfg),
      );
    else
      await execute(
        pool,
        cfg,
        job,
        adapters.wpp || new WPPClient(cfg),
        adapters.sga || new SGAClient(cfg),
      );
    await pool.query(
      "UPDATE zc_jobs SET state='succeeded',finished_at=$1,last_error='' WHERE id=$2",
      [d.now(), job.id],
    );
  } catch (e) {
    const isStock = job.kind === "stock_installation";
    const retry = isStock
      ? !(e instanceof StockError) || e.retryable
      : job.kind === "download_evidence" && job.attempts < 2;
    const uncertain = e instanceof IntegrationError && e.uncertain;
    const state = retry
      ? "pending"
      : uncertain || (!e.status && !(e instanceof IntegrationError))
        ? "uncertain"
        : "failed";
    const message =
      e.status || e instanceof IntegrationError
        ? e.message
        : "Falha interna. Confira os logs locais antes de repetir.";
    await transaction(pool, async (db) => {
      await db.query(
        "UPDATE zc_jobs SET state=$1,last_error=$2,available_at=$3,finished_at=$4 WHERE id=$5",
        [
          state,
          message,
          Date.now() + Math.min(900000, 30000 * (job.attempts + 1)),
          d.now(),
          job.id,
        ],
      );
      if (isStock && state === "failed") {
        await db.query(
          "UPDATE zc_batches SET state='stock_failed',version=version+1 WHERE id=$1 AND state='approved_sync'",
          [job.payload.batch_id],
        );
        await db.query(
          "UPDATE zc_orders SET stock_sync_state='failed',updated_at=$1 WHERE id=$2 AND status='AGUARDANDO ESTOQUE'",
          [d.now(), job.order_id],
        );
      }
      await d.audit(db, "worker", "job_" + state, "job", job.id, {
        kind: job.kind,
        error: message,
      });
    });
    if (!e.status && !(e instanceof IntegrationError))
      console.error("Falha interna no worker", e.code || e.name);
  }
  return true;
}
async function execute(pool, cfg, job, wpp, sga) {
  const p = job.payload;
  if (job.kind === "dispatch") {
    const order = await o.get(pool, job.order_id);
    if (
      ["CONCLUÍDO", "CANCELADO"].includes(order.status) ||
      order.version !== p.version
    )
      throw Object.assign(
        Error("A OS mudou ou foi encerrada. Revise antes de reenviar."),
        { status: 409 },
      );
    const tech = await d.one(
      pool,
      "SELECT * FROM zc_technicians WHERE id=$1 AND active=true",
      [order.technician_id],
    );
    if (!tech || !(tech.send_group || tech.phone))
      throw Object.assign(Error("Destino do técnico indisponível."), {
        status: 400,
      });
    await wpp.document(
      tech.send_group || tech.phone,
      await orderPdf(order, p.masked),
      order.id + ".pdf",
      `NOVA ORDEM DE SERVIÇO\nOS: ${order.id}\nServiço: ${order.service}\nPlaca ou Chassi: ${order.vehicle}`,
    );
    await transaction(pool, async (db) => {
      const fresh = await o.update(
        db,
        "zc_orders",
        "id",
        order.id,
        { dispatched_at: d.now(), updated_at: d.now() },
        true,
      );
      await d.audit(db, "worker", "dispatched", "order", order.id, {
        job_id: job.id,
      });
      if (cfg.SGA_SYNC_ENABLED && fresh.sga_id && fresh.status === "AGENDADO")
        await o.enqueue(
          db,
          "sga_classification",
          order.id,
          { code: cfg.SGA_SCHEDULED_CODE, target_status: "AGENDADO" },
          "schedule:" + job.id,
        );
    });
  } else if (job.kind === "sga_classification") {
    const order = await o.get(pool, job.order_id);
    if (
      !cfg.SGA_SYNC_ENABLED ||
      order.status !== p.target_status ||
      !order.sga_id
    )
      throw Object.assign(Error("Sincronização antiga ou desabilitada."), {
        status: 409,
      });
    await sga.classification(order.sga_id, p.code);
    await transaction(pool, async (db) => {
      await o.update(
        db,
        "zc_orders",
        "id",
        order.id,
        {
          sga_classification:
            p.target_status === "CONCLUÍDO"
              ? "Concluído"
              : "Instalação agendada",
          updated_at: d.now(),
        },
        true,
      );
      await d.audit(
        db,
        "worker",
        "sga_classification_confirmed",
        "order",
        order.id,
        { code: p.code },
      );
    });
  } else if (job.kind === "download_evidence") {
    const batch = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [
      p.batch_id,
    ]);
    if (!batch)
      throw Object.assign(Error("Lote indisponível."), { status: 404 });
    const root = path.join(cfg.DATA_DIR, "media");
    await fs.mkdir(root, { recursive: true });
    let failed = 0;
    for (const item of await d.rows(
      pool,
      "SELECT * FROM zc_evidence WHERE batch_id=$1 ORDER BY id",
      [batch.id],
    )) {
      if (item.state === "ready") {
        try {
          await fs.access(path.join(root, item.path));
          continue;
        } catch {}
      }
      await pool.query("UPDATE zc_jobs SET started_at=$1 WHERE id=$2", [
        Date.now(),
        job.id,
      ]);
      try {
        const raw = await wpp.media(item.message_id);
        if (!raw.length || raw.length > 10 * 1024 * 1024)
          throw Error("Imagem acima do limite.");
        const image = sharp(raw, { limitInputPixels: 40000000 });
        const meta = await image.metadata();
        if (!["jpeg", "png", "webp"].includes(meta.format))
          throw Error("Imagem inválida.");
        const bytes = await image.rotate().jpeg({ quality: 94 }).toBuffer();
        const name =
          item.id +
          "-" +
          createHash("sha256").update(bytes).digest("hex").slice(0, 12) +
          ".jpg";
        await fs.writeFile(path.join(root, name + ".tmp"), bytes);
        await fs.rename(path.join(root, name + ".tmp"), path.join(root, name));
        await pool.query(
          "UPDATE zc_evidence SET state='ready',path=$1,mime='image/jpeg',sha256=$2 WHERE id=$3",
          [name, createHash("sha256").update(bytes).digest("hex"), item.id],
        );
      } catch {
        failed++;
        await pool.query("UPDATE zc_evidence SET state='failed' WHERE id=$1", [
          item.id,
        ]);
      }
    }
    await transaction(pool, async (db) => {
      const ready = Number(
        (
          await d.one(
            db,
            "SELECT count(*) n FROM zc_evidence WHERE batch_id=$1 AND state='ready'",
            [batch.id],
          )
        ).n,
      );
      const complete = ready === batch.expected_count && ready > 0;
      const state =
        complete && batch.order_id && !batch.reason ? "ready" : "needs_review";
      await db.query("UPDATE zc_batches SET state=$1 WHERE id=$2", [
        state,
        batch.id,
      ]);
      if (complete && batch.order_id) {
        const order = await o.get(db, batch.order_id);
        if (
          order.technician_id !== batch.technician_id ||
          ![d.vehicle(order.vehicle), d.vehicle(order.chassis)].includes(
            d.vehicle(batch.vehicle),
          )
        ) {
          await db.query(
            "UPDATE zc_batches SET state='needs_review',reason=$1 WHERE id=$2",
            [
              "O técnico ou o veículo da OS mudou após o recebimento do bloco.",
              batch.id,
            ],
          );
          await d.audit(
            db,
            "worker",
            "evidence_link_changed",
            "batch",
            batch.id,
            { order_id: order.id },
          );
          return;
        }
        if (!["CONCLUÍDO", "CANCELADO"].includes(order.status)) {
          await o.guard(db, order.id);
          await o.update(
            db,
            "zc_orders",
            "id",
            order.id,
            { status: "AGUARDANDO VALIDAÇÃO", updated_at: d.now() },
            true,
          );
          await d.audit(db, "worker", "evidence_ready", "order", order.id, {
            batch_id: batch.id,
          });
          if (order.workflow_mode === "controlled") {
            const updated = await o.get(db, order.id);
            await db.query(
              "UPDATE zc_batches SET order_version=$1,version=version+1 WHERE id=$2",
              [updated.version, batch.id],
            );
          }
          if (
            cfg.AUTO_CLOSE_ENABLED &&
            order.workflow_mode === "legacy" &&
            !batch.hub &&
            state === "ready"
          ) {
            await o.complete(
              db,
              order.id,
              "baixa automática",
              "Bloco completo do técnico responsável.",
              cfg,
              batch.id,
            );
            await db.query(
              "UPDATE zc_batches SET state='completed',reviewed_by='baixa automática' WHERE id=$1",
              [batch.id],
            );
          }
        }
      }
    });
    if (failed)
      throw new IntegrationError(
        "Algumas fotos falharam. O bloco foi mantido para revisão.",
      );
  } else if (job.kind === "upload_evidence") {
    const b = await d.one(pool, "SELECT * FROM zc_batches WHERE id=$1", [
      p.batch_id,
    ]);
    if (!b || !["approved", "completed"].includes(b.state))
      throw Object.assign(Error("Lote não aprovado."), { status: 409 });
    if (b.sga_uploaded_at) return;
    const order = await o.get(pool, b.order_id);
    if (!order.sga_id)
      throw Object.assign(Error("OS sem código SGA."), { status: 400 });
    const files = await d.rows(
      pool,
      "SELECT * FROM zc_evidence WHERE batch_id=$1 AND state='ready'",
      [b.id],
    );
    if (!files.length || files.length !== b.expected_count)
      throw Object.assign(Error("Fotos pendentes."), { status: 400 });
    const photos = await Promise.all(
      files.map((f) => fs.readFile(path.join(cfg.DATA_DIR, "media", f.path))),
    );
    await sga.upload(order.sga_id, photos, b.reviewed_by);
    await transaction(pool, async (db) => {
      await db.query("UPDATE zc_batches SET sga_uploaded_at=$1 WHERE id=$2", [
        d.now(),
        b.id,
      ]);
      await d.audit(db, "worker", "sga_photos_confirmed", "batch", b.id);
    });
  } else
    throw Object.assign(Error("Tipo de tarefa desconhecido."), { status: 400 });
}
module.exports = { runOne };
