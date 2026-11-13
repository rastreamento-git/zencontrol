const { AsyncLocalStorage } = require("node:async_hooks");
const { fail } = require("./errors");
const context = new AsyncLocalStorage();
const isStaff = (user) => ["admin", "operador"].includes(user?.papel);
const delegated = () => context.getStore()?.delegated === true;
function configureFieldAccess(app, pool) {
  // Keep the authenticated identity intact. Only the selected technician changes.
  app.use("/api", async (req, res, next) => {
    const selected = req.get("X-Zen-Technician-Id");
    if (selected !== undefined && !isStaff(req.user))
      fail(403, "Somente a central pode selecionar o ambiente de um técnico.");
    let technician = null;
    if (selected !== undefined) {
      if (!/^[1-9]\d{0,8}$/.test(selected))
        fail(400, "Selecione um técnico válido.");
      technician = (
        await pool.query(
          "SELECT * FROM zc_technicians WHERE id=$1 AND active=true",
          [Number(selected)],
        )
      ).rows[0];
      if (!technician) fail(404, "Técnico ativo não encontrado.");
    }
    if (
      /^\/technician(?:\/|$)/.test(req.path) &&
      isStaff(req.user) &&
      !technician
    )
      fail(400, "Selecione um técnico para abrir o ZenField.");
    context.run(
      { actor: req.user, technician, delegated: Boolean(technician) },
      next,
    );
  });
  app.get("/api/field/technicians", async (req, res) => {
    if (!isStaff(req.user))
      fail(403, "Seleção de técnicos exclusiva da central.");
    const term = String(req.query.q || "")
      .trim()
      .slice(0, 200);
    const items = (
      await pool.query(
        "SELECT id,name,(stock_technician_id IS NOT NULL) stock_linked FROM zc_technicians WHERE active=true AND ($1='' OR name ILIKE $2) ORDER BY name,id LIMIT 500",
        [term, "%" + term + "%"],
      )
    ).rows;
    res.json({ items });
  });
  app.post("/api/technician/context", async (req, res) => {
    const scope = context.getStore();
    if (!scope?.delegated) fail(403, "Ação exclusiva da central no ZenField.");
    await require("./domain").audit(
      pool,
      req.user.login,
      "field_environment_opened",
      "technician",
      scope.technician.id,
    );
    res.json({
      id: scope.technician.id,
      name: scope.technician.name,
      actor: req.user,
    });
  });
}
module.exports = { configureFieldAccess, context, delegated, isStaff };
