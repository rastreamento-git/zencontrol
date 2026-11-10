const { randomBytes, randomUUID } = require("node:crypto");
const { hashPassword } = require("./auth");
async function temporaryPassword() {
  const value = "Za1!" + randomBytes(9).toString("base64url");
  return { value, hash: await hashPassword(value) };
}
async function registerActivation(db, userId, actor, password) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.query(
    "INSERT INTO zc_activations(user_id,expires_at,created_by) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET code_hash=NULL,expires_at=EXCLUDED.expires_at,used_at=NULL,created_by=EXCLUDED.created_by,created_at=now()",
    [userId, expires, actor],
  );
  await db.query(
    "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'activation_issued')",
    [randomUUID(), userId],
  );
  return { expires_at: expires, temporary_password: password };
}
async function issueActivation(db, userId, actor) {
  const password = await temporaryPassword();
  await db.query(
    "UPDATE usuarios SET senha_hash=$2,activation_required=true,versao_sessao=versao_sessao+1 WHERE id=$1",
    [userId, password.hash],
  );
  return registerActivation(db, userId, actor, password.value);
}
async function createTechnicianAccount(db, technician, actor, email = null) {
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
  const password = await temporaryPassword();
  const user = (
    await db.query(
      "INSERT INTO usuarios(login,nome,senha_hash,papel,ativo,activation_required,recovery_email) VALUES($1,$2,$3,'tecnico',$4,true,$5) RETURNING id",
      [login, technician.name, password.hash, technician.active, email],
    )
  ).rows[0];
  await db.query(
    "INSERT INTO zc_technician_accounts(user_id,technician_id) VALUES($1,$2)",
    [user.id, technician.id],
  );
  return {
    login,
    ...(await registerActivation(db, user.id, actor, password.value)),
  };
}
module.exports = { issueActivation, createTechnicianAccount };
