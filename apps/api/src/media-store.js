const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { fail } = require("./errors");

const stores = new WeakMap();
const photoName = /^[-a-f0-9]+\.jpg$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function validateMediaConfig(cfg) {
  const provider = cfg.MEDIA_STORAGE || "local";
  if (!["local", "supabase"].includes(provider))
    throw Error("MEDIA_STORAGE deve ser local ou supabase.");
  if (provider === "supabase") {
    let url;
    try {
      url = new URL(cfg.SUPABASE_URL);
    } catch {}
    if (
      !url ||
      url.protocol !== "https:" ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw Error("SUPABASE_URL deve ser a Project URL HTTPS do Supabase.");
    if (!String(cfg.SUPABASE_SECRET_KEY || "").startsWith("sb_secret_"))
      throw Error(
        "Configure SUPABASE_SECRET_KEY com a chave secreta do servidor.",
      );
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(cfg.SUPABASE_STORAGE_BUCKET || ""))
      throw Error(
        "Configure SUPABASE_STORAGE_BUCKET com o nome do bucket privado.",
      );
  }
  return provider;
}
function checked(name) {
  if (!photoName.test(name || "")) fail(400, "Referência de foto inválida.");
  return name;
}
function unavailable() {
  const error = Error(
    "Armazenamento de fotos indisponível. Confira o bucket privado e as credenciais.",
  );
  error.status = 503;
  error.code = "MEDIA_UNAVAILABLE";
  return error;
}
function createMediaStore(cfg) {
  if (stores.has(cfg)) return stores.get(cfg);
  const provider = validateMediaConfig(cfg);
  let store;
  if (provider === "local") {
    const root = path.join(cfg.DATA_DIR, "media");
    store = {
      ready: async () => {},
      read: (name) => fs.readFile(path.join(root, checked(name))),
      async put(name, bytes) {
        checked(name);
        await fs.mkdir(root, { recursive: true });
        try {
          await fs.writeFile(path.join(root, name), bytes, { flag: "wx" });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (digest(await this.read(name)) !== digest(bytes))
            fail(409, "Uma foto diferente já ocupa esta referência.");
        }
      },
    };
  } else {
    const { createClient } = require("@supabase/supabase-js");
    const client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (url, options = {}) =>
          fetch(url, {
            ...options,
            redirect: "error",
            signal: options.signal
              ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
              : AbortSignal.timeout(15000),
          }),
      },
    });
    const bucket = client.storage.from(cfg.SUPABASE_STORAGE_BUCKET);
    store = {
      async ready() {
        const { data, error } = await client.storage.getBucket(
          cfg.SUPABASE_STORAGE_BUCKET,
        );
        if (error || !data) throw unavailable();
        if (data.public !== false)
          throw Error(
            "O bucket de evidências precisa ser privado. Desative Public bucket no Supabase.",
          );
      },
      async read(name) {
        const { data, error } = await bucket.download(checked(name));
        if (error || !data) throw unavailable();
        if (data.size > 16 * 1024 * 1024) throw unavailable();
        return Buffer.from(await data.arrayBuffer());
      },
      async put(name, bytes) {
        checked(name);
        if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024)
          fail(400, "Foto acima do limite de armazenamento.");
        const { error } = await bucket.upload(name, bytes, {
          contentType: "image/jpeg",
          cacheControl: "0",
          upsert: false,
        });
        if (error) {
          // A retry can encounter an already uploaded immutable object.
          let existing;
          try {
            existing = await this.read(name);
          } catch {}
          if (existing && digest(existing) === digest(bytes)) return;
          throw unavailable();
        }
      },
    };
  }
  store.provider = provider;
  stores.set(cfg, store);
  return store;
}
module.exports = { createMediaStore, validateMediaConfig, photoName };
