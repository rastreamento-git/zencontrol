import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

let sdk;
function googleSdk() {
  if (window.google?.accounts?.id)
    return Promise.resolve(window.google.accounts.id);
  if (!sdk) {
    sdk = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const failed = () => {
        clearTimeout(timeout);
        script.remove();
        reject(Error("O botão do Google não carregou. Tente novamente."));
      };
      const timeout = setTimeout(failed, 12000);
      script.onerror = failed;
      script.onload = () => {
        clearTimeout(timeout);
        const identity = window.google?.accounts?.id;
        if (!identity) failed();
        else resolve(identity);
      };
      document.head.appendChild(script);
    }).catch((error) => {
      sdk = null;
      throw error;
    });
  }
  return sdk;
}

export default function GoogleButton({
  clientId,
  intent = "login",
  nonce,
  onComplete,
}) {
  const host = useRef(null),
    preparation = useRef(null),
    callback = useRef(onComplete);
  const [state, setState] = useState("loading"),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    let active = true;
    const node = host.current;
    if (!preparation.current) {
      preparation.current = Promise.all([
        googleSdk(),
        nonce
          ? Promise.resolve(nonce)
          : api
              .post("/auth/google/challenge", { intent })
              .then(({ data }) => data.nonce),
      ]);
    }
    preparation.current
      .then(([identity, challenge]) => {
        if (!active) return;
        identity.initialize({
          client_id: clientId,
          nonce: challenge,
          auto_select: false,
          ux_mode: "popup",
          callback: async ({ credential }) => {
            if (!active) return;
            setState("checking");
            setError("");
            try {
              const { data } = await api.post("/auth/google/complete", {
                intent,
                nonce: challenge,
                credential,
              });
              if (active) await callback.current(data);
            } catch (e) {
              if (active) {
                setError(
                  e.response
                    ? errorMessage(e)
                    : "Não foi possível confirmar o acesso Google.",
                );
                setState("error");
              }
            }
          },
        });
        node.replaceChildren();
        identity.renderButton(node, {
          type: "standard",
          size: "large",
          theme: "outline",
          shape: "rectangular",
          text: "continue_with",
          locale: "pt_BR",
          width: Math.max(
            180,
            Math.min(360, Math.floor(node.getBoundingClientRect().width)),
          ),
        });
        setState("ready");
      })
      .catch((e) => {
        if (!active) return;
        setError(e.response ? errorMessage(e) : e.message);
        setState("error");
      });
    return () => {
      active = false;
      node?.replaceChildren();
    };
  }, [clientId, intent, nonce, attempt]);
  return (
    <div className="zen-google">
      <div ref={host} className="zen-google-button" inert={state !== "ready"} />
      {state === "loading" && <p role="status">Preparando acesso Google…</p>}
      {state === "checking" && <p role="status">Confirmando sua conta…</p>}
      {error && (
        <div className="zen-inline-feedback">
          <p role="alert">{error}</p>
          {intent === "login" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                preparation.current = null;
                setError("");
                setState("loading");
                setAttempt((n) => n + 1);
              }}
            >
              Tentar Google novamente
            </button>
          )}
        </div>
      )}
    </div>
  );
}
