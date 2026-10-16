class IntegrationError extends Error {
  constructor(message, uncertain = false) {
    super(message);
    this.uncertain = uncertain;
  }
}
async function http(url, payload, headers = {}, mutation = false, raw = false) {
  try {
    const response = await fetch(url, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(40000),
    });
    if (!response.ok)
      throw new IntegrationError(
        "Serviço externo respondeu HTTP " + response.status,
        mutation && response.status >= 500,
      );
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 16 * 1024 * 1024)
        throw new IntegrationError(
          "Resposta externa acima do limite.",
          mutation,
        );
      chunks.push(chunk);
    }
    const data = Buffer.concat(chunks);
    if (raw) return { data, type: response.headers.get("content-type") || "" };
    try {
      return JSON.parse(data.toString());
    } catch {
      throw new IntegrationError("Resposta externa sem JSON válido.", mutation);
    }
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError(
      "Não foi possível confirmar a resposta do serviço externo.",
      mutation,
    );
  }
}
class WPPClient {
  constructor(cfg) {
    this.cfg = cfg;
  }
  request(endpoint, payload, mutation = false, raw = false) {
    if (!this.cfg.INTEGRATIONS_ENABLED || !this.cfg.WPP_API_TOKEN)
      throw new IntegrationError("WhatsApp desativado ou sem token.");
    return http(
      this.cfg.WPP_API_URL +
        "/" +
        encodeURIComponent(this.cfg.WPP_SESSION) +
        "/" +
        endpoint,
      payload,
      { Authorization: "Bearer " + this.cfg.WPP_API_TOKEN },
      mutation,
      raw,
    );
  }
  async document(phone, bytes, filename, caption) {
    const result = await this.request(
      "send-file-base64",
      {
        phone,
        isGroup: phone.endsWith("@g.us"),
        base64: "data:application/pdf;base64," + bytes.toString("base64"),
        filename,
        caption,
      },
      true,
    );
    if (String(result?.status).toLowerCase() !== "success")
      throw new IntegrationError("O WhatsApp não confirmou o envio.", true);
    return result;
  }
  async media(id) {
    const { data, type } = await this.request(
      "download-media",
      { messageId: id },
      false,
      true,
    );
    if (type.includes("json")) {
      const p = JSON.parse(data.toString());
      let b = p.base64 || p.data;
      if (b && typeof b === "object") b = b.base64;
      if (typeof b !== "string")
        throw new IntegrationError("Mídia indisponível.");
      return Buffer.from(b.split(",").at(-1), "base64");
    }
    return data;
  }
  async groups() {
    const p = await this.request("all-groups");
    const list = Array.isArray(p) ? p : p.response;
    return (Array.isArray(list) ? list : [])
      .map((g) => ({
        id: typeof g.id === "object" ? g.id?._serialized : g.id,
        name: g.name || g.formattedTitle,
      }))
      .filter((g) => g.id?.endsWith("@g.us"));
  }
}
class SGAClient {
  constructor(cfg) {
    this.cfg = cfg;
  }
  async token() {
    const c = this.cfg;
    if (
      !c.INTEGRATIONS_ENABLED ||
      ![c.HINOVA_TOKEN_ASSOC, c.HINOVA_USER, c.HINOVA_PASS].every(Boolean)
    )
      throw new IntegrationError("SGA desativado ou incompleto.");
    const p = await http(
      c.HINOVA_API_URL + "/usuario/autenticar",
      { usuario: c.HINOVA_USER, senha: c.HINOVA_PASS },
      { Authorization: "Bearer " + c.HINOVA_TOKEN_ASSOC },
    );
    if (!p.token_usuario)
      throw new IntegrationError("O SGA recusou a autenticação.");
    return p.token_usuario;
  }
  async request(endpoint, payload, mutation = false, token) {
    const p = await http(
      this.cfg.HINOVA_API_URL + endpoint,
      payload,
      { Authorization: "Bearer " + (token || (await this.token())) },
      mutation,
    );
    if (
      p?.erro ||
      p?.errors ||
      p?.sucesso === false ||
      ["error", "erro"].includes(p?.status)
    )
      throw new IntegrationError("O SGA recusou a operação.", mutation);
    return p;
  }
  async lookup(input) {
    const query = typeof input === "string" ? { term: input } : input || {};
    const d = require("./domain"),
      { mapSgaVehicle } = require("./order-document");
    const id = String(query.sga_id || "").trim(),
      term = String(query.term || "").trim();
    const routes = [];
    if (id) {
      if (!/^\d{1,20}$/.test(id))
        throw new IntegrationError("Código SGA inválido.");
      routes.push("/veiculo/buscar/" + id + "/id");
    }
    if (term) {
      const key = d.vehicle(term);
      if (/^\d{1,20}$/.test(term))
        routes.push("/veiculo/buscar/" + term + "/id");
      else if (key.length >= 7 && key.length <= 30)
        routes.push(
          "/veiculo/buscar/" +
            key +
            "/" +
            (key.length > 10 ? "chassi" : "placa"),
        );
      else
        throw new IntegrationError(
          "Informe código SGA, placa ou chassi válido.",
        );
    }
    if (query.chassis) {
      const key = d.vehicle(query.chassis);
      if (key.length < 7 || key.length > 30)
        throw new IntegrationError("Chassi inválido.");
      routes.push("/veiculo/buscar/" + key + "/chassi");
    }
    if (!routes.length)
      throw new IntegrationError("Informe código SGA, placa ou chassi.");
    const token = await this.token();
    const nonempty = (value) =>
      Object.fromEntries(
        Object.entries(value).filter(
          ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
        ),
      );
    const record = (data) => {
      const value = Array.isArray(data) ? data[0] : data;
      return value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length
        ? nonempty(value)
        : null;
    };
    let vehicle = null,
      used = "";
    for (const route of new Set(routes)) {
      try {
        vehicle = record(await this.request(route, undefined, false, token));
        if (vehicle) {
          used = route;
          break;
        }
      } catch (error) {
        if (!(error instanceof IntegrationError)) throw error;
      }
    }
    if (!vehicle)
      throw new IntegrationError(
        "Veículo não encontrado ou consulta indisponível.",
      );
    const code = String(vehicle.codigo_veiculo || "");
    if (/^\d{1,20}$/.test(code) && used !== "/veiculo/buscar/" + code + "/id") {
      try {
        const full = record(
          await this.request(
            "/veiculo/buscar/" + code + "/id",
            undefined,
            false,
            token,
          ),
        );
        if (full) vehicle = { ...vehicle, ...full };
      } catch (error) {
        if (!(error instanceof IntegrationError)) throw error;
      }
    }
    const volunteer = String(vehicle.codigo_voluntario || "");
    if (/^\d{1,20}$/.test(volunteer)) {
      try {
        const full = record(
          await this.request(
            "/buscar/voluntario/" + volunteer,
            undefined,
            false,
            token,
          ),
        );
        if (full?.nome) vehicle.voluntario_real = full.nome;
      } catch (error) {
        if (!(error instanceof IntegrationError)) throw error;
      }
    }
    return mapSgaVehicle(vehicle);
  }
  classification(id, code) {
    return this.request(
      "/alterar/veiculo",
      { codigo_veiculo: Number(id), codigo_classificacao: Number(code) },
      true,
    );
  }
  upload(id, photos, operator) {
    const tag = require("node:crypto").randomBytes(5).toString("hex");
    return this.request(
      "/veiculo/foto/cadastrar",
      {
        codigo_veiculo: Number(id),
        foto: photos.map((p, i) => ({
          nome_arquivo: `zc${id}${tag}${i}.jpg`,
          codigo_tipo: 9,
          binario: p.toString("base64"),
          observacao: "Validação ZenControl: " + operator,
        })),
      },
      true,
    );
  }
}
module.exports = { IntegrationError, WPPClient, SGAClient, http };
