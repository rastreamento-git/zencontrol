const d = require("./domain");
const { fail } = require("./errors");
const intake = require("./sga-intake");
const { demand, simulate } = require("./sga-coverage");

function publicRun(run) {
  const { id, state, attempts, config, summary = {} } = run;
  return {
    id,
    state,
    start: config.period_start,
    end: config.period_end,
    retrying: state === "failed" && attempts < 3,
    days: summary.total_days ?? null,
    checked_days: summary.processed_days ?? 0,
    matching: summary.matching ?? 0,
    checked_vehicles: summary.processed ?? 0,
  };
}

async function findRun(pool, { runId, start, end }) {
  const from =
    "SELECT id,state,attempts,config,summary FROM zc_sga_intake_runs WHERE config->>'stock_planning'='true'";
  let run;
  if (runId !== undefined) {
    if (typeof runId !== "string" || !/^[0-9a-f-]{36}$/.test(runId))
      fail(400, "Coleta inválida.");
    run = await d.one(pool, from + " AND id=$1", [runId]);
  } else {
    intake.periodDays(start, end, d.today());
    run = await d.one(
      pool,
      from +
        " AND config->>'period_start'=$1 AND config->>'period_end'=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [start, end],
    );
  }
  if (!run) fail(404, "Nenhuma coleta de Compras encontrada para o período.");
  return run;
}

async function read(pool, cfg, { page = 1, ids, runId } = {}) {
  const args = [];
  let condition = " FROM zc_sga_intake WHERE order_id IS NULL";
  if (runId !== undefined) {
    const run = await findRun(pool, { runId });
    if (
      run.state !== "completed" ||
      !Array.isArray(run.summary.stock_planning_ids)
    )
      fail(409, "Aguarde a conclusão da coleta para consultar as pendências.");
    args.push(run.summary.stock_planning_ids);
    condition += " AND id=ANY($1::text[])";
  }
  if (ids !== undefined) {
    if (
      runId !== undefined &&
      (!Array.isArray(ids) || ids.some((id) => !args[0].includes(id)))
    )
      fail(400, "Selecione somente pendências da coleta atual.");
    return simulate(pool, cfg, ids);
  }
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    fail(400, "Página inválida.");
  const limit = 20;
  const total = (await d.one(pool, "SELECT count(*)::int n" + condition, args))
    .n;
  const rows = await d.rows(
    pool,
    "SELECT *" +
      condition +
      " ORDER BY received_at DESC, id LIMIT $" +
      (args.length + 1) +
      " OFFSET $" +
      (args.length + 2),
    [...args, limit, (page - 1) * limit],
  );
  const items = await Promise.all(
    rows.map(async (entry) => {
      const data = intake.preparedData(entry);
      const ordered = Boolean(await intake.existingOrder(pool, data));
      return {
        id: entry.id,
        vehicle: entry.vehicle,
        received_at: entry.received_at,
        classification: data.sga_classification || null,
        required: ordered ? null : demand(data),
        ordered,
      };
    }),
  );
  return { page, limit, total, items };
}

async function handle(pool, cfg, client, user, input) {
  if (input.action === "collect") {
    if (user.papel !== "admin")
      fail(403, "Somente um administrador pode iniciar a coleta SGA.");
    if (input.confirmed !== true) fail(400, "Confirme o período da coleta.");
    intake.periodDays(input.start, input.end, d.today());
    const run = await intake.enqueue(pool, client, user.nome || user.login, {
      start: input.start,
      end: input.end,
      stockPlanning: true,
    });
    return publicRun(run);
  }
  if (input.action === "run") return publicRun(await findRun(pool, input));
  return read(pool, cfg, input);
}

module.exports = { handle };
