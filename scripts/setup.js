const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const target = path.join(root, ".env");
if (fs.existsSync(target)) {
  console.log(".env já existe; nenhuma configuração foi substituída.");
} else {
  const databasePassword = randomBytes(24).toString("hex");
  const values = {
    APP_PASSWORD: randomBytes(24).toString("base64url"),
    SESSION_SECRET: randomBytes(48).toString("base64url"),
    ZEN_WEBHOOK_SECRET: randomBytes(48).toString("base64url"),
    POSTGRES_PASSWORD: databasePassword,
    STOCK_API_SECRET: randomBytes(48).toString("base64url"),
    DATABASE_URL:
      "postgres://zencontrol:" +
      databasePassword +
      "@127.0.0.1:5432/zencontrol",
  };
  let template = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  for (const [key, value] of Object.entries(values))
    template = template.replace(
      new RegExp("^" + key + "=.*$", "m"),
      key + "=" + value,
    );
  fs.writeFileSync(target, template, { flag: "wx", mode: 0o600 });
  console.log(
    ".env criado. Consulte APP_ADMIN_USER e APP_PASSWORD nesse arquivo para o primeiro acesso.",
  );
  console.log("As integrações e a baixa automática começam desabilitadas.");
}
