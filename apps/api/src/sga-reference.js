const definitions = {
  classifications: {
    path: "/listar/classificacao-veiculo/todos",
    codes: ["codigo", "codigo_classificacao", "codigo_classificacao_veiculo"],
    labels: ["descricao", "descricao_classificacao"],
  },
  statuses: {
    path: "/listar/situacao/todos",
    codes: ["codigo_situacao", "codigo"],
    labels: ["descricao_situacao", "descricao"],
  },
  brands: {
    path: "/listar/marca/todos",
    codes: ["codigo_marca", "codigo"],
    labels: ["descricao_marca", "descricao", "marca"],
  },
  colors: {
    path: "/listar/cor/todos",
    codes: ["codigo_cor", "codigo"],
    labels: ["descricao_cor", "descricao", "cor"],
  },
  vehicle_types: {
    path: "/listar/tipo-veiculo/todos",
    codes: ["codigo_tipo", "codigo_tipo_veiculo", "codigo"],
    labels: ["descricao_tipo", "descricao_tipo_veiculo", "descricao"],
  },
  photo_types: {
    path: "/listar/tipo-foto/todos",
    codes: ["codigo_tipofoto", "codigo_tipo", "codigo"],
    labels: ["descricao", "descricao_tipo"],
  },
};
function records(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "dados", "data", "retorno", "veiculos"])
    if (Array.isArray(value?.[key])) return value[key];
  return value && typeof value === "object" ? [value] : [];
}
const scalar = (record, keys) => {
  for (const key of keys)
    if (
      ["number", "string"].includes(typeof record?.[key]) &&
      String(record[key]).trim()
    )
      return String(record[key]).trim();
  return "";
};
function catalogRows(value, definition) {
  return records(value)
    .map((row) => ({
      code: scalar(row, definition.codes),
      label: scalar(row, definition.labels),
      active: !["INATIVO", "INATIVA"].includes(
        String(row.situacao || "").toUpperCase(),
      ),
    }))
    .filter((r) => /^\d{1,20}$/.test(r.code) && r.label);
}
module.exports = { definitions, records, catalogRows };
