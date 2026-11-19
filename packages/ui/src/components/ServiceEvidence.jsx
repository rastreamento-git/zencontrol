import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { api } from "../lib/api";
export const photoLabels = {
  vehicle: "Veículo e identificação",
  label: "Etiqueta do equipamento",
  installed: "Equipamento instalado",
  service: "Serviço realizado",
  other: "Foto complementar",
  inspection: "Fotos da vistoria",
  checklist: "Checklist assinado",
};
export function EvidencePhoto({ file, prefix = "/technician", children }) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      uri;
    setError(false);
    api
      .get(prefix + "/evidence/" + file.id, { responseType: "blob" })
      .then((r) => {
        uri = URL.createObjectURL(r.data);
        if (active) setUrl(uri);
        else URL.revokeObjectURL(uri);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (uri) URL.revokeObjectURL(uri);
    };
  }, [prefix, file.id, file.sha256]);
  return (
    <article className="zc-photo portal-photo">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          download={
            file.mime === "application/pdf"
              ? "checklist-assinado.pdf"
              : undefined
          }
        >
          {file.mime === "application/pdf" ? (
            <span className="portal-document-file">
              <ClipboardList size={36} />
              Baixar checklist assinado (PDF)
            </span>
          ) : (
            <img
              src={url}
              alt={photoLabels[file.kind] || "Foto do atendimento"}
            />
          )}
        </a>
      ) : (
        <div className="zc-photo-placeholder">
          {error
            ? "Não foi possível carregar a foto. Atualize para tentar novamente."
            : "Carregando foto…"}
        </div>
      )}
      <div className="portal-photo-caption">
        <strong>{photoLabels[file.kind] || "Foto"}</strong>
        {file.equipment_type && (
          <span className="zc-badge green">
            {file.equipment_type === "TAG"
              ? "TAG identificada"
              : "Rastreador identificado"}
          </span>
        )}
        {file.equipment_model && <small>{file.equipment_model}</small>}
        {file.serial_code && <code>{file.serial_code}</code>}
        {children}
      </div>
    </article>
  );
}
