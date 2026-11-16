const d = require("./domain");
function productsSnapshot(raw, vehicleId) {
  if (
    String(raw?.codigo_veiculo) !== String(vehicleId) ||
    !Array.isArray(raw?.produtos)
  )
    throw Error("Produtos não correspondem ao veículo consultado.");
  const items = [];
  for (const [key, kind] of [
    ["produtos", "product"],
    ["produtos_adicionais", "additional"],
  ]) {
    for (const p of raw[key] || []) {
      const code = String(
        p[kind === "product" ? "codigo_produto" : "codigo_produto_adicional"] ||
          "",
      );
      if (!/^\d{1,20}$/.test(code)) continue;
      const status = String(p.situacao || "");
      const normalized = d.normalized(status);
      items.push({
        code,
        kind,
        name: String(
          p.descricao ||
            p.descricao_produto ||
            p.descricao_boleto ||
            "Produto " + code,
        ),
        status,
        active: ["ATIVO", "ATIVA", "A"].includes(normalized)
          ? true
          : ["INATIVO", "INATIVA", "I"].includes(normalized)
            ? false
            : null,
      });
    }
  }
  const sticker = items.filter(
    (p) => p.kind === "product" && p.code === "2371",
  );
  return {
    state: "available",
    checked_at: d.now(),
    items,
    perfurado: sticker.some((p) => p.active === true)
      ? true
      : sticker.some((p) => p.active === null)
        ? null
        : false,
  };
}
// Keep the business payload intact while never archiving authentication material.
function businessPayload(value) {
  if (Array.isArray(value)) return value.map(businessPayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(^|_)(senha|password|token|secret|authorization)(_|$)/i.test(key),
      )
      .map(([key, item]) => [key, businessPayload(item)]),
  );
}
module.exports = { productsSnapshot, businessPayload };
