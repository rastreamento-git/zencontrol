const { abortable } = require("./abortable");
class IntegrationError extends Error {
  constructor(message, uncertain = false) {
    super(message);
    this.name = "IntegrationError";
    this.uncertain = uncertain;
  }
}
async function http(
  url,
  payload,
  headers = {},
  mutation = false,
  raw = false,
  signal,
) {
  try {
    const response = await fetch(url, {
      method: payload === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(40000)])
        : AbortSignal.timeout(40000),
    });
    if (!response.ok) {
      const error = new IntegrationError(
        "Serviço externo respondeu HTTP " + response.status,
        mutation && response.status >= 500,
      );
      error.upstreamStatus = response.status;
      throw error;
    }
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
    this.cachedToken = null;
    this.catalogCache = null;
  }
  ready() {
    return !!(
      (this.cfg.SGA_READ_ENABLED || this.cfg.INTEGRATIONS_ENABLED) &&
      [
        this.cfg.HINOVA_TOKEN_ASSOC,
        this.cfg.HINOVA_USER,
        this.cfg.HINOVA_PASS,
      ].every(Boolean)
    );
  }
  async catalogs(force = false) {
    if (!force && this.catalogCache && this.catalogCache.expires > Date.now())
      return this.catalogCache;
    const { definitions, catalogRows } = require("./sga-reference");
    if (this.catalogPromise) return this.catalogPromise;
    this.catalogPromise = (async () => {
      const result = {
        fetched_at: new Date().toISOString(),
        expires: Date.now() + 900000,
        items: {},
        errors: [],
      };
      const token = await this.token();
      for (const [name, definition] of Object.entries(definitions))
        try {
          result.items[name] = catalogRows(
            await this.request(definition.path, undefined, false, token),
            definition,
          );
        } catch {
          result.items[name] = [];
          result.errors.push(name);
        }
      this.catalogCache = result;
      return result;
    })();
    try {
      return await this.catalogPromise;
    } finally {
      this.catalogPromise = null;
    }
  }
  async token() {
    const c = this.cfg;
    if (
      !(c.INTEGRATIONS_ENABLED || c.SGA_READ_ENABLED) ||
      ![c.HINOVA_TOKEN_ASSOC, c.HINOVA_USER, c.HINOVA_PASS].every(Boolean)
    )
      throw new IntegrationError("SGA desativado ou incompleto.");
    if (this.cachedToken?.expires > Date.now()) return this.cachedToken.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.authenticate();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }
  async authenticate() {
    const c = this.cfg;
    const p = await http(
      c.HINOVA_API_URL + "/usuario/autenticar",
      { usuario: c.HINOVA_USER, senha: c.HINOVA_PASS },
      { Authorization: "Bearer " + c.HINOVA_TOKEN_ASSOC },
    );
    if (!p.token_usuario)
      throw new IntegrationError("O SGA recusou a autenticação.");
    this.cachedToken = { value: p.token_usuario, expires: Date.now() + 240000 };
    return p.token_usuario;
  }
  async request(endpoint, payload, mutation = false, token, signal) {
    if (mutation && !this.cfg.INTEGRATIONS_ENABLED)
      throw new IntegrationError("Alterações no SGA estão desativadas.");
    const authToken = token || (await this.token());
    signal?.throwIfAborted();
    const p = await http(
      this.cfg.HINOVA_API_URL + endpoint,
      payload,
      { Authorization: "Bearer " + authToken },
      mutation,
      false,
      signal,
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
  async lookup(input, { signal } = {}) {
    signal?.throwIfAborted();
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
    const token = await abortable(this.token(), signal);
    signal?.throwIfAborted();
    const nonempty = (value) =>
      Object.fromEntries(
        Object.entries(value).filter(
          ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
        ),
      );
    const record = (data, route) => {
      const { records } = require("./sga-reference");
      const parts = route.split("/"),
        expected = decodeURIComponent(parts.at(-2)),
        kind = parts.at(-1);
      const key =
        kind === "id"
          ? "codigo_veiculo"
          : kind === "chassi"
            ? "chassi"
            : "placa";
      const found = records(data).filter(
        (v) =>
          v &&
          typeof v === "object" &&
          d.vehicle(v[key]) === d.vehicle(expected),
      );
      if (
        new Set(found.map((v) => String(v.codigo_veiculo || v[key]))).size > 1
      )
        throw new IntegrationError(
          "Mais de um veículo corresponde ao identificador. Revise no SGA.",
        );
      return found.length ? nonempty(found[0]) : null;
    };
    let vehicle = null,
      used = "";
    for (const route of new Set(routes)) {
      try {
        vehicle = record(
          await this.request(route, undefined, false, token, signal),
          route,
        );
        if (vehicle) {
          used = route;
          break;
        }
      } catch (error) {
        signal?.throwIfAborted();
        if (
          !(error instanceof IntegrationError) ||
          error.message.startsWith("Mais de um")
        )
          throw error;
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
            signal,
          ),
          "/veiculo/buscar/" + code + "/id",
        );
        if (full) vehicle = { ...vehicle, ...full };
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof IntegrationError)) throw error;
      }
    }
    // Validate every supplied identity after loading the full record.
    for (const route of routes) {
      const parts = route.split("/"),
        expected = parts.at(-2),
        kind = parts.at(-1),
        field =
          kind === "id"
            ? "codigo_veiculo"
            : kind === "chassi"
              ? "chassi"
              : "placa";
      if (d.vehicle(vehicle[field]) !== d.vehicle(expected))
        throw new IntegrationError(
          "Os identificadores consultados não correspondem ao mesmo veículo no SGA.",
        );
    }
    const volunteer = String(vehicle.codigo_voluntario || "");
    if (/^\d{1,20}$/.test(volunteer)) {
      try {
        const { records } = require("./sga-reference");
        const found = records(
          await this.request(
            "/buscar/voluntario/" + volunteer,
            undefined,
            false,
            token,
            signal,
          ),
        );
        const full =
          found.length === 1
            ? found[0]
            : found.find((v) => String(v.codigo_voluntario) === volunteer);
        if (full?.nome) vehicle.voluntario_real = full.nome;
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof IntegrationError)) throw error;
      }
    }
    const catalogs = await abortable(this.catalogs(), signal);
    const label = (kind, code) =>
      catalogs.items[kind]?.find((r) => r.code === String(code))?.label;
    vehicle.classificacao_real =
      label("classifications", vehicle.codigo_classificacao) ||
      vehicle.descricao_classificacao;
    vehicle.situacao_real =
      label(
        "statuses",
        vehicle.codigo_situacao_veiculo || vehicle.codigo_situacao,
      ) || vehicle.descricao_situacao;
    vehicle.marca = vehicle.marca || label("brands", vehicle.codigo_marca);
    vehicle.cor = vehicle.cor || label("colors", vehicle.codigo_cor);
    vehicle.tipo =
      vehicle.tipo || label("vehicle_types", vehicle.codigo_tipo_veiculo);
    const mapped = mapSgaVehicle(vehicle);
    if (this.cfg.SGA_SCHEDULING_GUARD) {
      const { records } = require("./sga-reference");
      const cpf = String(
        vehicle.cpf || vehicle.cnpj || vehicle.cpf_cnpj || "",
      ).replace(/\D/g, "");
      const associate = String(vehicle.codigo_associado || "");
      const optional = async (path) => {
        try {
          return records(
            await this.request(path, undefined, false, token, signal),
          );
        } catch (error) {
          signal?.throwIfAborted();
          return [];
        }
      };
      const [finance, customer, customerSituation] = await Promise.all([
        optional(
          "/buscar/situacao-financeira-veiculo/" +
            encodeURIComponent(code || mapped.vehicle),
        ),
        /^\d+$/.test(associate)
          ? optional("/associado/buscar/" + associate + "/codigo")
          : Promise.resolve([]),
        [11, 14].includes(cpf.length)
          ? optional("/buscar/situacao-associado/" + cpf)
          : Promise.resolve([]),
      ]);
      const financial =
        finance.find(
          (v) =>
            String(v.codigo_veiculo) === code &&
            (!v.placa ||
              !vehicle.placa ||
              d.vehicle(v.placa) === d.vehicle(vehicle.placa)),
        ) || {};
      const owner =
        customer.find(
          (v) =>
            String(v.codigo_associado) === associate &&
            (!cpf || !v.cpf || String(v.cpf).replace(/\D/g, "") === cpf),
        ) || {};
      const ownerState =
        customerSituation.find(
          (v) => String(v.codigo_associado) === associate,
        ) || {};
      mapped.sga_assessment = require("./sga-eligibility").evaluate({
        checked_at: d.now(),
        vehicle_status: mapped.sga_status,
        vehicle_classification: mapped.sga_classification,
        customer_status: String(
          ownerState.descricao || owner.descricao_situacao || "",
        ),
        customer_classification:
          owner.descricao_classificacao ||
          label("customer_classifications", owner.codigo_classificacao) ||
          (owner.codigo_classificacao
            ? "Cód: " + owner.codigo_classificacao
            : ""),
        financial_status: String(financial.situacao_financeira || ""),
      });
    }
    return mapped;
  }
  async classification(id, code) {
    if (!this.cfg.INTEGRATIONS_ENABLED)
      throw new IntegrationError("Alterações no SGA estão desativadas.");
    const catalogs = await this.catalogs();
    if (
      !catalogs.items.classifications?.some(
        (r) => r.code === String(code) && r.active,
      )
    )
      throw new IntegrationError(
        "Configure uma classificação ativa e atual do SGA.",
      );
    return this.request(
      "/alterar/veiculo",
      { codigo_veiculo: Number(id), codigo_classificacao: Number(code) },
      true,
    );
  }
  async upload(id, photos, operator) {
    if (!this.cfg.INTEGRATIONS_ENABLED)
      throw new IntegrationError("Alterações no SGA estão desativadas.");
    const catalogs = await this.catalogs();
    if (
      !catalogs.items.photo_types?.some(
        (r) => r.code === String(this.cfg.SGA_PHOTO_TYPE_CODE) && r.active,
      )
    )
      throw new IntegrationError("Configure o tipo de foto atual do SGA.");
    const tag = require("node:crypto").randomBytes(5).toString("hex");
    return this.request(
      "/veiculo/foto/cadastrar",
      {
        codigo_veiculo: Number(id),
        foto: photos.map((p, i) => ({
          nome_arquivo: `zc${id}${tag}${i}.jpg`,
          codigo_tipo: Number(this.cfg.SGA_PHOTO_TYPE_CODE),
          binario: p.toString("base64"),
          observacao: "Validação ZenControl: " + operator,
        })),
      },
      true,
    );
  }
}
module.exports = { IntegrationError, WPPClient, SGAClient, http };
