const { configuration } = require("../src/config");
const { createPool } = require("../src/database");
const { migration } = require("../src/legacy");
const { migrate } = require("./migrate");
if (require.main === module) {
  const args = process.argv.slice(2),
    source = args[args.indexOf("--source") + 1];
  if (!args.includes("--source") || !source)
    throw Error('Use npm run import:legacy -- --source "PASTA" [--apply].');
  const cfg = configuration(),
    pool = createPool(cfg);
  migrate(pool)
    .then(() => migration(pool, cfg, source, args.includes("--apply")))
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error("Importação não concluída:", e.code || e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
