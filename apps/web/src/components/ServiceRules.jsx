import { useState } from "react";
import { api, errorMessage } from "@zen/ui/lib/api";
import { notify } from "@zen/ui/lib/feedback";
import { Panel, useLoad, Loading } from "./common";
import { photoLabels } from "@zen/ui/components/ServiceEvidence";
function Rule({ rule, onSaved }) {
  const [photos, setPhotos] = useState(rule.required_photos),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="portal-rule">
      <div className="zc-info-row">
        <div>
          <b>{rule.service}</b>
          <small>
            {rule.stock_action === "install"
              ? "Instalação no estoque após aprovação"
              : "Conclusão após conferência da central"}
          </small>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api.patch(
                "/service-rules/" + encodeURIComponent(rule.service),
                { version: rule.version, required_photos: photos },
              );
              onSaved();
              notify("Regras de evidência salvas.");
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar regra
        </button>
      </div>
      <div className="portal-rule-photos">
        {Object.entries(photoLabels)
          .filter(([kind]) => kind !== "checklist")
          .map(([kind, label]) => {
            const entry = photos.find((p) => p.kind === kind);
            return (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={!!entry}
                  disabled={
                    busy ||
                    (kind === "label" && rule.stock_action === "install")
                  }
                  onChange={(e) =>
                    setPhotos((list) =>
                      e.target.checked
                        ? [...list, { kind, label, min: 1 }]
                        : list.filter((p) => p.kind !== kind),
                    )
                  }
                />
                <span>{label}</span>
                {entry && (
                  <input
                    type="number"
                    min="1"
                    max="10"
                    aria-label={"Quantidade de fotos: " + label}
                    value={entry.min}
                    disabled={busy}
                    onChange={(e) =>
                      setPhotos((list) =>
                        list.map((p) =>
                          p.kind === kind
                            ? { ...p, min: Number(e.target.value) }
                            : p,
                        ),
                      )
                    }
                  />
                )}
              </label>
            );
          })}
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
export default function ServiceRules({ revision, refresh }) {
  const { data, loading, error } = useLoad("/service-rules", revision);
  return (
    <Panel
      title="Evidências exigidas por serviço"
      subtitle="A etiqueta é obrigatória por equipamento instalado. Novos registros também exigem vistoria e checklist assinado, com conferência da central."
    >
      <div className="zc-panel-padding">
        {loading || error ? (
          <Loading error={error} />
        ) : (
          data.items.map((rule) => (
            <Rule
              key={rule.service + rule.version}
              rule={rule}
              onSaved={refresh}
            />
          ))
        )}
      </div>
    </Panel>
  );
}
