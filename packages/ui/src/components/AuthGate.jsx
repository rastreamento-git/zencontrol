import ThemeControl from "./ThemeControl";
import AuthStory from "./AuthStory";
import ZenMark from "./ZenMark";
import {
  passwordInputProps,
  passwordRequirements,
} from "../lib/password-policy";
import { useEffect, useState } from "react";
import { api, errorMessage, saveToken } from "../lib/api";
import { SessionContext } from "../lib/session";
import AppFooter from "./AppFooter";
import { prepareAccess, routeSession, beginLogin } from "../lib/sso";
export default function AuthGate({ children, audience = "central" }) {
  const technicianEntry = audience === "technician";
  const currentApp = technicianEntry ? "zenfield" : "zencontrol";
  const [access, setAccess] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [login, setLogin] = useState(technicianEntry ? "" : "admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [activation, setActivation] = useState(false),
    [code, setCode] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [message, setMessage] = useState("");
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
      const { data } = await api.get("/auth/session");
      await applySession(data, config);
    } catch (e) {
      setError(e.response ? errorMessage(e) : e.message || errorMessage(e));
      setStatus("error");
    }
  }
  useEffect(() => {
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
    return () => window.removeEventListener("invent:unauthorized", expired);
  }, []);
  async function submitLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (activation) {
        await api.post("/auth/activate", {
          login,
          password,
          code,
          new_password: newPassword,
        });
        setActivation(false);
        setPassword("");
        setCode("");
        setNewPassword("");
        setMessage("Conta ativada. Entre com sua nova senha.");
        return;
      }
      const { data } = await api.post("/auth/login", {
        login,
        password,
        audience: access?.unified_login ? "ecosystem" : audience,
      });
      saveToken(data.token);
      if (
        currentApp === "zencontrol" &&
        ["admin", "operador"].includes(data.user?.papel) &&
        !new URLSearchParams(window.location.search).has("zen_app")
      )
        history.replaceState(null, "", "/");
      if (!(await applySession(data))) saveToken(null);
      setPassword("");
    } catch (e) {
      setError(e.response ? errorMessage(e) : e.message || errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (status === "ready")
    return (
      <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
    );
  return (
    <main className="auth-page">
      <div className="auth-appearance">
        <ThemeControl />
      </div>
      <div className="auth-layout">
        <AuthStory />
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="brand-mark">
              <ZenMark variant="tracking" size={44} />
            </span>
            <div>
              <h1 id="auth-title">
                {technicianEntry ? (
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
                {technicianEntry
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
          ) : technicianEntry && access?.unified_login ? (
            <div className="auth-form">
              <p className="auth-description">
                Use sua conta ZenTracking. Seu perfil abre automaticamente a
                área correta.
              </p>
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
                Primeiro acesso? Ative sua conta na tela de acesso ZenTracking
                com o código fornecido pela central.
              </p>
            </div>
          ) : (
            <form onSubmit={submitLogin} className="auth-form">
              <p className="auth-description">
                {technicianEntry
                  ? "Entre com seu usuário e senha para ver os serviços, enviar fotos e acompanhar a confirmação da central."
                  : access?.unified_login
                    ? "Acesse ZenControl, ZenField e EstoquePro em um só lugar. Técnicos seguem diretamente para o ZenField."
                    : "Entre para acompanhar os agendamentos e os atendimentos."}
              </p>
              <label htmlFor="login">Usuário</label>
              <input
                id="login"
                name="username"
                autoComplete="username"
                autoFocus={technicianEntry}
                required
                value={login}
                onChange={(e) => setLogin(e.target.value)}
              />
              <label htmlFor="password">Senha de acesso</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus={!technicianEntry}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {(technicianEntry || access?.unified_login) && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={activation}
                      onChange={(e) => {
                        setActivation(e.target.checked);
                        setError("");
                        setMessage("");
                      }}
                    />{" "}
                    Primeiro acesso ou redefinição
                  </label>
                  {activation && (
                    <>
                      <label htmlFor="activation-code">
                        Código individual fornecido pela central
                      </label>
                      <input
                        id="activation-code"
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        required
                      />
                      <label htmlFor="new-password">
                        Nova senha (mínimo 8 caracteres)
                      </label>
                      <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        {...passwordInputProps}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                      />
                      <p>
                        {passwordRequirements} Use zen123 como senha provisória
                        e o código individual. O código expira em 24 horas.
                      </p>
                    </>
                  )}
                </>
              )}
              {message && <p role="status">{message}</p>}
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <button disabled={busy} className="primary-button">
                {busy ? "Aguarde…" : activation ? "Ativar conta" : "Entrar"}
              </button>
            </form>
          )}
        </section>
      </div>
      <AppFooter
        product={
          access?.unified_login
            ? "ZenTracking"
            : technicianEntry
              ? "ZenField"
              : "ZenControl"
        }
      />
    </main>
  );
}
