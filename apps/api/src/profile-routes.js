const { createHash, randomUUID } = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const sharp = require("sharp");
const { transaction } = require("./database");
const { fail } = require("./errors");
const { publicUser } = require("./auth");
const { audit } = require("./domain");
const { googleLimiter, requireAccountPassword } = require("./google-access");

function accountId(req) {
  if (!Number.isSafeInteger(req.user?.id)) fail(401, "Entre na sua conta.");
  return req.user.id;
}

function configureProfile(app, pool) {
  async function profile(db, user) {
    const row = (
      await db.query(
        "SELECT p.phone,p.avatar_version,g.email FROM usuarios u LEFT JOIN zc_user_profiles p ON p.user_id=u.id LEFT JOIN zc_google_accounts g ON g.user_id=u.id WHERE u.id=$1",
        [user.id],
      )
    ).rows[0];
    return {
      user,
      phone: row?.phone || "",
      avatar_version: row?.avatar_version || null,
      google_email: row?.email || null,
    };
  }
  app.get("/api/account/profile", async (req, res) => {
    accountId(req);
    res.json(await profile(pool, req.user));
  });
  const avatarLimit = rateLimit({
    windowMs: 60000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.id),
    message: { error: "Aguarde um minuto para alterar a foto." },
  });
  app.put("/api/account/avatar", avatarLimit, async (req, res) => {
    const id = accountId(req);
    const { image } = req.body;
    let avatar = null,
      version = null;
    if (image !== null) {
      const match =
        typeof image === "string" &&
        image.match(
          /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
        );
      if (!match || match[1].length > 350000)
        fail(
          400,
          "Escolha uma foto JPEG, PNG ou WebP de até 256 KB após o ajuste.",
        );
      try {
        const source = sharp(Buffer.from(match[1], "base64"), {
          limitInputPixels: 16000000,
          animated: false,
        });
        const info = await source.metadata();
        if (
          !["jpeg", "png", "webp"].includes(info.format) ||
          (info.pages || 1) > 1
        )
          throw Error("format");
        const bytes = await source
          .rotate()
          .resize(128, 128, { fit: "cover" })
          .webp({ quality: 76, alphaQuality: 70 })
          .toBuffer();
        avatar = bytes.toString("base64");
        if (avatar.length > 24000) throw Error("size");
        version = createHash("sha256").update(bytes).digest("hex");
      } catch {
        fail(400, "Não foi possível ler a foto. Escolha outra imagem.");
      }
    }
    await pool.query(
      `INSERT INTO zc_user_profiles(user_id,avatar_webp,avatar_version) VALUES($1,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET avatar_webp=EXCLUDED.avatar_webp,
         avatar_version=EXCLUDED.avatar_version,updated_at=now()`,
      [id, avatar, version],
    );
    res.json({ avatar_version: version });
  });
  app.patch("/api/account/profile", async (req, res) => {
    const id = accountId(req);
    if (Object.keys(req.body).some((key) => !["nome", "phone"].includes(key)))
      fail(400, "Somente o nome de exibição e o telefone podem ser alterados.");
    const name = typeof req.body.nome === "string" ? req.body.nome.trim() : "";
    const phone =
      typeof req.body.phone === "string" ? req.body.phone.trim() : null;
    if (name.length < 2 || name.length > 120 || /[\x00-\x1f\x7f]/.test(name))
      fail(400, "Informe um nome de exibição de 2 a 120 caracteres.");
    if (
      phone === null ||
      (phone &&
        (!/^[+\d(). -]{8,24}$/.test(phone) ||
          !/^\d{8,15}$/.test(phone.replace(/\D/g, ""))))
    )
      fail(400, "Informe um telefone válido ou deixe o campo em branco.");
    const updated = await transaction(pool, async (db) => {
      const row = (
        await db.query(
          "UPDATE usuarios SET nome=$2 WHERE id=$1 AND ativo=true RETURNING *",
          [id, name],
        )
      ).rows[0];
      if (!row) fail(401, "Entre novamente.");
      await db.query(
        "INSERT INTO zc_user_profiles(user_id,phone) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET phone=EXCLUDED.phone,updated_at=now()",
        [id, phone],
      );
      await audit(db, req.user.login, "profile_updated", "user", id, {
        display_name: { before: req.user.nome, after: name },
      });
      return profile(db, publicUser(row));
    });
    res.json(updated);
  });
  app.delete("/api/account/google", googleLimiter(), async (req, res) => {
    const id = accountId(req);
    await requireAccountPassword(pool, id, req.body.password);
    await transaction(pool, async (db) => {
      const removed = await db.query(
        "DELETE FROM zc_google_accounts WHERE user_id=$1",
        [id],
      );
      if (removed.rowCount)
        await db.query(
          "INSERT INTO zc_auth_events(id,user_id,event) VALUES($1,$2,'google_unlinked')",
          [randomUUID(), id],
        );
    });
    res.json({ ok: true });
  });
}

module.exports = { configureProfile };
