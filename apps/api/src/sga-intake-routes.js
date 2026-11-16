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
        "SELECT id,day,state,actor,attempts,created_at,finished_at,summary,message,COALESCE(config->>'period_start',day) AS period_start,COALESCE(config->>'period_end',day) AS period_end FROM zc_sga_intake_runs ORDER BY created_at DESC,id DESC LIMIT 15",
      ),
    }),
  );
  app.get("/api/sga-intake/entries", staff, async (req, res) => {
    const limit = Math.min(100, integer(req.query.limit || 25, "Limite"));
    const page = integer(req.query.page || 1, "Página");
    const query = d.string(req.query.q || "", "Busca", 150);
    const condition =
      "order_id IS NULL AND (customer_name ILIKE $1 OR vehicle ILIKE $1)";
    const total = Number(
      (
        await d.one(
          pool,
          "SELECT count(*)::int n FROM zc_sga_intake WHERE " + condition,
          ["%" + query + "%"],
        )
      ).n,
    );
    res.json({
      total,
      page,
      limit,
      items: await d.rows(
        pool,
        "SELECT id,customer_name,vehicle,chassis,movement_at,received_at,data FROM zc_sga_intake WHERE " +
          condition +
          " ORDER BY received_at DESC,id LIMIT $2 OFFSET $3",
        ["%" + query + "%", limit, (page - 1) * limit],
      ),
    });
  });
  app.get("/api/sga-intake/entries/:id", staff, async (req, res) => {
    const entry = await d.one(pool, "SELECT * FROM zc_sga_intake WHERE id=$1", [
      req.params.id,
    ]);
    if (!entry) fail(404, "Pendência não encontrada.");
    res.json(entry);
  });
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
