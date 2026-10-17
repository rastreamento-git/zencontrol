import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { api, errorMessage, saveToken } from "../lib/api";
import { SessionContext } from "../lib/session";
import AppFooter from "./AppFooter";
export default function AuthGate({ children, audience = "central" }) {
  const technicianEntry = audience === "technician";
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [login, setLogin] = useState(technicianEntry ? "" : "admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  function applySession(data) {
    if (data.user && (data.user.papel === "tecnico") !== technicianEntry) {
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
      const { data } = await api.get("/auth/session");
      applySession(data);
    } catch (e) {
      setError(errorMessage(e));
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
      const { data } = await api.post("/auth/login", {
        login,
        password,
        audience,
      });
      if (applySession(data)) saveToken(data.token);
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
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
      <div className="auth-layout">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="brand-mark">
              <Box size={24} aria-hidden="true" />
            </span>
            <div>
              <h1 id="auth-title">
                {technicianEntry ? (
                  <>
                    Zen<span>Field</span>
                  </>
                ) : (
                  <>
                    Zen<span>Control</span>
                  </>
                )}
              </h1>
              <p>
                {technicianEntry
                  ? "Portal do técnico"
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
          ) : (
            <form onSubmit={submitLogin} className="auth-form">
              <p className="auth-description">
                {technicianEntry
                  ? "Entre com seu usuário e senha para ver os serviços, enviar fotos e acompanhar a confirmação da central."
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
              {error && (
                <p role="alert" className="text-red-700">
                  {error}
                </p>
              )}
              <button disabled={busy} className="primary-button">
                {busy ? "Entrando…" : "Entrar"}
              </button>
            </form>
          )}
        </section>
      </div>
      <AppFooter product={technicianEntry ? "ZenField" : "ZenControl"} />
    </main>
  );
}
