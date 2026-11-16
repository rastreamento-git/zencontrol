export default function SgaProducts({ value }) {
  if (!value) return null;
  return (
    <section
      className="zc-notice"
      aria-label="Produtos do associado neste veículo"
    >
      <strong>Produtos vinculados a este veículo no SGA</strong>
      {value.state !== "available" ? (
        <p role="status">
          Produtos indisponíveis nesta consulta. A presença do Perfurado ainda
          não foi confirmada.
        </p>
      ) : (
        <>
          <p>
            {value.perfurado === true
              ? "Perfurado 2371 ativo neste veículo."
              : value.perfurado === null
                ? "Perfurado 2371 com situação não confirmada."
                : "Perfurado 2371 ativo não encontrado neste veículo."}
          </p>
          {!value.items?.length ? (
            <p>Nenhum produto vinculado retornado pelo SGA.</p>
          ) : (
            <ul className="sga-products-list">
              {value.items.map((product, index) => (
                <li key={`${product.kind}-${product.code}-${index}`}>
                  <strong>{product.name}</strong> · código {product.code} ·{" "}
                  {product.status || "Situação não informada"}
                  {product.kind === "additional" ? " · Produto adicional" : ""}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <small>
        {value.checked_at && (
          <>
            Consulta de produtos:{" "}
            {new Date(value.checked_at).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            })}
            .{" "}
          </>
        )}
        A lista corresponde ao veículo consultado. O desconto do adesivo é
        confirmado na OS, sem cálculo automático de valor.
      </small>
    </section>
  );
}
