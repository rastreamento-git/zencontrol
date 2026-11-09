export default function AuthStory() {
  return (
    <aside className="auth-story" aria-label="Ecossistema ZenTracking">
      <span className="eyebrow">ECOSSISTEMA ZEN SEGUROS</span>
      <h2>
        Toda a operação.
        <span>Uma só conexão.</span>
      </h2>
      <p>
        Da agenda ao atendimento em campo, acompanhe cada etapa com as
        informações no lugar certo.
      </p>
    </aside>
  );
}

const apps = [
  ["stock", "Estoque Pro", "Equipamentos e rastreabilidade"],
  ["control", "ZenControl", "Gestão e conferência"],
  ["field", "ZenField", "Atendimento em campo"],
];

export function AuthApps() {
  return (
    <ul
      className="auth-app-strip"
      aria-label="Aplicativos ZenTracking"
      role="list"
    >
      {apps.map(([product, name, description]) => (
        <li className="auth-app-tile" key={product} data-product={product}>
          <div>
            <span className="auth-app-dot" aria-hidden="true" />
            <strong>{name}</strong>
          </div>
          <p>{description}</p>
        </li>
      ))}
    </ul>
  );
}
