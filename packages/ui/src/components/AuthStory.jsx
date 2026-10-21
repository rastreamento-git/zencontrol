import { CalendarCheck2, Smartphone, PackageCheck } from "lucide-react";
import ZenMark from "./ZenMark";

export default function AuthStory() {
  return (
    <aside className="auth-story" aria-label="Ecossistema ZenTracking">
      <ZenMark variant="tracking" size={58} />
      <span className="eyebrow">ECOSSISTEMA ZEN SEGUROS</span>
      <h2>
        Toda a operação.
        <br />
        Uma só conexão.
      </h2>
      <p>
        Da agenda ao atendimento em campo, acompanhe cada etapa com as
        informações no lugar certo.
      </p>
      <ul>
        <li>
          <CalendarCheck2 size={21} />
          <span>
            <strong>ZenControl</strong> · Gestão e conferência
          </span>
        </li>
        <li>
          <Smartphone size={21} />
          <span>
            <strong>ZenField</strong> · Atendimento em campo
          </span>
        </li>
        <li>
          <PackageCheck size={21} />
          <span>
            <strong>Estoque Pro</strong> · Equipamentos e rastreabilidade
          </span>
        </li>
      </ul>
    </aside>
  );
}
