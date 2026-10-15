const { configuration } = require("../src/config");
const { createPool } = require("../src/database");
const { purge } = require("../src/purge");
const args = process.argv.slice(2);
if (
  args.some((arg) => !["--apply", "--dry-run"].includes(arg)) ||
  (args.includes("--apply") && args.includes("--dry-run"))
)
  throw Error(
    "Use npm run db:purge para simular ou npm run db:purge -- --apply para apagar os dados operacionais.",
  );
const cfg = configuration(),
  pool = createPool(cfg);
purge(pool, cfg, { apply: args.includes("--apply") })
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.cleanup_pending?.length) {
      console.error(
        "Registros apagados; a exclusão de alguns arquivos falhou. Corrija as permissões e repita o comando antes de usar o sistema.",
      );
      process.exitCode = 1;
    } else
      console.log(
        report.dry_run
          ? "SIMULAÇÃO: nenhum registro ou arquivo foi apagado."
          : "Limpeza concluída. Acessos e estrutura preservados.",
      );
  })
  .catch((error) => {
    console.error("Limpeza não concluída:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
