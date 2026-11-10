const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const { OAuth2Client } = require("google-auth-library");
const sharp = require("sharp");
const { testDatabase } = require("./helpers/database.cjs");
const { migrate } = require("../scripts/migrate");
const { createApp } = require("../src/app");
const { hashPassword } = require("../src/auth");

const password = "Somente1!Teste",
  central = "http://127.0.0.1:4320",
  field = "http://127.0.0.1:4319",
  clientId = "123456-test.apps.googleusercontent.com";
let db, server, base, admin, operator, technician, another, tid, otherTid;

async function call(path, { method = "GET", token, body, origin } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    data: res.status === 204 ? null : await res.json(),
  };
}
async function signIn(login) {
  const r = await call("/api/auth/login", {
    method: "POST",
    body: { login, password, audience: "ecosystem" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  db = await testDatabase();
  await migrate(db.pool);
  const app = createApp(db.pool, {
    APP_PASSWORD: password,
    SESSION_SECRET: "profile-chat-test-session-secret-123456",
    ZEN_WEBHOOK_SECRET: "profile-chat-test-webhook-secret-123456",
    STOCK_API_SECRET: "profile-chat-test-stock-secret-123456789",
    SSO_LOGIN_URL: central,
    TECHNICIAN_PORTAL_URL: field,
    SSO_STOCK_URL: "http://127.0.0.1:4321",
    GOOGLE_CLIENT_ID: clientId,
  });
  await app.locals.ready();
  const hash = await hashPassword(password);
  await db.pool.query(
    "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES('operador','Operação fictícia',$1,'operador')",
    [hash],
  );
  async function addTechnician(login, name) {
    const {
      rows: [user],
    } = await db.pool.query(
      "INSERT INTO usuarios(login,nome,senha_hash,papel) VALUES($1,$2,$3,'tecnico') RETURNING id",
      [login, name, hash],
    );
    const {
      rows: [tech],
    } = await db.pool.query(
      "INSERT INTO zc_technicians(name) VALUES($1) RETURNING id",
      [name],
    );
    await db.pool.query(
      "INSERT INTO zc_technician_accounts(user_id,technician_id) VALUES($1,$2)",
      [user.id, tech.id],
    );
    return tech.id;
  }
  tid = await addTechnician("tecnico", "Técnico fictício");
  otherTid = await addTechnician("outrotecnico", "Outro técnico fictício");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = "http://127.0.0.1:" + server.address().port;
  [admin, operator, technician, another] = await Promise.all([
    signIn("admin"),
    signIn("operador"),
    signIn("tecnico"),
    signIn("outrotecnico"),
  ]);
});
after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await db?.close();
});

test("o perfil permite edição própria sem alterar login ou papel", async () => {
  const path = "/api/account/profile";
  assert.equal((await call(path)).status, 401);
  const updated = await call(path, {
    method: "PATCH",
    token: technician.token,
    body: { nome: "Técnico em campo", phone: "(21) 99999-9999" },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.phone, "(21) 99999-9999");
  assert.equal(updated.data.user.nome, "Técnico em campo");
  assert.equal(updated.data.user.papel, "tecnico");
  assert.equal(updated.data.user.login, "tecnico");
  assert.equal(
    (
      await call(path, {
        method: "PATCH",
        token: technician.token,
        body: {
          nome: "Alterado",
          phone: "",
          papel: "admin",
          id: operator.user.id,
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("/api/auth/session", { token: technician.token })).data.user
      .nome,
    "Técnico em campo",
  );
  assert.equal(
    (await call(path, { token: operator.token })).data.user.nome,
    "Operação fictícia",
  );
});

test("mensagens chegam ao vivo, mantêm a identidade real e ficam isoladas por técnico", async () => {
  const list = "/api/chat/threads",
    route = list + "/" + tid + "/messages";
  assert.equal(
    (await call(list, { token: operator.token })).data.items.length,
    2,
  );
  assert.deepEqual(
    (await call(list, { token: technician.token })).data.items.map((x) => x.id),
    [tid],
  );
  assert.equal((await call(route, { token: another.token })).status, 404);
  assert.equal(
    (
      await call(route, {
        method: "POST",
        token: another.token,
        body: { body: "Não autorizado", request_id: randomUUID() },
      })
    ).status,
    404,
  );
  const stream = await fetch(base + "/api/chat/stream", {
    headers: { Authorization: "Bearer " + technician.token },
    signal: AbortSignal.timeout(5000),
  });
  assert.match(stream.headers.get("content-type"), /^text\/event-stream/);
  const reader = stream.body.getReader(),
    decoder = new TextDecoder();
  try {
    assert.match(decoder.decode((await reader.read()).value), /event: ready/);
    const payload = {
      body: "Mensagem fictícia da central",
      request_id: randomUUID(),
      sender_user_id: technician.user.id,
      sender_role: "tecnico",
    };
    const sent = await call(route, {
      method: "POST",
      token: operator.token,
      body: payload,
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.data));
    assert.equal(sent.data.message.sender_user_id, operator.user.id);
    assert.equal(sent.data.message.sender_role, "operador");
    assert.match(decoder.decode((await reader.read()).value), /event: notice/);
    const retry = await call(route, {
      method: "POST",
      token: operator.token,
      body: payload,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.data.message.id, sent.data.message.id);
    assert.equal(
      (await call(route, { token: technician.token })).data.items.length,
      1,
    );
    assert.equal(
      (
        await call(list + "/" + otherTid + "/messages", {
          token: another.token,
        })
      ).data.items.length,
      0,
    );
    const reply = await call(route, {
      method: "POST",
      token: technician.token,
      body: { body: "Resposta fictícia do campo", request_id: randomUUID() },
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.data.message.sender_name, "Técnico em campo");
    assert.equal(
      (await call(route, { token: operator.token })).data.items.length,
      2,
    );
  } finally {
    await reader.cancel();
  }
});

test("a caixa da operação avisa cada colaborador uma vez e identifica a resposta com foto", async () => {
  const route = "/api/chat/threads/" + otherTid + "/messages";
  const photo = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#1756ac" },
  })
    .png()
    .toBuffer();
  const avatar = await call("/api/account/avatar", {
    method: "PUT",
    token: operator.token,
    body: { image: "data:image/png;base64," + photo.toString("base64") },
  });
  assert.equal(avatar.status, 200, JSON.stringify(avatar.data));
  const version = avatar.data.avatar_version;
  assert.match(version, /^[a-f0-9]{64}$/);
  const photoPath = "/api/chat/avatars/" + operator.user.id + "/" + version;
  assert.equal((await call(photoPath, { token: another.token })).status, 404);
  const stream = await fetch(base + "/api/chat/stream", {
    headers: { Authorization: "Bearer " + admin.token },
    signal: AbortSignal.timeout(5000),
  });
  const reader = stream.body.getReader(),
    decoder = new TextDecoder();
  try {
    assert.match(decoder.decode((await reader.read()).value), /event: ready/);
    const payload = {
      body: "Imprevisto a caminho do atendimento fictício",
      request_id: randomUUID(),
      recipient_user_id: operator.user.id,
    };
    const send = () =>
      call(route, {
        method: "POST",
        token: another.token,
        body: payload,
      });
    const sends = await Promise.all([send(), send()]);
    assert.deepEqual(sends.map((x) => x.status).sort(), [200, 201]);
    assert.equal(sends[0].data.message.id, sends[1].data.message.id);
    assert.match(decoder.decode((await reader.read()).value), /event: notice/);
    async function notice(token) {
      const response = await call("/api/notifications", { token });
      const items = response.data.items.filter(
        (n) => n.target === "chat" && n.detail.technician_id === otherTid,
      );
      assert.equal(items.length, 1);
      return items[0];
    }
    const operatorNotice = await notice(operator.token);
    assert.equal((await notice(admin.token)).id, operatorNotice.id);
    assert.equal(
      (
        await call("/api/notifications/" + operatorNotice.id + "/read", {
          method: "POST",
          token: operator.token,
        })
      ).status,
      200,
    );
    assert.ok((await notice(operator.token)).read_at);
    assert.equal((await notice(admin.token)).read_at, null);
    const reply = await call(route, {
      method: "POST",
      token: operator.token,
      body: { body: "Recebido pela operação", request_id: randomUUID() },
    });
    assert.equal(reply.status, 201);
    const history = await call(route, { token: another.token });
    const responder = history.data.items.at(-1);
    assert.equal(responder.sender_name, "Operação fictícia");
    assert.equal(responder.sender_role, "operador");
    assert.equal(responder.sender_avatar_version, version);
    const visible = await call(photoPath, { token: another.token });
    assert.equal(visible.status, 200);
    assert.match(visible.data.image, /^data:image\/webp;base64,/);
    assert.equal((await call(photoPath)).status, 401);
  } finally {
    await reader.cancel();
  }
});

test("a sala interna é restrita e a lista mostra presença por conta", async () => {
  const route = "/api/chat/threads/equipe/messages";
  const payload = { body: "Aviso interno fictício", request_id: randomUUID() };
  assert.equal(
    (await call("/api/chat/team", { token: technician.token })).status,
    403,
  );
  assert.equal((await call(route, { token: technician.token })).status, 404);
  assert.equal(
    (
      await call(route, {
        method: "POST",
        token: technician.token,
        body: payload,
      })
    ).status,
    404,
  );
  const send = () =>
    call(route, { method: "POST", token: admin.token, body: payload });
  const internal = await send();
  assert.equal(internal.status, 201);
  assert.equal((await send()).status, 200);
  assert.equal(
    (await call(route, { token: operator.token })).data.items[0].id,
    internal.data.message.id,
  );
  const messages = await call("/api/chat/threads/" + tid + "/messages", {
    token: technician.token,
  });
  assert.ok(
    messages.data.items.every((message) => message.body !== payload.body),
  );
  const client = randomUUID(),
    otherClient = randomUUID();
  const mark = (token, status, clientId = client) =>
    call("/api/chat/presence", {
      method: "PUT",
      token,
      body: { client_id: clientId, status },
    });
  const list = () => call("/api/chat/threads", { token: operator.token });
  const state = async () =>
    (await list()).data.items.find((x) => x.id === tid).status;
  assert.equal(await state(), "offline");
  await db.pool.query(
    "INSERT INTO zc_technicians(name) VALUES('Empresa fictícia sem conta')",
  );
  const company = (await list()).data.items.find(
    (x) => x.name === "Empresa fictícia sem conta",
  );
  assert.equal(company.status, "offline");
  assert.equal(company.user_id, null);
  assert.equal((await mark(technician.token, "away")).status, 204);
  assert.equal(await state(), "away");
  assert.equal(
    (await mark(technician.token, "online", otherClient)).status,
    204,
  );
  assert.equal(await state(), "online");
  assert.equal((await mark(technician.token, "busy")).status, 204);
  assert.equal(await state(), "busy");
  await db.pool.query(
    "UPDATE zc_chat_presence SET seen_at=now()-interval '3 minutes' WHERE user_id=$1",
    [technician.user.id],
  );
  assert.equal(await state(), "offline");
  assert.equal((await mark(operator.token, "online")).status, 204);
  const roster = await call("/api/chat/team", { token: admin.token });
  assert.equal(
    roster.data.items.find((x) => x.id === operator.user.id).status,
    "online",
  );
  assert.equal(
    roster.data.items.find((x) => x.id === admin.user.id).role,
    "admin",
  );
});

test("Google exige vínculo voluntário, nonce único, origem e a sessão do próprio usuário", async (t) => {
  const credentials = new Map();
  t.mock.method(
    OAuth2Client.prototype,
    "verifyIdToken",
    async ({ audience, idToken }) => {
      assert.equal(audience, clientId);
      if (!credentials.has(idToken)) throw Error("Assinatura recusada");
      return { getPayload: () => credentials.get(idToken) };
    },
  );
  const config = await call("/api/auth/config");
  assert.equal(config.data.google_client_id, clientId);
  const challenge = (
    intent,
    { token, origin = central, secret = password } = {},
  ) =>
    call("/api/auth/google/challenge", {
      method: "POST",
      origin,
      token,
      body: { intent, ...(intent === "link" ? { password: secret } : {}) },
    });
  const complete = (
    intent,
    nonce,
    credential,
    { token, origin = central } = {},
  ) =>
    call("/api/auth/google/complete", {
      method: "POST",
      origin,
      token,
      body: { intent, nonce, credential },
    });
  function credential(nonce, extra = {}) {
    const key = "fixture.payload." + randomUUID();
    credentials.set(key, {
      sub: "1234567890",
      email: "tecnico@example.test",
      email_verified: true,
      nonce,
      ...extra,
    });
    return key;
  }
  assert.equal((await challenge("login", { origin: field })).status, 403);
  assert.equal((await challenge("link")).status, 401);
  assert.equal(
    (await challenge("link", { token: technician.token, secret: "errada" }))
      .status,
    403,
  );
  const unlinked = (await challenge("login")).data.nonce;
  assert.equal(
    (await complete("login", unlinked, credential(unlinked))).status,
    403,
  );
  const linked = await challenge("link", {
    token: technician.token,
    origin: field,
  });
  assert.equal(linked.status, 200);
  const nonce = linked.data.nonce,
    claim = credential(nonce);
  const wrongSession = await signIn("tecnico");
  assert.equal(
    (
      await complete("link", nonce, claim, {
        token: wrongSession.token,
        origin: field,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await complete("link", nonce, claim, {
        token: technician.token,
        origin: field,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await complete("link", nonce, claim, {
        token: technician.token,
        origin: field,
      })
    ).status,
    401,
  );
  assert.equal(
    (await call("/api/account/profile", { token: technician.token })).data
      .google_email,
    "tecnico@example.test",
  );
  const loginNonce = (await challenge("login")).data.nonce;
  assert.equal(
    (await complete("login", loginNonce, credential("wrong-nonce"))).status,
    401,
  );
  assert.equal(
    (
      await complete(
        "login",
        loginNonce,
        credential(loginNonce, { email_verified: false }),
      )
    ).status,
    401,
  );
  const access = await complete("login", loginNonce, credential(loginNonce));
  assert.equal(access.status, 200, JSON.stringify(access.data));
  assert.equal(access.data.user.id, technician.user.id);
  assert.equal(access.data.user.papel, "tecnico");
  assert.equal(
    (await call("/api/auth/session", { token: access.data.token })).data
      .authenticated,
    true,
  );
  assert.equal(
    (
      await call("/api/account/google", {
        method: "DELETE",
        token: technician.token,
        body: { password },
      })
    ).status,
    200,
  );
  const afterUnlink = (await challenge("login")).data.nonce;
  assert.equal(
    (await complete("login", afterUnlink, credential(afterUnlink))).status,
    403,
  );
});
