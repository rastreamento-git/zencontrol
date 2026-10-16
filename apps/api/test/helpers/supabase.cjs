const assert = require("node:assert/strict");
const config = {
  MEDIA_STORAGE: "supabase",
  SUPABASE_URL: "https://storage-test.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test_only_not_a_real_key",
  SUPABASE_STORAGE_BUCKET: "zencontrol-evidencias",
};
function mockSupabase() {
  const original = globalThis.fetch;
  const state = {
    objects: new Map(),
    calls: [],
    public: false,
    failUpload: false,
    failDownload: false,
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== config.SUPABASE_URL) return original(input, init);
    const method = init.method || "GET";
    const headers = new Headers(init.headers);
    assert.equal(headers.get("apikey"), config.SUPABASE_SECRET_KEY);
    state.calls.push({ method, path: url.pathname });
    if (url.pathname === "/storage/v1/bucket/" + config.SUPABASE_STORAGE_BUCKET)
      return json({
        id: config.SUPABASE_STORAGE_BUCKET,
        name: config.SUPABASE_STORAGE_BUCKET,
        public: state.public,
      });
    const prefix = "/storage/v1/object/" + config.SUPABASE_STORAGE_BUCKET + "/";
    assert.ok(
      url.pathname.startsWith(prefix),
      "Only authenticated object routes are allowed",
    );
    const key = decodeURIComponent(url.pathname.slice(prefix.length));
    if (method === "POST") {
      assert.equal(headers.get("x-upsert"), "false");
      if (state.failUpload)
        return json({ message: "quota test", statusCode: "413" }, 413);
      if (state.objects.has(key))
        return json({ message: "already exists", statusCode: "409" }, 409);
      state.objects.set(
        key,
        Buffer.from(await new Response(init.body).arrayBuffer()),
      );
      return json({ Key: config.SUPABASE_STORAGE_BUCKET + "/" + key, Id: key });
    }
    if (state.failDownload || !state.objects.has(key))
      return json({ message: "missing", statusCode: "404" }, 404);
    return new Response(state.objects.get(key), {
      headers: { "content-type": "image/jpeg" },
    });
  };
  return {
    ...state,
    state,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
module.exports = { mockSupabase, config };
