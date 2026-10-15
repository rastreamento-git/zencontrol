const { configuration } = require("../src/config");
const { createPool } = require("../src/database");
const { migrate } = require("./migrate");
const { restoreBackup } = require("../src/backup");
const args = process.argv.slice(2),
  index = args.indexOf("--source");
if (index < 0 || !args[index + 1])
  throw Error('Use npm run restore -- --source "PASTA_EXTRAIDA" [--apply].');
const cfg = configuration(),
  pool = createPool(cfg);
migrate(pool)
  .then(() =>
    restoreBackup(pool, cfg, args[index + 1], args.includes("--apply")),
  )
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((e) => {
    console.error("Restauração não concluída:", e.code || e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
