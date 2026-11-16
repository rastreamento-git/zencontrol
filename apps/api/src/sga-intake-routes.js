const intake = require("./sga-intake");
const d = require("./domain");
const { fail, integer } = require("./errors");
function configureSgaIntake(app, pool, cfg, client) {
  const staff = (req, res, next) => {
    if (!["admin", "operador"].includes(req.user?.papel))
      fail(403, "Acesso restrito à operação.");
    next();
  };
  const admin = (req, res, next) => {
    if (req.user?.papel !== "admin")
      fail(
        403,
        "Somente um administrador pode configurar ou iniciar a importação SGA.",
      );
    next();
  };
  const actor = (req) => req.user.nome || req.user.login;
  app.get("/api/sga-intake/config", staff, async (req, res) =>
    res.json({
      config: await intake.configuration(pool),
      configured: client.ready(),
      timezone: "America/Sao_Paulo",
      version: 1,
      note: "A coleta automática depende do servidor e do worker em execução no horário configurado.",
    }),
  );
  app.put("/api/sga-intake/config", admin, async (req, res) =>
    res.json(
      await intake.saveConfiguration(pool, client, req.body, actor(req)),
    ),
  );
  app.get("/api/sga-intake/catalogs", admin, async (req, res) => {
    const catalogs = await client.catalogs();
    res.json({
      items: ["classifications", "statuses"].flatMap((kind) =>
        (catalogs.items[kind] || [])
          .filter(
            (item) =>
              item.active &&
              /INSTALACAO/.test(d.normalized(item.label)) &&
              /PENDENTE/.test(d.normalized(item.label)),
          )
          .map((item) => ({ ...item, kind })),
      ),
      errors: catalogs.errors,
    });
  });
  app.post("/api/sga-intake/runs", admin, async (req, res) => {
    if (req.body.confirmed !== true || !req.body.start || !req.body.end)
      fail(400, "Informe e confirme o período da coleta.");
    res.status(202).json(await intake.enqueue(pool, client, actor(req), { start: req.body.start, end: req.body.end, complementary: req.body.complementary ?? true }));
  });
  app.get("/api/sga-intake/runs", staff, async (req, res) =>
    res.json({
      items: await d.rows(
        pool,
        "SELECT id,day,state,actor,attempts,created_at,finished_at,summary,message,CASE WHEN run_key LIKE 'daily:%' THEN 'automatic' ELSE 'manual' END AS origin,COALESCE(config->>'period_start',day) AS period_start,COALESCE(config->>'period_end',day) AS period_end FROM zc_sga_intake_runs ORDER BY created_at DESC,id DESC LIMIT 15",
      ),
    }),
  );
  app.get("/api/sga-intake/entries", staff, async (req, res) => {
    const limit = Math.min(100, integer(req.query.limit || 25, "Limite"));
    const page = integer(req.query.page || 1, "Página");
    const query = d.string(req.query.q || "", "Busca", 150);
    const origin = String(req.query.origin || "");
    const runId = d.string(req.query.run_id || "", "Lote", 80);
    if (!["", "automatic", "manual"].includes(origin)) fail(400, "Origem da coleta inválida.");
    const condition =
      "e.order_id IS NULL AND (e.customer_name ILIKE $1 OR e.vehicle ILIKE $1 OR e.chassis ILIKE $1 OR e.sga_vehicle_id ILIKE $1) AND ($2='' OR ($2='automatic' AND r.run_key LIKE 'daily:%') OR ($2='manual' AND r.run_key NOT LIKE 'daily:%')) AND ($3='' OR e.run_id=$3)";
    const args = ["%" + query + "%", origin, runId];
    const from = " FROM zc_sga_intake e JOIN zc_sga_intake_runs r ON r.id=e.run_id WHERE ";
    const total = Number(
      (
        await d.one(
          pool,
          "SELECT count(*)::int n" + from + condition,
          args,
        )
      ).n,
    );
    res.json({
      total,
      page,
      limit,
      items: (await d.rows(
        pool,
        "SELECT e.id,e.customer_name,e.vehicle,e.chassis,e.movement_at,e.received_at,e.data,e.run_id,e.sga_vehicle_id,e.raw_source,CASE WHEN r.run_key LIKE 'daily:%' THEN 'automatic' ELSE 'manual' END AS origin,COALESCE(r.config->>'period_start',r.day) AS period_start,COALESCE(r.config->>'period_end',r.day) AS period_end" + from +
          condition +
          " ORDER BY e.received_at DESC,e.id LIMIT $4 OFFSET $5",
        [...args, limit, (page - 1) * limit],
      )).map(entry => {
        const data = intake.preparedData(entry);
        const { raw_source, ...publicEntry } = entry;
        return { ...publicEntry, data };
      }),
    });
  });
  app.get("/api/sga-intake/entries/:id", staff, async (req, res) => {
    const entry = await d.one(pool, "SELECT * FROM zc_sga_intake WHERE id=$1", [
      req.params.id,
    ]);
    if (!entry) fail(404, "Pendência não encontrada.");
    res.json({ ...entry, data: intake.preparedData(entry) });
  });
  app.patch("/api/sga-intake/entries/:id/draft", staff, async (req,res) =>
    res.json(await intake.saveDraft(pool, req.params.id, req.body, actor(req))),
  );
  app.post("/api/sga-intake/entries/:id/assign", staff, async (req, res) =>
    res.json(
      await intake.assign(
        pool,
        cfg,
        client,
        req.params.id,
        req.body,
        actor(req),
      ),
    ),
  );
}
module.exports = { configureSgaIntake };
