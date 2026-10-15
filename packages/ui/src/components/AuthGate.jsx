import { useEffect, useState } from "react";
import { Box } from "lucide-react";
import { api, errorMessage, saveToken } from "../lib/api";
import { SessionContext } from "../lib/session";
import AppFooter from "./AppFooter";
export default function AuthGate({ children }) {
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);
  const [login, setLogin] = useState("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    setStatus("loading");
    setError("");
    try {
      const { data } = await api.get("/auth/session");
      setUser(data.user);
      setStatus(data.authenticated ? "ready" : "login");
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
      const { data } = await api.post("/auth/login", { login, password });
      saveToken(data.token);
      setUser(data.user);
      setPassword("");
      setStatus("ready");
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
                Zen<span>Control</span>
              </h1>
              <p>Agendamentos e equipe técnica</p>
            </div>
          </div>
          {status === "loading" ? (
            <p role="status">Conectando ao ZenControl…</p>
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
                Entre para acompanhar os agendamentos e os atendimentos.
              </p>
              <label htmlFor="login">Usuário</label>
              <input
                id="login"
                name="username"
                autoComplete="username"
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
                autoFocus
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
      <AppFooter />
    </main>
  );
}
