import ThemeControl from "./ThemeControl";
import AuthStory, { AuthApps } from "./AuthStory";
import ZenMark from "./ZenMark";
import GoogleButton from "./GoogleButton";
import {
  passwordInputProps,
  passwordRequirements,
} from "../lib/password-policy";
import { useEffect, useState } from "react";
import { api, errorMessage, saveToken } from "../lib/api";
import { SessionContext, SessionNameContext } from "../lib/session";
import AppFooter from "./AppFooter";
import { prepareAccess, routeSession, beginLogin } from "../lib/sso";
export default function AuthGate({ children, audience = "central" }) {
  const technicianEntry = audience === "technician";
  const currentApp = technicianEntry ? "zenfield" : "zencontrol";
  const [access, setAccess] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).get("redefinir"),
  );
  const [mode, setMode] = useState(resetToken === null ? "login" : "reset"),
    [identifier, setIdentifier] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [message, setMessage] = useState("");
  const connecting = status === "loading" || !access;
  const google =
    !technicianEntry &&
    mode === "login" &&
    access?.google_client_id &&
    window.location.origin === access.login_url;
  useEffect(() => {
    document.title = connecting
      ? "ZenTracking · Conectando…"
      : technicianEntry
        ? "ZenField · ZenTracking"
        : access?.unified_login
          ? "ZenTracking · Rastreamento"
          : "ZenControl · Gestão de serviços";
  }, [connecting, technicianEntry, access?.unified_login]);
  async function applySession(data, config = access) {
    if (!data.user) {
      setUser(null);
      setStatus("login");
      return true;
    }
    if (await routeSession(data, currentApp, config)) {
      setStatus("loading");
      return true;
    }
    if (
      data.user &&
      technicianEntry &&
      (!data.api_version ||
        Number(data.api_version.split(".")[0]) < 6 ||
        (data.api_version.startsWith("6.") &&
          Number(data.api_version.split(".")[1]) < 4))
    ) {
      saveToken(null);
      setStatus("login");
      setError(
        "Este ZenField requer a API ZenControl 6.4 ou superior. Peça à central a atualização do backend de homologação.",
      );
      return false;
    }
    if (
      !config?.unified_login &&
      data.user &&
      (technicianEntry
        ? !["admin", "operador", "tecnico"].includes(data.user.papel)
        : data.user.papel === "tecnico")
    ) {
      saveToken(null);
      setUser(null);
      setStatus("login");
      setError(
        technicianEntry
          ? "Use uma conta de técnico para entrar neste portal."
          : "Esta conta é de técnico. Entre pelo Portal do Técnico.",
      );
      return false;
    }
    setUser(data.user);
    setStatus(data.authenticated === false ? "login" : "ready");
    return true;
  }
  async function check() {
    setStatus("loading");
    setError("");
    try {
      const config = await prepareAccess(currentApp);
      setAccess(config);
      if (config.redirecting) return;
      if (resetToken !== null) {
        setStatus("login");
        return;
      }
      const { data } = await api.get("/auth/session");
      await applySession(data, config);
    } catch (e) {
      setError(e.response ? errorMessage(e) : e.message || errorMessage(e));
      setStatus("error");
    }
  }
  useEffect(() => {
    if (resetToken !== null)
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    check();
    const expired = (event) => {
      setStatus("login");
      setUser(null);
      setError(
        event.detail?.reason === "logout"
          ? ""
          : event.detail?.reason === "password_change"
            ? "Senha alterada. Entre novamente."
            : "Sua sessão expirou. Entre novamente.",
      );
    };
    window.addEventListener("invent:unauthorized", expired);
    const followResetLink = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get(
        "redefinir",
      );
      if (token === null) return;
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      switchMode("reset");
      setResetToken(token);
      setStatus("login");
      setUser(null);
    };
    window.addEventListener("hashchange", followResetLink);
    return () => {
      window.removeEventListener("invent:unauthorized", expired);
      window.removeEventListener("hashchange", followResetLink);
    };
  }, []);
  async function completeLogin(data) {
    saveToken(data.token);
    try {
      if (
        currentApp === "zencontrol" &&
        ["admin", "operador"].includes(data.user?.papel) &&
        !new URLSearchParams(window.location.search).has("zen_app")
      )
        history.replaceState(
          null,
          "",
          new URLSearchParams(window.location.search).get("perfil") === "1"
            ? "/?perfil=1"
            : "/",
        );
      if (!(await applySession(data))) saveToken(null);
    } catch (e) {
      saveToken(null);
      throw e;
    }
  }
  async function submitLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "forgot") {
        const { data } = await api.post("/auth/password/forgot", {
          identifier,
        });
        setMessage(data.message);
        return;
      }
      if (mode === "first" || mode === "reset") {
        if (newPassword !== confirmation)
          throw Error("As duas senhas precisam ser iguais.");
        if (mode === "first") {
          await api.post("/auth/activate", {
            login,
            password,
            new_password: newPassword,
          });
        } else {
          await api.post("/auth/password/reset", {
            token: resetToken,
            new_password: newPassword,
          });
          saveToken(null);
          setResetToken(null);
        }
        setMode("login");
        setPassword("");
        setNewPassword("");
        setConfirmation("");
        setMessage("Senha definida. Entre com sua nova senha.");
        return;
      }
      const { data } = await api.post("/auth/login", {
        login,
        password,
        audience: access?.unified_login ? "ecosystem" : audience,
      });
      if (data.password_change_required) {
        setMode("first");
        setMessage("");
        return;
      }
      await completeLogin(data);
      setPassword("");
    } catch (e) {
      setError(e.response ? errorMessage(e) : e.message || errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function switchMode(next) {
    setError("");
    setMessage("");
    setPassword("");
    setNewPassword("");
    setConfirmation("");
    setResetToken(null);
    setMode(next);
  }
  if (status === "ready")
    return (
      <SessionContext.Provider value={user}>
        <SessionNameContext.Provider
          value={(nome) => setUser((old) => (old ? { ...old, nome } : old))}
        >
          {children}
        </SessionNameContext.Provider>
      </SessionContext.Provider>
    );
  return (
    <div className="auth-page">
      <header className="auth-site-header">
        <div className="auth-site-nav">
          <span className="auth-site-brand">
            <ZenMark variant="tracking" size={32} />
            ZenTracking
          </span>
          <ThemeControl />
        </div>
      </header>
      <main className="auth-layout">
        <AuthStory />
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="brand-mark">
              <ZenMark variant="tracking" size={44} />
            </span>
            <div>
              <h1 id="auth-title">
                {connecting ? (
                  "ZenTracking"
                ) : technicianEntry ? (
                  <>
                    Zen<span>Field</span>
                  </>
                ) : access?.unified_login ? (
                  "ZenTracking"
                ) : (
                  <>
                    Zen<span>Control</span>
                  </>
                )}
              </h1>
              <p>
                {connecting
                  ? "Ecossistema de rastreamento"
                  : technicianEntry
                    ? "Portal do técnico"
                    : access?.unified_login
                      ? "Acesso único"
                      : "Agendamentos e equipe técnica"}
              </p>
            </div>
          </div>
          {status === "loading" ? (
            <p role="status">Conectando…</p>
          ) : status === "error" ? (
            <>
              <p role="alert" className="text-red-700 mb-4">
                {error}
              </p>
              <button onClick={check} className="primary-button">
                Tentar novamente
              </button>
            </>
          ) : technicianEntry && access?.unified_login && mode === "login" ? (
            <div className="auth-form">
              <p className="auth-description">
                Use sua conta ZenTracking. Seu perfil abre automaticamente a
                área correta.
              </p>
              {message && <p role="status">{message}</p>}
              {error && <p role="alert">{error}</p>}
              <button
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await beginLogin(currentApp, access);
                  } catch (e) {
                    setError(e.message);
                    setBusy(false);
                  }
                }}
              >
                Entrar no ZenTracking
              </button>
              <p>
                No primeiro acesso, entre com a senha temporária da central para
                definir a sua.
              </p>
              <button
                type="button"
                className="zen-auth-link"
                onClick={() => switchMode("forgot")}
                disabled={busy}
              >
                Esqueci minha senha
              </button>
            </div>
          ) : mode === "login" ? (
            <form onSubmit={submitLogin} className="auth-form">
              <p className="auth-description">
                {technicianEntry
                  ? "Entre com seu usuário e senha para ver os serviços, enviar fotos e acompanhar a confirmação da central."
                  : access?.unified_login
                    ? "Acesse ZenControl, ZenField e Estoque Pro em um só lugar. Técnicos seguem diretamente para o ZenField."
                    : "Entre para acompanhar os agendamentos e os atendimentos."}
              </p>
              {google && (
                <>
                  <GoogleButton
                    clientId={access.google_client_id}
                    onComplete={completeLogin}
                  />
                  <div className="zen-auth-divider">
                    <span>ou entre com usuário e senha</span>
                  </div>
                </>
              )}
              <label htmlFor="login">Usuário</label>
              <input
                id="login"
                name="username"
                autoComplete="username"
                autoFocus={technicianEntry}
                required
                disabled={busy}
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
              <label htmlFor="password">Senha de acesso</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
                autoFocus={!technicianEntry}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {message && <p role="status">{message}</p>}
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <button disabled={busy} className="primary-button">
                {busy ? "Aguarde…" : "Entrar"}
              </button>
              <button
                type="button"
                className="zen-auth-link"
                onClick={() => switchMode("forgot")}
                disabled={busy}
              >
                Esqueci minha senha
              </button>
              {(technicianEntry || access?.unified_login) && (
                <p className="auth-description">
                  No primeiro acesso, use a senha temporária da central. Você
                  define a definitiva na próxima tela.
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={submitLogin} className="auth-form">
              <h2 className="zen-auth-step-title">
                {mode === "forgot"
                  ? "Recuperar acesso"
                  : mode === "first"
                    ? "Defina sua primeira senha"
                    : "Redefina sua senha"}
              </h2>
              {mode === "forgot" ? (
                <>
                  <p className="auth-description">
                    O link vai para o e-mail cadastrado na conta.
                  </p>
                  <label htmlFor="recovery-identifier">
                    Usuário ou e-mail cadastrado
                  </label>
                  <input
                    id="recovery-identifier"
                    autoComplete="username"
                    autoFocus
                    required
                    maxLength={254}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                  />
                </>
              ) : (
                <>
                  {mode === "first" && (
                    <p className="auth-description">
                      A senha temporária foi aceita para{" "}
                      <strong>{login}</strong>.
                    </p>
                  )}
                  <p
                    id="new-password-requirements"
                    className="auth-description"
                  >
                    {passwordRequirements}
                  </p>
                  <label htmlFor="new-password">Nova senha</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    aria-describedby="new-password-requirements"
                    {...passwordInputProps}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <label htmlFor="confirm-password">
                    Confirme a nova senha
                  </label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </>
              )}
              {message && <p role="status">{message}</p>}
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="primary-button"
                disabled={busy || (mode === "forgot" && Boolean(message))}
              >
                {busy
                  ? "Aguarde…"
                  : mode === "forgot"
                    ? "Enviar link"
                    : "Salvar nova senha"}
              </button>
              {mode === "reset" && error && (
                <button
                  type="button"
                  className="zen-auth-link"
                  onClick={() => switchMode("forgot")}
                >
                  Solicitar outro link
                </button>
              )}
              <button
                type="button"
                className="zen-auth-link"
                onClick={() => switchMode("login")}
                disabled={busy}
              >
                Voltar ao login
              </button>
            </form>
          )}
        </section>
        <AuthApps />
      </main>
      <AppFooter
        product={
          connecting
            ? "ZenTracking"
            : access?.unified_login
              ? "ZenTracking"
              : technicianEntry
                ? "ZenField"
                : "ZenControl"
        }
      />
    </div>
  );
}
