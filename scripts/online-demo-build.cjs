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
  ["inventario-v2", "e274effa3bd7a6dfbcb6270fd3ee4a77f756651d"],
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
run(
  npm,
  [
    "install",
    "--prefix",
    path.join(parent, "runtime"),
    "--no-save",
    "--package-lock=false",
    "embedded-postgres@18.4.0-beta.17",
  ],
  root,
);
run(npm, ["run", "build"], root, { VITE_API_URL: "" });
require("./online-demo.cjs").banner(path.join(root, "apps/web/dist"));

require("./demo-fixtures.cjs")
  .generate(path.join(parent, "fixtures"))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
