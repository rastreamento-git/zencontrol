const path = require("node:path"),
  { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  workspace = path.dirname(root);
for (const [directory, url] of [
  [root, "http://127.0.0.1:4317"],
  [
    process.env.ZEN_FIELD_REPO || path.join(workspace, "zenfield"),
    "http://127.0.0.1:4317",
  ],
  [
    path.join(
      process.env.ZEN_INVENTORY_REPO || path.join(workspace, "inventario-v2"),
      "invent-front",
    ),
    "http://127.0.0.1:4318",
  ],
]) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build"],
    {
      cwd: directory,
      env: { ...process.env, VITE_API_URL: url },
      stdio: "inherit",
      shell: false,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
