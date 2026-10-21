import ThemeControl from "@zen/ui/components/ThemeControl";
import ZenMark from "@zen/ui/components/ZenMark";
import { useState } from "react";
import {
  ArrowUpRight,
  KeyRound,
  LogOut,
  Layers3,
  CalendarCheck2,
  Smartphone,
  PackageCheck,
} from "lucide-react";
import { useSession } from "@zen/ui/lib/session";
import { api, errorMessage, saveToken } from "@zen/ui/lib/api";
import { openApp } from "@zen/ui/lib/sso";
import {
  passwordInputProps,
  passwordRequirements,
} from "@zen/ui/lib/password-policy";
import AppFooter from "@zen/ui/components/AppFooter";
import { FormModal } from "./components/common";
import "./tracking.css";

function Illustration({ type }) {
  return (
    <svg viewBox="0 0 320 170" fill="none" aria-hidden="true" focusable="false">
      <circle cx="253" cy="40" r="58" fill="currentColor" opacity=".05" />
      <circle cx="54" cy="151" r="43" fill="currentColor" opacity=".06" />
      {type === "zencontrol" ? (
        <>
          <rect
            x="42"
            y="24"
            width="236"
            height="126"
            rx="12"
            fill="white"
            stroke="currentColor"
            strokeOpacity=".2"
          />
          <path d="M42 54h236" stroke="currentColor" strokeOpacity=".12" />
          <circle cx="58" cy="40" r="3" fill="currentColor" opacity=".5" />
          <circle cx="69" cy="40" r="3" fill="currentColor" opacity=".25" />
          <rect
            x="58"
            y="70"
            width="56"
            height="63"
            rx="6"
            fill="currentColor"
            opacity=".08"
          />
          <path
            d="M69 84h33M69 96h26M69 108h30M69 120h17"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            opacity=".35"
          />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x={130 + i * 44}
                y="70"
                width="34"
                height="25"
                rx="5"
                fill="currentColor"
                opacity={0.11 + i * 0.08}
              />
              <path
                d={`M${135 + i * 44} 112h24M${135 + i * 44} 126h18`}
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                opacity=".3"
              />
            </g>
          ))}
          <circle cx="264" cy="130" r="21" fill="currentColor" />
          <path
            d="m255 130 6 6 11-13"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : type === "zenfield" ? (
        <>
          <path
            d="m50 112 56-25 49 25 50-26 67 16"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 7"
            opacity=".25"
          />
          <path
            d="m50 132 56-25 49 25 50-26 67 16"
            stroke="currentColor"
            strokeWidth="2"
            opacity=".12"
          />
          <rect
            x="115"
            y="13"
            width="91"
            height="143"
            rx="16"
            fill="white"
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity=".35"
          />
          <path
            d="M143 25h35"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            opacity=".3"
          />
          <rect
            x="127"
            y="40"
            width="67"
            height="43"
            rx="7"
            fill="currentColor"
            opacity=".09"
          />
          <path
            d="m149 59 8 8 15-17"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x="128"
                y={96 + i * 16}
                width="7"
                height="7"
                rx="2"
                fill="currentColor"
                opacity=".4"
              />
              <path
                d={`M143 ${100 + i * 16}h39`}
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                opacity=".25"
              />
            </g>
          ))}
          <path
            d="M251 40c-11 0-19 8-19 19 0 14 19 30 19 30s19-16 19-30c0-11-8-19-19-19Z"
            fill="currentColor"
          />
          <circle cx="251" cy="59" r="6" fill="white" />
        </>
      ) : (
        <>
          <rect
            x="175"
            y="26"
            width="102"
            height="117"
            rx="11"
            fill="white"
            stroke="currentColor"
            strokeOpacity=".25"
          />
          <rect
            x="188"
            y="42"
            width="76"
            height="22"
            rx="5"
            fill="currentColor"
            opacity=".12"
          />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                x="189"
                y={79 + i * 18}
                width="8"
                height="8"
                rx="2"
                fill="currentColor"
                opacity=".45"
              />
              <path
                d={`M207 ${83 + i * 18}h43`}
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                opacity=".25"
              />
            </g>
          ))}
          <path
            d="m44 76 49-23 49 23v55l-49 23-49-23V76Z"
            fill="white"
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity=".5"
          />
          <path
            d="m44 76 49 23 49-23M93 99v55M69 64l48 24v20"
            stroke="currentColor"
            strokeWidth="2"
            strokeOpacity=".45"
          />
          <rect
            x="113"
            y="106"
            width="48"
            height="34"
            rx="6"
            fill="currentColor"
          />
          {[0, 1, 2, 3, 4].map((i) => (
            <path
              key={i}
              d={`M${123 + i * 6} 114v17`}
              stroke="white"
              strokeWidth={i % 2 ? 2 : 3}
            />
          ))}
        </>
      )}
    </svg>
  );
}
const apps = [
  {
    id: "zencontrol",
    name: "ZenControl",
    category: "GESTÃO DA OPERAÇÃO",
    description:
      "Organize ordens de serviço, agendamentos, equipe e conferências.",
    detail: "Central de atendimento",
    features: ["Agendamentos", "Conferências", "Financeiro"],
    className: "control",
  },
  {
    id: "zenfield",
    name: "ZenField",
    category: "OPERAÇÃO EM CAMPO",
    description:
      "Acesse o ambiente de um técnico e acompanhe ou realize os atendimentos.",
    detail: "Seleção de técnico",
    features: ["Serviços", "Evidências", "Equipe em campo"],
    className: "field",
  },
  {
    id: "stock",
    name: "EstoquePro",
    category: "EQUIPAMENTOS E RASTREABILIDADE",
    description:
      "Gerencie equipamentos, cargas dos técnicos e movimentações de estoque.",
    detail: "Controle de equipamentos",
    features: ["Inventário", "Cargas", "Rastreabilidade"],
    className: "stock",
  },
];
export default function TrackingHome() {
  const user = useSession();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [password, setPassword] = useState(false);
  async function logout() {
    setBusy("logout");
    setError("");
    try {
      await api.post("/auth/logout", {});
      saveToken(null);
      window.dispatchEvent(
        new CustomEvent("invent:unauthorized", {
          detail: { reason: "logout" },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy("");
    }
  }
  async function launch(app) {
    setBusy(app);
    setError("");
    try {
      if (app === "zencontrol") window.location.assign("/zencontrol");
      else await openApp(app);
    } catch (e) {
      setError(errorMessage(e));
      setBusy("");
    }
  }
  return (
    <div className="tracking-app">
      <a className="skip-link" href="#tracking-content">
        Ir para o conteúdo
      </a>
      <header className="tracking-header">
        <a
          className="tracking-brand"
          href="/"
          aria-label="ZenTracking · Início"
        >
          <span className="tracking-mark">
            <ZenMark variant="tracking" size={48} />
          </span>
          <span>
            <strong>ZenTracking</strong>
            <small>Ecossistema Zen Seguros</small>
          </span>
        </a>
        <div className="tracking-account">
          <ThemeControl />
          <span className="tracking-identity">
            <b>{user.nome}</b>
            <small>
              {user.papel === "admin" ? "Administrador" : "Operador"}
            </small>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Alterar senha"
            onClick={() => setPassword(true)}
            disabled={!!busy}
          >
            <KeyRound size={19} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Sair"
            onClick={logout}
            disabled={!!busy}
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>
      <main className="tracking-main" id="tracking-content" tabIndex={-1}>
        <div className="tracking-intro">
          <div>
            <p className="tracking-eyebrow">
              <Layers3 size={15} /> SEU ESPAÇO DE TRABALHO
            </p>
            <h1>Seu setor, em um só lugar.</h1>
            <p>
              Olá, {user.nome?.split(" ")[0] || "bem-vindo"}. Qual etapa vamos
              acompanhar agora?
            </p>
          </div>
          <div className="tracking-profile">
            <span className="avatar">
              {(user.nome || "ZT")
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")}
            </span>
            <div>
              <strong>{user.nome}</strong>
              <span>
                {user.papel === "admin" ? "Administrador" : "Operador"} · Acesso
                completo
              </span>
            </div>
          </div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <div className="tracking-section-heading">
          <h2>Aplicativos</h2>
          <span>3 ambientes conectados</span>
        </div>
        <div className="tracking-apps" aria-label="Aplicativos ZenTracking">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              className={`tracking-card tracking-${app.className}`}
              aria-label={`Abrir ${app.name}`}
              disabled={!!busy}
              onClick={() => launch(app.id)}
            >
              <div className="tracking-art">
                <Illustration type={app.id} />
                <span className="tracking-app-mark">
                  <ZenMark
                    variant={
                      app.id === "zencontrol"
                        ? "control"
                        : app.id === "zenfield"
                          ? "field"
                          : "stock"
                    }
                    size={48}
                  />
                </span>
              </div>
              <div className="tracking-card-content">
                <small>{app.category}</small>
                <h2>{app.name}</h2>
                <p>{app.description}</p>
                <ul className="tracking-features">
                  {app.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <span className="tracking-card-action">
                  <span>
                    {busy === app.id ? "Abrindo…" : `Acessar ${app.name}`}
                  </span>
                  <ArrowUpRight size={20} />
                </span>
              </div>
            </button>
          ))}
        </div>
        <section className="tracking-workflow" aria-label="Etapas da operação">
          <div>
            <CalendarCheck2 size={22} />
            <span>
              <strong>Planeje na central</strong>
              <small>Organize a agenda e atribua os serviços.</small>
            </span>
          </div>
          <div>
            <Smartphone size={22} />
            <span>
              <strong>Acompanhe em campo</strong>
              <small>Registre a execução e confira as evidências.</small>
            </span>
          </div>
          <div>
            <PackageCheck size={22} />
            <span>
              <strong>Conclua com controle</strong>
              <small>Confirme estoque e fechamento dos serviços.</small>
            </span>
          </div>
        </section>
      </main>
      <AppFooter product="ZenTracking" />
      {password && (
        <FormModal
          title="Alterar senha"
          description={passwordRequirements}
          fields={[
            {
              name: "current_password",
              label: "Senha atual",
              type: "password",
              autoComplete: "current-password",
              required: true,
              full: true,
            },
            {
              name: "new_password",
              label: "Nova senha",
              type: "password",
              ...passwordInputProps,
              required: true,
              full: true,
            },
          ]}
          onClose={() => setPassword(false)}
          onSave={async (v) => {
            await api.post("/auth/password", v);
            saveToken(null);
            window.dispatchEvent(
              new CustomEvent("invent:unauthorized", {
                detail: { reason: "password_change" },
              }),
            );
          }}
        />
      )}
    </div>
  );
}
