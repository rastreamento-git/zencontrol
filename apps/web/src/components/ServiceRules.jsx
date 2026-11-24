import { Panel, useLoad, Loading } from "./common";
export default function ServiceRules({ revision }) {
  const { data, loading, error } = useLoad("/service-rules", revision);
  return (
    <Panel
      title="Evidências por equipamento previsto"
      subtitle="Fotos gerais são opcionais, sem quantidade mínima. O ZenField pede a foto da etiqueta de cada equipamento definido na OS."
    >
      <div className="zc-panel-padding">
        {loading || error ? (
          <Loading error={error} />
        ) : (
          data.items.map((rule) => (
            <section className="portal-rule" key={rule.service}>
              <b>{rule.service}</b>
              <p className="zc-muted">
                {rule.stock_action === "install"
                  ? "Rastreador e TAG: uma etiqueta legível por equipamento previsto na OS. Equipamento extra deve ter uma OS adicional para conferência e remuneração próprias."
                  : "Fotos gerais opcionais para documentar o atendimento."}
              </p>
              <p className="zc-muted">
                Checklist preenchido e assinado, com conferência da central.
              </p>
            </section>
          ))
        )}
      </div>
    </Panel>
  );
}
