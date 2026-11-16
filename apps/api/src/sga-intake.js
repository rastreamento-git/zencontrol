const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const d = require("./domain");
const o = require("./orders");
const { fail } = require("./errors");
const { SGAClient } = require("./integrations");
const eligibility = require("./sga-eligibility");
const { businessPayload } = require("./sga-products");
const customerKey = (value) => d.normalized(value).replace(/[^A-Z0-9]/g, "");
const localTime = (date = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
function movementDay(value) {
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return d.date(text);
  // SGA local timestamps without offset belong to the association's Brasília day.
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text))
    return d.date(text.slice(0, 10));
  const parsed = new Date(text);
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(parsed)
    : "";
}
async function configuration(pool) {
  await pool.query(
    "INSERT INTO zc_sga_intake_config(id) VALUES(1) ON CONFLICT(id) DO NOTHING",
  );
  return d.one(pool, "SELECT * FROM zc_sga_intake_config WHERE id=1");
}
async function verifyPending(client, config) {
  const catalogs = await client.catalogs();
  const item = catalogs.items[config.pending_kind]?.find(
    (x) => x.code === config.pending_code && x.active,
  );
  if (
    !item ||
    !/INSTALACAO/.test(d.normalized(item.label)) ||
    !/PENDENTE/.test(d.normalized(item.label))
  )
    fail(
      409,
      "Selecione no catálogo atual a classificação ou situação Instalação pendente.",
    );
  return item;
}
async function saveConfiguration(pool, client, input, actor) {
  const enabled = d.boolean(input.enabled, "Coleta automática");
  const dailyTime = d.string(input.daily_time, "Horário", 5, true);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime))
    fail(400, "Informe um horário válido.");
  const pendingKind = input.pending_kind;
  if (!["classifications", "statuses"].includes(pendingKind))
    fail(400, "Tipo de pendência inválido.");
  const pendingCode = d.string(input.pending_code, "Código SGA", 20);
  if (pendingCode && !/^\d{1,20}$/.test(pendingCode))
    fail(400, "Código SGA inválido.");
  const config = {
    enabled,
    daily_time: dailyTime,
    pending_kind: pendingKind,
    pending_code: pendingCode,
  };
  if (enabled) await verifyPending(client, config);
  return transaction(pool, async (db) => {
    const saved = await db.query(
      "UPDATE zc_sga_intake_config SET enabled=$1,daily_time=$2,pending_kind=$3,pending_code=$4,version=version+1,updated_at=$5,updated_by=$6 WHERE id=1 AND version=$7 RETURNING *",
      [
        enabled,
        dailyTime,
        pendingKind,
        pendingCode,
        d.now(),
        actor,
        input.version,
      ],
    );
    if (!saved.rowCount)
      fail(409, "A configuração mudou. Atualize antes de salvar.");
    if (!enabled)
      await db.query(
        "UPDATE zc_sga_intake_runs SET state='failed',attempts=3,message='Coleta automática desativada pelo administrador.' WHERE run_key LIKE 'daily:%' AND state IN ('queued','failed')",
      );
    await d.audit(
      db,
      actor,
      "sga_intake_configured",
      "sga_intake",
      "config",
      config,
    );
    return saved.rows[0];
  });
}
async function enqueue(
  pool,
  client,
  actor,
  { automatic = false, now = new Date() } = {},
) {
  const config = await configuration(pool);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (automatic && (!config.enabled || localTime(now) < config.daily_time))
    return null;
  if (!client.ready()) {
    if (automatic) return null;
    fail(409, "Configure a consulta SGA antes de coletar pendências.");
  }
  if (!automatic) await verifyPending(client, config);
  return transaction(pool, async (db) => {
    const row = await d.one(
      db,
      `INSERT INTO zc_sga_intake_runs(id,run_key,day,state,config,actor,created_at)
      VALUES($1,$2,$3,'queued',$4,$5,$6) ON CONFLICT(run_key) DO NOTHING RETURNING *`,
      [
        randomUUID(),
        automatic ? "daily:" + day : randomUUID(),
        day,
        JSON.stringify(config),
        actor,
        d.now(),
      ],
    );
    if (row)
      await d.audit(db, actor, "sga_intake_queued", "sga_intake_run", row.id, {
        day,
        automatic,
      });
    return row;
  });
}
async function existingOrder(db, data) {
  const identities = [
    ...new Set(
      [d.vehicle(data.vehicle), d.vehicle(data.chassis)].filter(Boolean),
    ),
  ];
  const possible = await d.rows(
    db,
    `SELECT id,sga_id,customer_name,vehicle,chassis FROM zc_orders WHERE deleted_at='' AND parent_order_id IS NULL
    AND (sga_id=$1 OR regexp_replace(upper(vehicle),'[^A-Z0-9]','','g')=ANY($2::text[])
      OR regexp_replace(upper(chassis),'[^A-Z0-9]','','g')=ANY($2::text[]))`,
    [data.sga_id, identities],
  );
  return possible.find(
    (row) =>
      row.sga_id === data.sga_id ||
      (customerKey(row.customer_name) === customerKey(data.customer_name) &&
        [d.vehicle(row.vehicle), d.vehicle(row.chassis)].some((x) =>
          identities.includes(x),
        )),
  );
}
async function persistEntry(pool, run, movement, data) {
  const vehicle = d.vehicle(data.vehicle || data.chassis),
    customer = customerKey(data.customer_name);
  if (!/^\d{1,20}$/.test(data.sga_id) || vehicle.length < 7 || !customer)
    fail(409, "Cadastro SGA incompleto. Registro não importado.");
  const { raw_vehicle, raw_products, ...mapped } = data;
  return transaction(pool, async (db) => {
    const identities = [
      ...new Set([vehicle, d.vehicle(data.chassis)].filter(Boolean)),
    ];
    if (
      await d.one(
        db,
        `SELECT id FROM zc_sga_intake WHERE sga_vehicle_id=$1 OR
      (customer_key=$2 AND (vehicle_key=ANY($3::text[]) OR regexp_replace(upper(chassis),'[^A-Z0-9]','','g')=ANY($3::text[]))) LIMIT 1`,
        [data.sga_id, customer, identities],
      )
    )
      return false;
    if (await existingOrder(db, data)) return false;
    const saved = await db.query(
      `INSERT INTO zc_sga_intake(id,sga_vehicle_id,customer_key,vehicle_key,customer_name,vehicle,chassis,movement_at,received_at,run_id,data,raw_source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id`,
      [
        randomUUID(),
        data.sga_id,
        customer,
        vehicle,
        data.customer_name,
        vehicle,
        d.vehicle(data.chassis),
        String(movement.data_alteracao),
        d.now(),
        run.id,
        JSON.stringify(mapped),
        JSON.stringify(
          businessPayload({
            movement,
            vehicle: raw_vehicle,
            products: raw_products,
            products_state: data.sga_products?.state,
          }),
        ),
      ],
    );
    return saved.rowCount > 0;
  });
}
async function collect(pool, client, run, signal) {
  await verifyPending(client, run.config);
  const field =
    run.config.pending_kind === "statuses"
      ? "codigo_situacao"
      : "codigo_classificacao";
  const movements = await client.pendingMovements(
    run.day,
    run.config.pending_kind,
    run.config.pending_code,
    { signal },
  );
  const selected = new Map();
  const summary = {
    received: movements.length,
    matching: 0,
    imported: 0,
    duplicates: 0,
    no_longer_pending: 0,
    failed: 0,
    errors: [],
  };
  for (const row of movements) {
    if (
      row.nome_campo_tabela !== field ||
      String(row.valor_posterior) !== run.config.pending_code ||
      String(row.valor_anterior) === run.config.pending_code ||
      movementDay(row.data_alteracao) !== run.day ||
      !/^\d{1,20}$/.test(String(row.codigo_veiculo))
    )
      continue;
    const old = selected.get(String(row.codigo_veiculo));
    if (!old || String(row.data_alteracao) > String(old.data_alteracao))
      selected.set(String(row.codigo_veiculo), row);
  }
  summary.matching = selected.size;
  for (const [id, movement] of selected) {
    signal?.throwIfAborted();
    try {
      const exists = await d.one(
        pool,
        "SELECT id FROM zc_sga_intake WHERE sga_vehicle_id=$1",
        [id],
      );
      if (exists) {
        summary.duplicates++;
        continue;
      }
      const data = await client.lookup(
        { sga_id: id },
        { signal, includeRaw: true },
      );
      if (
        data.sga_source?.[
          run.config.pending_kind === "statuses"
            ? "status_code"
            : "classification_code"
        ] !== run.config.pending_code
      ) {
        summary.no_longer_pending++;
        continue;
      }
      if (await persistEntry(pool, run, movement, data)) summary.imported++;
      else summary.duplicates++;
    } catch (error) {
      signal?.throwIfAborted();
      summary.failed++;
      if (summary.errors.length < 20)
        summary.errors.push({
          sga_id: id,
          message:
            "Não foi possível consultar ou preservar este cadastro. Tente novamente.",
        });
    }
  }
  return summary;
}
async function runCycle(
  pool,
  cfg,
  { client = new SGAClient(cfg), now = new Date(), signal } = {},
) {
  if (signal?.aborted) return false;
  if (!client.ready()) return false;
  await enqueue(pool, client, "Coleta automática SGA", {
    automatic: true,
    now,
  });
  const run = await transaction(pool, async (db) => {
    const currentDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    await db.query(
      "UPDATE zc_sga_intake_runs SET state='failed',attempts=3,message='A janela deste dia terminou. A coleta automática não importa movimentações de dias anteriores.' WHERE day<>$1 AND state IN ('queued','failed')",
      [currentDay],
    );
    await db.query(
      "UPDATE zc_sga_intake_runs SET state='failed',available_at=$1,message='Coleta interrompida. A repetição preserva registros recebidos.' WHERE state='running' AND started_at<$2",
      [Date.now(), Date.now() - 900000],
    );
    const row = await d.one(
      db,
      "SELECT * FROM zc_sga_intake_runs WHERE (state='queued' OR (state='failed' AND attempts<3)) AND available_at<=$1 AND day=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
      [Date.now(), currentDay],
    );
    if (row)
      await db.query(
        "UPDATE zc_sga_intake_runs SET state='running',attempts=attempts+1,started_at=$1,message='' WHERE id=$2",
        [Date.now(), row.id],
      );
    return row;
  });
  if (!run) return false;
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(600000)])
    : AbortSignal.timeout(600000);
  try {
    const summary = await collect(pool, client, run, deadline);
    const state = summary.failed ? "failed" : "completed";
    await pool.query(
      "UPDATE zc_sga_intake_runs SET state=$2,summary=$3,finished_at=$4,available_at=$5,message=$6 WHERE id=$1",
      [
        run.id,
        state,
        JSON.stringify(summary),
        d.now(),
        Date.now() + 600000,
        summary.failed
          ? "Alguns cadastros não foram recebidos. Os demais foram preservados; a coleta será repetida."
          : "Coleta concluída. Nenhuma OS foi numerada.",
      ],
    );
  } catch {
    await pool.query(
      "UPDATE zc_sga_intake_runs SET state='failed',finished_at=$2,available_at=$3,message=$4 WHERE id=$1",
      [
        run.id,
        d.now(),
        Date.now() + 600000,
        "Não foi possível concluir a coleta SGA. Os dados já recebidos permanecem preservados.",
      ],
    );
  }
  return true;
}
async function assign(pool, cfg, client, id, input, actor) {
  const entry = await d.one(pool, "SELECT * FROM zc_sga_intake WHERE id=$1", [
    id,
  ]);
  if (!entry) fail(404, "Pendência não encontrada.");
  if (entry.order_id) return o.get(pool, entry.order_id);
  if (
    !Number.isInteger(Number(input.technician_id)) ||
    Number(input.technician_id) < 1 ||
    !input.scheduled_at
  )
    fail(400, "Selecione o técnico e a data do atendimento para gerar a OS.");
  if (!["HOT", "WARM", "COLD"].includes(input.archive))
    fail(400, "Selecione a base da OS.");
  const fresh = await client.lookup({ sga_id: entry.sga_vehicle_id });
  const check = eligibility.snapshot(fresh);
  // Neither a stale raw snapshot nor values forged in the browser can release scheduling.
  eligibility.assertEligible(check, entry.data);
  if (fresh.sga_id !== entry.sga_vehicle_id)
    fail(409, "O SGA retornou outro veículo.");
  const run = await d.one(
    pool,
    "SELECT config FROM zc_sga_intake_runs WHERE id=$1",
    [entry.run_id],
  );
  if (
    fresh.sga_source?.[
      run.config.pending_kind === "statuses"
        ? "status_code"
        : "classification_code"
    ] !== run.config.pending_code
  )
    fail(
      409,
      "O veículo deixou de estar com instalação pendente no SGA. Revise antes de gerar a OS.",
    );
  return transaction(pool, async (db) => {
    const locked = await d.one(
      db,
      "SELECT * FROM zc_sga_intake WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (locked.order_id) return o.get(db, locked.order_id);
    if (await existingOrder(db, locked.data))
      fail(
        409,
        "Já existe uma OS para este cadastro. Nenhum dado foi sobrescrito.",
      );
    const order = await o.createInTransaction(
      db,
      {
        ...locked.data,
        technician_id: Number(input.technician_id),
        scheduled_at: input.scheduled_at,
        service: "Instalação",
        status: "AGENDADO",
        archive: input.archive,
        sticker_discount_opt_in: d.boolean(
          input.sticker_discount_opt_in ?? false,
          "Desconto do adesivo",
        ),
        sga_verification: eligibility.sign(check, cfg.SESSION_SECRET),
      },
      actor,
      { ...cfg, SGA_SCHEDULING_GUARD: true },
    );
    await db.query(
      "UPDATE zc_orders SET archive=$2,raw_legacy=$3 WHERE id=$1",
      [
        order.id,
        input.archive,
        JSON.stringify([
          {
            source: "sga_intake",
            intake_id: id,
            received_at: locked.received_at,
            movement_at: locked.movement_at,
            original: locked.raw_source,
          },
        ]),
      ],
    );
    await db.query(
      "UPDATE zc_sga_intake SET order_id=$2,assigned_at=$3,assigned_by=$4 WHERE id=$1",
      [id, order.id, d.now(), actor],
    );
    await d.audit(db, actor, "sga_intake_assigned", "order", order.id, {
      intake_id: id,
    });
    return o.get(db, order.id);
  });
}
module.exports = {
  configuration,
  saveConfiguration,
  enqueue,
  runCycle,
  assign,
  movementDay,
  localTime,
  existingOrder,
};
