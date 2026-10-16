const { IntegrationError } = require("./integrations");
class StockError extends IntegrationError {
  constructor(message, retryable = false) {
    super(message, retryable);
    this.retryable = retryable;
  }
}
class StockClient {
  constructor(cfg) {
    this.cfg = cfg;
  }
  async request(endpoint, body, key) {
    if (
      !this.cfg.STOCK_ENABLED ||
      !this.cfg.STOCK_API_URL ||
      !this.cfg.STOCK_API_SECRET
    )
      throw new StockError("Conexão com o Estoque Pro não configurada.");
    let response;
    try {
      response = await fetch(
        this.cfg.STOCK_API_URL.replace(/\/$/, "") +
          "/api/integrations/zencontrol" +
          endpoint,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: "Bearer " + this.cfg.STOCK_API_SECRET,
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch {
      throw new StockError(
        "Estoque Pro indisponível. A confirmação será retomada sem duplicar a instalação.",
        true,
      );
    }
    let bytes = 0,
      chunks = [];
    try {
      for await (const part of response.body) {
        bytes += part.length;
        if (bytes > 1024 * 1024) throw Error();
        chunks.push(part);
      }
    } catch {
      throw new StockError(
        "A resposta do estoque não pôde ser confirmada.",
        true,
      );
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new StockError(
        "O estoque respondeu em formato inesperado.",
        response.ok || response.status >= 500,
      );
    }
    if (!response.ok)
      throw new StockError(
        response.status >= 500
          ? "Estoque Pro temporariamente indisponível."
          : String(data.error || "O estoque recusou a operação.").slice(0, 400),
        response.status >= 500 ||
          response.status === 429 ||
          data.retryable === true,
      );
    return data;
  }
  catalog() {
    return this.request("/catalog");
  }
  items(technicianId) {
    return this.request("/technicians/" + technicianId + "/items");
  }
  history(id, page = 1) {
    return this.request(`/technicians/${id}/history?page=${page}`);
  }
  async install(payload, key) {
    const r = await this.request("/installations", payload, key);
    if (
      r.success !== true ||
      r.idempotency_key !== key ||
      r.source_system !== payload.source_system ||
      r.order_id !== payload.order_id ||
      r.submission_id !== payload.submission_id ||
      r.technician_id !== payload.technician_id ||
      r.status !== "INSTALADO" ||
      typeof r.receipt_id !== "string" ||
      JSON.stringify(r.serials) !== JSON.stringify(payload.serials)
    )
      throw new StockError(
        "O recibo da instalação não corresponde ao serviço. A confirmação permanece pendente.",
        true,
      );
    return r;
  }
}
module.exports = { StockClient, StockError };
