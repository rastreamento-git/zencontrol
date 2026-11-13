import ThemeControl from "@zen/ui/components/ThemeControl";
import ZenMark from "@zen/ui/components/ZenMark";
import ProfileButton from "@zen/ui/components/ProfileButton";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  LogOut,
  ArrowDown,
  CalendarCheck2,
  ClipboardCheck,
  MessageCircle,
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

const apps = [
  {
    id: "stock",
    name: "Estoque Pro",
    category: "EQUIPAMENTOS E RASTREABILIDADE",
    description:
      "Gerencie equipamentos, cargas dos técnicos e movimentações de estoque.",
    features: ["Inventário", "Cargas", "Rastreabilidade"],
    variant: "stock",
  },
  {
    id: "zencontrol",
    name: "ZenControl",
    category: "GESTÃO DA OPERAÇÃO",
    description:
      "Organize ordens de serviço, agendamentos, equipe e conferências.",
    features: ["Agendamentos", "Conferências", "Financeiro"],
    variant: "control",
  },
  {
    id: "zenfield",
    name: "ZenField",
    category: "OPERAÇÃO EM CAMPO",
    description:
      "Acesse o ambiente de um técnico e acompanhe ou realize os atendimentos.",
    features: ["Serviços", "Evidências", "Equipe em campo"],
    variant: "field",
  },
];

const shortcuts = [
  ["agenda", "Agenda", "Serviços programados", CalendarCheck2],
  ["batches", "Conferir serviços", "Evidências da equipe", ClipboardCheck],
  ["chat", "Conversas", "Fale com os técnicos", MessageCircle],
];

export default function TrackingHome() {
  const user = useSession();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [password, setPassword] = useState(false);
  const [initialProfile] = useState(
    () => new URLSearchParams(window.location.search).get("perfil") === "1",
  );
  useEffect(() => {
    if (!initialProfile) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("perfil");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, [initialProfile]);
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
        <div className="tracking-boundary tracking-header-inner">
          <a
            className="tracking-brand"
            href="/"
            aria-label="ZenTracking · Início"
          >
            <ZenMark variant="tracking" size={34} />
            <span>ZenTracking</span>
          </a>
          <nav
            className="tracking-header-nav"
            aria-label="Navegação do ZenTracking"
          >
            <a href="#tracking-apps">Aplicativos</a>
            <a href="#tracking-shortcuts">Acesso rápido</a>
          </nav>
          <div className="tracking-account">
            <ThemeControl />
            <span className="tracking-identity">
              <b>{user.nome}</b>
              <small>
                {user.papel === "admin" ? "Administrador" : "Operador"}
              </small>
            </span>
            <ProfileButton
              initiallyOpen={initialProfile}
              onPassword={() => setPassword(true)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Sair"
              onClick={logout}
              disabled={!!busy}
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <main className="tracking-main" id="tracking-content" tabIndex={-1}>
        <section className="tracking-hero" aria-labelledby="tracking-title">
          <div className="tracking-boundary">
            <div className="tracking-intro">
              <p className="tracking-eyebrow">
                <i aria-hidden="true" /> ECOSSISTEMA ZEN SEGUROS
              </p>
              <h1 id="tracking-title">
                Olá, {user.nome?.split(" ")[0] || "bem-vindo"}.
                <span>Seu espaço de trabalho.</span>
              </h1>
              <p className="tracking-description">
                Acompanhe a operação, a equipe em campo e o estoque no
                ZenTracking.
              </p>
              <div className="tracking-hero-actions">
                <a className="primary-button" href="#tracking-apps">
                  Ver aplicativos <ArrowDown size={16} aria-hidden="true" />
                </a>
                <a className="secondary-button" href="#tracking-shortcuts">
                  Ver atalhos
                </a>
              </div>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            <section
              className="tracking-catalog"
              id="tracking-apps"
              aria-labelledby="tracking-app-title"
            >
              <div className="tracking-section-heading">
                <h2 id="tracking-app-title">Aplicativos</h2>
                <span>3 ambientes conectados</span>
              </div>
              <div className="tracking-apps">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    className="tracking-card"
                    data-product={app.variant}
                    aria-label={"Abrir " + app.name}
                    aria-describedby={"tracking-app-description-" + app.id}
                    aria-busy={busy === app.id}
                    disabled={!!busy}
                    onClick={() => launch(app.id)}
                  >
                    <span className="tracking-card-top">
                      <span className="tracking-card-category">
                        <i aria-hidden="true" /> {app.category}
                      </span>
                      <ZenMark variant={app.variant} size={30} />
                    </span>
                    <span className="tracking-card-name">{app.name}</span>
                    <span
                      className="tracking-card-description"
                      id={"tracking-app-description-" + app.id}
                    >
                      {app.description}
                    </span>
                    <span className="tracking-features" aria-hidden="true">
                      {app.features.map((feature) => (
                        <span key={feature}>{feature}</span>
                      ))}
                    </span>
                    <span className="tracking-card-action" aria-hidden="true">
                      {busy === app.id ? "Abrindo…" : "Acessar"}
                      <ArrowUpRight size={16} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
        <section
          className="tracking-shortcuts"
          id="tracking-shortcuts"
          aria-labelledby="tracking-shortcuts-title"
        >
          <div className="tracking-boundary">
            <h2 id="tracking-shortcuts-title">Acesso rápido</h2>
            <nav
              className="tracking-shortcut-grid"
              aria-label="Acesso rápido"
            >
              {shortcuts.map(([area, label, description, Icon]) => (
                <a key={area} href={"/zencontrol?area=" + area}>
                  <Icon size={22} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              ))}
            </nav>
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
