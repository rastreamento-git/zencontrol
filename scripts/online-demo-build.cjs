// Only public source code is fetched. Exact tested commits are pinned.
const fs = require("node:fs"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  parent = path.join(root, ".homologation-build");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(cmd, args, cwd, extra = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extra },
    stdio: "inherit",
  });
  if (r.error) throw r.error;
  if (r.status) throw Error(`${cmd} falhou (${r.status}).`);
}
for (const [name, commit] of [
  ["inventario-v2", "27417a75742e95138304623a9799aa7d41e5bc34"],
]) {
  const dest = path.join(parent, name);
  fs.mkdirSync(dest, { recursive: true });
  run("git", ["init", "--quiet"], dest);
  run(
    "git",
    [
      "fetch",
      "--depth=1",
      `https://github.com/rastreamento-git/${name}.git`,
      commit,
    ],
    dest,
  );
  run("git", ["checkout", "--detach", "FETCH_HEAD"], dest);
}
run(npm, ["ci", "--include=dev"], root);
run(
  npm,
  ["ci", "--include=dev"],
  path.join(parent, "inventario-v2/invent-back"),
);
run(npm, ["run", "build"], root, { VITE_API_URL: "" });
require("./online-demo.cjs").banner(path.join(root, "apps/web/dist"));

require("./demo-fixtures.cjs")
  .generate(path.join(parent, "fixtures"))
  .then(async () => {
    // Initialize PostgreSQL during the build, so initdb's temporary WASM heap
    // never needs to fit inside the 512 MiB runtime instance.
    const dir = path.join(root, ".homologation-online-demo");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const db = await require("./local-database.cjs").localDatabase(
      path.join(dir, "online-demo"),
      {
        postgresqlconf: [
          "shared_buffers=16MB",
          "work_mem=1MB",
          "maintenance_work_mem=8MB",
        ],
      },
    );
    await db.close();
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
