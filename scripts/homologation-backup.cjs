const fs = require("node:fs/promises"),
  path = require("node:path"),
  { createHash, randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function files(directory, prefix = "") {
  const result = {};
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name,
      full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error("Links não são aceitos no backup.");
    if (entry.isDirectory())
      Object.assign(result, await files(full, name + "/"));
    else if (entry.isFile() && name !== "running.pid")
      result[name] = digest(await fs.readFile(full));
  }
  return result;
}
async function assertStopped(source) {
  try {
    const pid = Number(
      await fs.readFile(path.join(source, "running.pid"), "utf8"),
    );
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") return;
      throw e;
    }
    throw Error(
      "Pare o inicializador local com Ctrl+C antes de copiar os bancos.",
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
async function main() {
  const action = process.argv[2] || "backup",
    instance = process.env.ZEN_HOMOLOGY_INSTANCE || "";
  if (instance && !/^[a-zA-Z0-9_-]{1,64}$/.test(instance))
    throw Error("Nome de instância inválido.");
  const source = path.join(
    root,
    ".homologation" + (instance ? "-" + instance : ""),
  );
  if (action === "backup") {
    await assertStopped(source);
    const manifest = await files(source),
      parent = path.join(root, ".homologation-backups");
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    const target = path.join(
      parent,
      new Date().toISOString().replaceAll(":", "-") +
        "-" +
        randomUUID().slice(0, 8),
    );
    await fs.cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await fs.rm(path.join(target, "running.pid"), { force: true });
    await fs.writeFile(
      path.join(target, "backup-manifest.json"),
      JSON.stringify(
        {
          format: "zen-local-full-backup",
          version: 1,
          created_at: new Date().toISOString(),
          files: manifest,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log("Backup local completo: " + target);
    console.log(
      "Contém contas, códigos e segredos fictícios locais. Guarde em pasta privada.",
    );
  } else if (action === "verify" || action === "restore") {
    const backup = path.resolve(process.argv[3] || "");
    const allowed = path.join(root, ".homologation-backups") + path.sep;
    if (!backup.startsWith(allowed))
      throw Error("Utilize um backup criado na pasta local de homologação.");
    const manifest = JSON.parse(
      await fs.readFile(path.join(backup, "backup-manifest.json"), "utf8"),
    );
    if (manifest.format !== "zen-local-full-backup" || manifest.version !== 1)
      throw Error("Manifesto inválido.");
    const actual = await files(backup);
    delete actual["backup-manifest.json"];
    if (
      JSON.stringify(Object.entries(actual).sort()) !==
      JSON.stringify(Object.entries(manifest.files).sort())
    )
      throw Error(
        "Integridade do backup não confere. Nenhuma restauração foi realizada.",
      );
    if (action === "restore") {
      await assertStopped(source);
      try {
        await fs.access(source);
        throw Error(
          "O destino já existe. Preserve-o com outro nome antes de restaurar.",
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      await fs.cp(backup, source, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      await fs.rm(path.join(source, "backup-manifest.json"));
      console.log("Backup restaurado em " + source);
    } else
      console.log(
        "Backup verificado: " +
          Object.keys(actual).length +
          " arquivos íntegros.",
      );
  } else throw Error("Use backup, verify CAMINHO ou restore CAMINHO.");
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { files, assertStopped };
