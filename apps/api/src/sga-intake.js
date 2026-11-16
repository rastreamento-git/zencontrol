const { randomUUID } = require("node:crypto");
const { transaction } = require("./database");
const d = require("./domain");
const o = require("./orders");
const { fail } = require("./errors");
const { SGAClient, IntegrationError } = require("./integrations");
const eligibility = require("./sga-eligibility");
const { businessPayload } = require("./sga-products");
const { classifyFipe, fipeCents, fipeVehicleType } = require("../../../packages/domain/fipe.mjs");
function periodDays(start, end, today) {
  if (!start || !end || d.date(start) !== start || d.date(end) !== end || start > end || end > today) fail(400, "Informe um período válido, sem datas futuras.");
  const first = Date.parse(start + "T00:00:00Z"), last = Date.parse(end + "T00:00:00Z");
  if (last - first > 30 * 86400000) fail(400, "Selecione até 31 dias por coleta.");
  return Array.from({ length: (last - first) / 86400000 + 1 }, (_, i) => new Date(first + i * 86400000).toISOString().slice(0,10));
}
function equipmentForIntake(data, input) {
  const document = { ...data.document_data };
  const region = document.fipe_region || (document.customer_state ? (["SP","RJ"].includes(document.customer_state) ? document.customer_state : "GERAL") : "");
  const fipe = classifyFipe({ value: data.fipe_value, vehicleType: document.vehicle_type, region });
  if (region) document.fipe_region = region;
  if (fipe.status !== "classified") fail(409, "FIPE ou categoria não confirmada no SGA. Complete o cadastro antes de gerar a OS.");
  if (!["yes","no"].includes(input.electric)) fail(400, "Confirme se o veículo é elétrico.");
  document.vehicle_electric = input.electric === "yes";
  if (document.vehicle_electric && !["tracker","tag_only"].includes(input.customer_choice)) fail(400, "Consulte o cliente e registre a autorização para instalar o rastreador ou somente TAG.");
  document.equipment_counts = { tracker: document.vehicle_electric && input.customer_choice === "tag_only" ? 0 : 1, tag: fipe.label === "Alta" || (document.vehicle_electric && input.customer_choice === "tag_only") ? 1 : 0 };
  return document;
}
// Rebuild the working form locally from the immutable imported payload.
function preparedData(entry) {
  const saved = entry.data || {};
  const raw = entry.raw_source?.vehicle;
  const mapped = raw && String(raw.codigo_veiculo) === String(entry.sga_vehicle_id) ? require("./order-document").mapSgaVehicle(raw) : {};
  const fill = (base, extra) => {
    const result = { ...base };
    for (const [key, value] of Object.entries(extra || {}))
      if ((result[key] == null || result[key] === "") && value != null && value !== "") result[key] = value;
    return result;
  };
  const data = fill(saved, mapped);
  const doc = fill(saved.document_data, mapped.document_data);
  const { brazilStates, formatAddress } = require("../../../packages/domain/order-fields.mjs");
  if (!brazilStates.includes(doc.customer_state)) doc.customer_state = mapped.document_data?.customer_state || "";
  if (!doc.fipe_region && doc.customer_state) doc.fipe_region = ["SP","RJ"].includes(doc.customer_state) ? doc.customer_state : "GERAL";
  doc.scheduled_service = "Instalação";
  doc.service_address_same = true;
  data.document_data = doc;
  if (!data.location) data.location = formatAddress(doc) || doc.customer_address || "";
  const fipe = classifyFipe({ value: data.fipe_value, vehicleType: doc.vehicle_type, region: doc.fipe_region });
  data.fipe_risk = fipe.label || "";
  return data;
}
function completeDraft(data, input) {
  const result = { ...data, document_data: { ...data.document_data } };
  const fields = { contact:20, volunteer:120 };
  for (const [key, max] of Object.entries(fields))
    if (!result[key] && input[key] !== undefined) result[key] = d.string(input[key], key, max);
  const { documentFields } = require("./order-document");
  const allowed = ["cpf_cnpj","rg","renavam","brand","model","year","color","category","customer_street","customer_number","customer_block","customer_complement","customer_neighborhood","customer_city","customer_state"];
  for (const key of allowed)
    if (!result.document_data[key] && input.document_data?.[key] !== undefined)
      result.document_data[key] = d.string(input.document_data[key], key, documentFields[key]);
  if (!fipeCents(result.fipe_value) && input.fipe_value) result.fipe_value = d.string(input.fipe_value,"FIPE",40);
  if (!fipeVehicleType(result.document_data.vehicle_type) && ["Automóvel","Motocicleta"].includes(input.vehicle_type)) result.document_data.vehicle_type = input.vehicle_type;
  if (!result.document_data.fipe_region && ["GERAL","SP","RJ"].includes(input.fipe_region)) result.document_data.fipe_region = input.fipe_region;
  const { formatAddress } = require("../../../packages/domain/order-fields.mjs");
  const originalAddress = result.document_data.customer_address;
  if (!result.document_data.fipe_region && result.document_data.customer_state) result.document_data.fipe_region = ["SP","RJ"].includes(result.document_data.customer_state) ? result.document_data.customer_state : "GERAL";
  result.document_data = require("./order-document").normalizeDocumentData(result.document_data);
  if (!result.document_data.customer_street && originalAddress) result.document_data.customer_address = originalAddress;
  result.location = result.document_data.customer_street ? (formatAddress(result.document_data) || result.location || "") : (result.location || result.document_data.customer_address || formatAddress(result.document_data));
  return result;
}
async function saveDraft(pool, id, input, actor) {
  return transaction(pool, async db => {
    const entry = await d.one(db,"SELECT * FROM zc_sga_intake WHERE id=$1 FOR UPDATE",[id]);
    if (!entry) fail(404,"Pendência não encontrada.");
    if (entry.order_id) fail(409,"Esta pendência já foi atribuída.");
    const data = completeDraft(preparedData(entry), input || {});
    await db.query("UPDATE zc_sga_intake SET data=$2 WHERE id=$1",[id,JSON.stringify(data)]);
    await d.audit(db,actor,"sga_intake_draft_completed","sga_intake",id);
    return { ...entry, data: preparedData({...entry,data}) };
  });
}
async function clearEntries(pool, input, actor) {
  const reasons = ["incomplete", "status_changed", "reimport", "other"];
  if (input?.confirmed !== true || !reasons.includes(input.reason) ||
      !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 ||
      input.ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    fail(400, "Selecione até 100 pendências, informe o motivo e confirme a limpeza.");
  const ids = [...new Set(input.ids)].sort();
  return transaction(pool, async db => {
    // Serialize with the worker's claim transaction so a running collection
    // cannot recreate a just-removed draft during this operation.
    await db.query("LOCK TABLE zc_sga_intake_runs IN SHARE MODE");
    if (await d.one(db, "SELECT id FROM zc_sga_intake_runs WHERE state IN ('running','queued') LIMIT 1"))
      fail(409, "Há uma coleta em andamento ou na fila. Conclua a coleta antes de limpar pendências.");
    const entries = await d.rows(db, "SELECT id,sga_vehicle_id,run_id,order_id FROM zc_sga_intake WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE", [ids]);
    if (entries.length !== ids.length || entries.some(entry => entry.order_id))
      fail(409, "A seleção mudou ou contém uma OS já atribuída. Atualize a fila e selecione novamente.");
    const result = await db.query("DELETE FROM zc_sga_intake WHERE id=ANY($1::text[]) AND order_id IS NULL", [ids]);
    if (result.rowCount !== ids.length) fail(409, "A seleção mudou. Nenhum cadastro foi removido.");
    for (const entry of entries)
      await d.audit(db, actor, "sga_intake_cleared", "sga_intake", entry.id, { reason: input.reason, sga_vehicle_id: entry.sga_vehicle_id, run_id: entry.run_id });
    return { removed: result.rowCount };
  });
}
async function schedulingData(client, entry, data) {
  const check = eligibility.snapshot(data);
  // A timestamp must come from the stored assessment, not snapshot's fallback.
  if (data.sga_assessment?.checked_at && eligibility.usable(check,data) && check.assessment.eligible) return data;
  const searches = [{sga_id:entry.sga_vehicle_id}];
  const chassis = d.vehicle(data.chassis), plate = d.vehicle(data.document_data?.plate || data.vehicle);
  if (chassis.length === 17) searches.push({chassis});
  if (/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) searches.push({term:plate});
  let last;
  for (const search of searches) {
    try {
      const fresh = await client.lookup(search);
      if (String(fresh.sga_id) !== String(entry.sga_vehicle_id)) fail(409,"O SGA retornou outro veículo.");
      return fresh;
    } catch (error) {
      if (error.reasonCode !== "vehicle_not_found" && ![404,406].includes(error.upstreamStatus)) throw error;
      last = error;
    }
  }
  throw last || new IntegrationError("Não foi possível confirmar a situação atual no SGA.");
}
const customerKey = (value) => d.normalized(value).replace(/[^A-Z0-9]/g, "");
const localTime = (date = new Date()) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
function movementDay(value) {
  const text = String(value || "").trim();
  if (/^\d{2}\/\d{2}\/\d{4}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(text)) return d.date(text.slice(0,10));
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
  { automatic = false, now = new Date(), start, end, complementary = true } = {},
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
  const first = automatic ? day : (start ?? day), last = automatic ? day : (end ?? day);
  periodDays(first, last, day);
  if (!config.pending_code) { if (automatic) return null; fail(409, "Configure a etapa Instalação pendente antes de iniciar."); }
  const snapshot = { ...config, period_start: first, period_end: last, complementary: automatic ? true : d.boolean(complementary, "Consulta complementar") };
  return transaction(pool, async (db) => {
    const row = await d.one(
      db,
      `INSERT INTO zc_sga_intake_runs(id,run_key,day,state,config,actor,created_at)
      VALUES($1,$2,$3,'queued',$4,$5,$6) ON CONFLICT(run_key) DO NOTHING RETURNING *`,
      [
        randomUUID(),
        automatic ? "daily:" + day : randomUUID(),
        day,
        JSON.stringify(snapshot),
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
  const missing = [];
  if (!/^\d{1,20}$/.test(data.sga_id)) missing.push("código SGA");
  if (vehicle.length < 7) missing.push("placa ou chassi");
  if (!customer) missing.push("nome do associado");
  if (missing.length) {
    const error = new Error("Cadastro incompleto: " + missing.join(", ") + ".");
    error.reasonCode = "incomplete_vehicle";
    throw error;
  }
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
  const days = periodDays(run.config.period_start || run.day, run.config.period_end || run.day, run.day);
  const progress = async (summary, message) => pool.query("UPDATE zc_sga_intake_runs SET summary=$2,message=$3 WHERE id=$1 AND state='running'", [run.id, JSON.stringify(summary), message]);
  await progress({ phase: "catalog", total_days: days.length }, "Validando etapa no catálogo SGA…");
  await verifyPending(client, run.config);
  const field =
    run.config.pending_kind === "statuses"
      ? "codigo_situacao"
      : "codigo_classificacao";
  const selected = new Map();
  const summary = {
    phase: "movements",
    total_days: days.length,
    processed_days: 0,
    empty_days: 0,
    failed_days: 0,
    day_errors: [],
    day_results: [],
    processed: 0,
    received: 0,
    matching: 0,
    imported: 0,
    duplicates: 0,
    no_longer_pending: 0,
    failed: 0,
    errors: [],
  };
  for (const day of days) {
    signal?.throwIfAborted();
    await progress({ ...summary, current_day: day }, "Consultando movimentações de " + day + "…");
    let movements;
    try {
      movements = await client.pendingMovements(day, run.config.pending_kind, run.config.pending_code, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      const status = Number.isInteger(error.upstreamStatus) ? error.upstreamStatus : null;
      const message = status ? "Consulta de movimentações: SGA respondeu HTTP " + status + "." : "Não foi possível consultar as movimentações desta data.";
      const detail = { day, stage: "movimentações", message, ...(status ? { http_status: status } : {}) };
      summary.failed_days++;
      summary.processed_days++;
      summary.day_errors.push(detail);
      summary.day_results.push({ day, state: "failed" });
      console.warn("sga_intake_day_failed", JSON.stringify({ run_id: run.id, ...detail }));
      await progress(summary, "Falha nesta data; continuando as demais datas…");
      continue;
    }
    if (movements.length === 0) summary.empty_days++;
    summary.day_results.push({ day, state: movements.length ? "received" : "empty", movements: movements.length });
    summary.received += movements.length;
    for (const row of movements) {
    if (
      row.nome_campo_tabela !== field ||
      String(row.valor_posterior) !== run.config.pending_code ||
      String(row.valor_anterior) === run.config.pending_code ||
      movementDay(row.data_alteracao) !== day ||
      !/^\d{1,20}$/.test(String(row.codigo_veiculo))
    )
      continue;
    const old = selected.get(String(row.codigo_veiculo));
    if (!old || movementDay(row.data_alteracao) > movementDay(old.data_alteracao) || (movementDay(row.data_alteracao) === movementDay(old.data_alteracao) && String(row.data_alteracao) > String(old.data_alteracao)))
      selected.set(String(row.codigo_veiculo), row);
    }
    summary.processed_days++;
    summary.matching = selected.size;
    await progress(summary, "Movimentações recebidas; preparando cadastros…");
  }
  summary.matching = selected.size;
  summary.phase = "records";
  await progress(summary, "Importando cadastros sem gerar OS…");
  for (const [id, movement] of selected) {
    signal?.throwIfAborted();
    let stage = "duplicidade";
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
      stage = "consulta do veículo";
      await progress(summary, "Consultando veículo " + (summary.processed + 1) + " de " + summary.matching + " no SGA…");
      let data;
      const lookupOptions = { signal, includeRaw: true, includeAssessment: run.config.complementary !== false };
      const chassis = d.vehicle(movement.chassi);
      const plate = d.vehicle(movement.placa);
      const searches = [{ sga_id: id }];
      if (chassis.length === 17) searches.push({ chassis });
      if (plate.length === 7 && /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plate)) searches.push({ term: plate });
      let lastError;
      for (const search of searches) {
        try {
          data = await client.lookup(search, lookupOptions);
          break;
        } catch (error) {
          signal?.throwIfAborted();
          if (error.reasonCode !== "vehicle_not_found" && ![404, 406].includes(error.upstreamStatus)) throw error;
          lastError = error;
        }
      }
      if (!data) {
        const error = new Error("SGA não retornou o cadastro por código" + (searches.some(x => x.chassis) ? ", chassi" : "") + (searches.some(x => x.term) ? ", placa" : "") + ". " + (lastError?.upstreamStatus ? "HTTP " + lastError.upstreamStatus + ". " : "") + "Confira o acesso de consulta ao veículo no SGA.");
        error.reasonCode = "vehicle_not_found";
        error.upstreamStatus = lastError?.upstreamStatus;
        throw error;
      }
      if (String(data.sga_id) !== id) {
        const error = new Error("Código do veículo divergente.");
        error.reasonCode = "identity_mismatch";
        throw error;
      }
      stage = "validação da classificação";
      const current = data.sga_source?.[run.config.pending_kind === "statuses" ? "status_code" : "classification_code"];
      if (!current) {
        const error = new Error("A resposta do SGA não informou o código da situação/classificação atual.");
        error.reasonCode = "missing_classification";
        throw error;
      }
      if (String(current) !== run.config.pending_code) {
        summary.no_longer_pending++;
        continue;
      }
      stage = "gravação no banco";
      if (await persistEntry(pool, run, movement, data)) summary.imported++;
      else summary.duplicates++;
    } catch (error) {
      signal?.throwIfAborted();
      summary.failed++;
      const sqlState = /^[0-9A-Z]{5}$/.test(String(error.code || "")) ? error.code : null;
      const httpStatus = Number.isInteger(error.upstreamStatus) ? error.upstreamStatus : null;
      const known = ["vehicle_not_found","incomplete_vehicle","identity_mismatch","missing_classification"].includes(error.reasonCode);
      const message = known ? error.message : httpStatus ? "SGA respondeu HTTP " + httpStatus + "." : error instanceof IntegrationError ? error.message : sqlState ? "Banco de dados recusou a operação (SQLSTATE " + sqlState + ")." : "Falha interna; consulte o log do servidor.";
      const detail = { sga_id: id, stage, message, ...(sqlState ? { sqlstate: sqlState } : {}), ...(httpStatus ? { http_status: httpStatus } : {}) };
      if (summary.errors.length < 20) summary.errors.push(detail);
      // Do not log names, documents, API payloads, credentials or raw SQL error detail.
      console.warn("sga_intake_record_failed", JSON.stringify({ run_id: run.id, ...detail }));
    } finally {
      summary.processed++;
      if (!signal?.aborted && (summary.processed % 5 === 0 || summary.processed === summary.matching)) await progress(summary, "Importando cadastros: " + summary.processed + " de " + summary.matching);
    }
  }
  summary.phase = "finished";
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
      "UPDATE zc_sga_intake_runs SET state='failed',attempts=3,message='A janela deste dia terminou. A coleta automática não importa movimentações de dias anteriores.' WHERE run_key LIKE 'daily:%' AND day<>$1 AND state IN ('queued','failed')",
      [currentDay],
    );
    await db.query(
      "UPDATE zc_sga_intake_runs SET state='failed',available_at=$1,message='Coleta interrompida. A repetição preserva registros recebidos.' WHERE state='running' AND started_at<$2",
      [Date.now(), Date.now() - 2400000],
    );
    const row = await d.one(
      db,
      "SELECT * FROM zc_sga_intake_runs WHERE (state='queued' OR (state='failed' AND attempts<3)) AND available_at<=$1 AND (run_key NOT LIKE 'daily:%' OR day=$2) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
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
    ? AbortSignal.any([signal, AbortSignal.timeout(1800000)])
    : AbortSignal.timeout(1800000);
  try {
    const summary = await collect(pool, client, run, deadline);
    const state = summary.failed || summary.failed_days ? "failed" : "completed";
    await pool.query(
      "UPDATE zc_sga_intake_runs SET state=$2,summary=$3,finished_at=$4,available_at=$5,message=$6 WHERE id=$1",
      [
        run.id,
        state,
        JSON.stringify(summary),
        d.now(),
        Date.now() + 600000,
        summary.failed_days
          ? ("Falha na consulta de " + summary.failed_days + " dia(s). As outras datas foram processadas; confira os motivos por data." + (run.attempts + 1 < 3 ? " A coleta será repetida." : " Limite de tentativas atingido."))
          : summary.failed
          ? (run.attempts + 1 < 3 ? "Alguns cadastros não foram recebidos. Veja os motivos por veículo; a coleta será repetida." : "Limite de tentativas atingido. Veja os motivos por veículo e inicie nova coleta após corrigir a causa.")
          : summary.received === 0 ? "Consulta concluída: nenhuma movimentação retornada pelo SGA." : summary.matching === 0 ? "Consulta concluída: nenhuma movimentação corresponde à etapa configurada." : "Coleta concluída. Nenhuma OS foi numerada.",
      ],
    );
  } catch (error) {
    const detail = deadline.aborted ? "Tempo limite da coleta atingido ou worker interrompido." : error.name === "IntegrationError" ? error.message : error.status === 409 ? "Configuração da etapa pendente inválida ou indisponível." : "Falha ao processar a coleta.";
    await pool.query(
      "UPDATE zc_sga_intake_runs SET state='failed',finished_at=$2,available_at=$3,message=$4 WHERE id=$1",
      [
        run.id,
        d.now(),
        Date.now() + 600000,
        detail + " Os dados já recebidos permanecem preservados.",
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
  const prepared = preparedData(entry);
  const fresh = await schedulingData(client, entry, prepared);
  const check = eligibility.snapshot(fresh);
  // Neither a stale raw snapshot nor values forged in the browser can release scheduling.
  eligibility.assertEligible(check, prepared);
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
    if (!locked) fail(409, "Pendência removida da fila. Atualize antes de atribuir.");
    if (locked.order_id) return o.get(db, locked.order_id);
    if (await existingOrder(db, locked.data))
      fail(
        409,
        "Já existe uma OS para este cadastro. Nenhum dado foi sobrescrito.",
      );
    const cached = preparedData(locked);
    const data = completeDraft({ ...cached, fipe_value: fresh.fipe_value || cached.fipe_value, document_data: { ...cached.document_data, ...Object.fromEntries(Object.entries(fresh.document_data || {}).filter(([,v]) => v !== "" && v != null)) } }, input);
    const document = equipmentForIntake(data, input);
    const order = await o.createInTransaction(
      db,
      {
        ...data,
        document_data: document,
        notes: [data.notes, document.vehicle_electric ? "Consulta ao cliente: " + (input.customer_choice === "tag_only" ? "somente TAG autorizada" : "rastreador autorizado") : ""].filter(Boolean).join("\n"),
        technician_id: Number(input.technician_id),
        scheduled_at: input.scheduled_at,
        service: "Instalação",
        status: "AGENDADO",
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
      "UPDATE zc_orders SET raw_legacy=$2 WHERE id=$1",
      [
        order.id,
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
  periodDays,
  equipmentForIntake,
  preparedData,
  saveDraft,
  clearEntries,
  schedulingData,
};
