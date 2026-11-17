export default function SgaProducts({ value }) {
  if (!value) return null;
  return (
    <section
      className="sga-products-panel"
      aria-label="Produtos do associado neste veículo"
    >
      <h3>Produtos vinculados a este veículo no SGA</h3>
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
                  <div><strong>{product.name}</strong><small>Código {product.code}{product.kind === "additional" ? " · Produto adicional" : ""}</small></div>
                  <span className="sga-product-state" data-active={product.active===true?"yes":product.active===false?"no":"unknown"}>{product.status || "Não confirmado"}</span>
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
