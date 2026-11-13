export const fipeRegions = [
  ["GERAL", "Padrão (demais UFs)"],
  ["SP", "São Paulo (SP)"],
  ["RJ", "Rio de Janeiro (RJ)"],
];
export const fipeCategories = [
  "Baixa",
  "Baixa SP",
  "Baixa RJ",
  "Média",
  "Média SP",
  "Média RJ",
  "Alta",
];
const lowerLimits = {
  car: { GERAL: 7_000_000, SP: 4_000_000, RJ: 3_000_000 },
  motorcycle: { GERAL: 4_000_000, SP: 2_500_000, RJ: 2_000_000 },
};
const upperLimit = 8_000_000;
export function fipeVehicleType(value) {
  const text = String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (["automovel", "automoveis", "carro", "carros"].includes(text))
    return "car";
  if (["moto", "motos", "motocicleta", "motocicletas"].includes(text))
    return "motorcycle";
  return null;
}
export function fipeCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value)
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/[\s\u00a0]/g, "");
  let match = raw.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/);
  if (match) match = [match[0], match[1].replaceAll(".", ""), match[2]];
  else match = raw.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const amount =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
export function classifyFipe({ value, vehicleType, region } = {}) {
  const cents = fipeCents(value),
    type = fipeVehicleType(vehicleType);
  if (value === undefined || value === null || String(value).trim() === "")
    return {
      status: "missing_value",
      label: "",
      message: "Informe o valor FIPE para calcular a categoria.",
    };
  if (cents === null)
    return {
      status: "invalid_value",
      label: "",
      message:
        "Informe um valor FIPE válido, maior que zero e com até duas casas decimais.",
    };
  if (cents > upperLimit)
    return {
      status: "classified",
      label: "Alta",
      message:
        "Alta: valor FIPE acima de R$ 80.000,00, para todos os veículos e UFs.",
    };
  if (!vehicleType)
    return {
      status: "missing_type",
      label: "",
      message: "Selecione o tipo de veículo para calcular a categoria.",
    };
  if (!type)
    return {
      status: "unsupported_type",
      label: "",
      message: "As faixas definidas contemplam apenas automóveis e motos.",
    };
  if (!fipeRegions.some(([code]) => code === region))
    return {
      status: "missing_region",
      label: "",
      message: "Selecione a regra regional FIPE: padrão, SP ou RJ.",
    };
  const minimum = lowerLimits[type][region],
    category = cents < minimum ? "Baixa" : "Média";
  const format = (n) =>
    (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return {
    status: "classified",
    label: category + (region === "GERAL" ? "" : " " + region),
    message: `Baixa: abaixo de ${format(minimum)}. Média: de ${format(minimum)} a ${format(upperLimit)}, incluindo os limites.`,
  };
}
