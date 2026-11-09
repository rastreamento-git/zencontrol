import { useEffect, useId, useRef, useState } from "react";
import { Check, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useSession, useSessionName } from "../lib/session";
import GoogleButton from "./GoogleButton";
import Modal from "./Modal";

const roleLabels = {
  admin: "Administrador",
  operador: "Operador",
  tecnico: "Técnico",
};

function Profile({ onClose, onPassword }) {
  const user = useSession(),
    setName = useSessionName(),
    id = useId();
  const [profile, setProfile] = useState(null),
    [clientId, setClientId] = useState("");
  const [name, setDisplay] = useState(user.nome),
    [phone, setPhone] = useState("");
  const [password, setPassword] = useState(""),
    [nonce, setNonce] = useState("");
  const [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api.get("/account/profile", { signal: controller.signal }),
      api.get("/auth/config", { signal: controller.signal }),
    ])
      .then(([result, config]) => {
        if (controller.signal.aborted) return;
        setProfile(result.data);
        setDisplay(result.data.user.nome);
        setPhone(result.data.phone);
        setClientId(config.data.google_client_id || "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [revision]);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { data } = await api.patch("/account/profile", {
        nome: name,
        phone,
      });
      setProfile(data);
      setDisplay(data.user.nome);
      setPhone(data.phone);
      setName(data.user.nome);
      setSuccess("Perfil atualizado.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function changeGoogle(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (profile.google_email) {
        await api.delete("/account/google", { data: { password } });
        setProfile({ ...profile, google_email: null });
        setSuccess("Conta Google desvinculada.");
      } else {
        const { data } = await api.post("/auth/google/challenge", {
          intent: "link",
          password,
        });
        setNonce(data.nonce);
      }
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Meu perfil" onClose={onClose} busy={busy}>
      <div className="zen-profile">
        <div className="zen-profile-identity">
          <span className="zen-profile-avatar">
            <UserRound size={22} />
          </span>
          <div>
            <strong>{user.nome}</strong>
            <small>
              {user.login} · {roleLabels[user.papel]}
            </small>
          </div>
        </div>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="zen-profile-success">
            <Check size={16} /> {success}
          </p>
        )}
        {!profile ? (
          error ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setError("");
                setRevision((n) => n + 1);
              }}
            >
              Tentar novamente
            </button>
          ) : (
            <p role="status">Carregando seu perfil…</p>
          )
        ) : (
          <>
            <form className="zen-profile-form" onSubmit={save}>
              <label htmlFor={id + "-name"}>Nome de exibição</label>
              <input
                id={id + "-name"}
                required
                minLength={2}
                maxLength={120}
                autoComplete="name"
                value={name}
                onChange={(e) => setDisplay(e.target.value)}
              />
              <label htmlFor={id + "-phone"}>
                Telefone <small>(opcional)</small>
              </label>
              <input
                id={id + "-phone"}
                type="tel"
                maxLength={24}
                autoComplete="tel"
                placeholder="(21) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <button type="submit" className="primary-button" disabled={busy}>
                Salvar perfil
              </button>
            </form>
            {(clientId || profile.google_email) && (
              <section
                className="zen-profile-security"
                aria-labelledby={id + "-google"}
              >
                <h3 id={id + "-google"}>
                  <ShieldCheck size={18} /> Acesso com Google
                </h3>
                <p>
                  {profile.google_email
                    ? "Vinculado a " + profile.google_email
                    : "Vincule sua conta para entrar mais rápido no ZenTracking."}
                </p>
                {nonce ? (
                  <>
                    <GoogleButton
                      key={nonce}
                      clientId={clientId}
                      intent="link"
                      nonce={nonce}
                      onComplete={() => {
                        setNonce("");
                        setSuccess("Conta Google vinculada.");
                        setRevision((n) => n + 1);
                      }}
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setNonce("")}
                    >
                      Voltar
                    </button>
                  </>
                ) : (
                  <form className="zen-profile-form" onSubmit={changeGoogle}>
                    <label htmlFor={id + "-password"}>
                      Confirme sua senha atual
                    </label>
                    <input
                      id={id + "-password"}
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="secondary-button"
                      disabled={busy}
                    >
                      {profile.google_email
                        ? "Desvincular Google"
                        : "Vincular Google"}
                    </button>
                  </form>
                )}
              </section>
            )}
          </>
        )}
        {onPassword && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              onClose();
              onPassword();
            }}
          >
            <KeyRound size={17} /> Alterar senha
          </button>
        )}
      </div>
    </Modal>
  );
}

export default function ProfileButton({
  onPassword,
  compact = false,
  initiallyOpen = false,
}) {
  const [open, setOpen] = useState(initiallyOpen),
    trigger = useRef(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={
          compact ? "icon-button" : "secondary-button zen-profile-trigger"
        }
        aria-label="Meu perfil"
        title="Meu perfil"
        onClick={() => setOpen(true)}
      >
        <UserRound size={18} aria-hidden="true" />{" "}
        {!compact && <span>Meu perfil</span>}
      </button>
      {open && <Profile onClose={close} onPassword={onPassword} />}
    </>
  );
}
