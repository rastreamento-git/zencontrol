const { randomBytes, createHash, randomUUID } = require("node:crypto");
const { hashPassword } = require("./auth");
const hashCode = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
async function issueActivation(db, userId, actor) {
  const code = randomBytes(18).toString("base64url");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    "UPDATE usuarios SET activation_required=true,versao_sessao=versao_sessao+1 WHERE id=$1",
    [userId],
  );
  await db.query(
    "INSERT INTO zc_activations(user_id,code_hash,expires_at,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,used_at=NULL,created_by=EXCLUDED.created_by,created_at=now()",
    [userId, hashCode(code), expires, actor],
  );
  await db.query(
    "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'activation_issued')",
    [randomUUID(), userId],
  );
  return { code, expires_at: expires, temporary_password: "zen123" };
}
async function createTechnicianAccount(db, technician, actor) {
  const linked = (
    await db.query(
      "SELECT u.login FROM zc_technician_accounts a JOIN usuarios u ON u.id=a.user_id WHERE a.technician_id=$1",
      [technician.id],
    )
  ).rows[0];
  if (linked) return { login: linked.login };
  const words = technician.name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || ["tecnico"];
  const base = (words[0] + "." + (words.at(-1) || "tecnico")).slice(0, 40);
  let login = base,
    n = 1;
  while (
    (await db.query("SELECT 1 FROM usuarios WHERE login=$1", [login])).rowCount
  )
    login = base + ++n;
  // zen123 is only an activation proof; it can never authenticate against this random hash.
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const user = (
    await db.query(
      "INSERT INTO usuarios(login,nome,senha_hash,papel,ativo,activation_required) VALUES($1,$2,$3,'tecnico',$4,true) RETURNING id",
      [login, technician.name, passwordHash, technician.active],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO zc_technician_accounts(user_id,technician_id) VALUES($1,$2)",
    [user.id, technician.id],
  );
  return { login, ...(await issueActivation(db, user.id, actor)) };
}
module.exports = { hashCode, issueActivation, createTechnicianAccount };
