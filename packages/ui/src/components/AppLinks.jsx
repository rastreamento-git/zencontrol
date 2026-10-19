import { useEffect, useState } from "react";
import { useSession } from "../lib/session";
import { openApp } from "../lib/sso";
import { api } from "../lib/api";
import { notify } from "../lib/feedback";
export default function AppLinks() {
  const user = useSession();
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    api
      .get("/auth/config")
      .then(({ data }) => setEnabled(data.unified_login))
      .catch(() => {});
  }, []);
  if (!enabled || !["admin", "operador"].includes(user?.papel)) return null;
  return (
    <button
      type="button"
      className="nav-item"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await openApp("stock");
        } catch {
          notify(
            "Não foi possível abrir o Estoque Pro. Tente novamente.",
            "error",
          );
          setBusy(false);
        }
      }}
    >
      {busy ? "Abrindo…" : "Abrir Estoque Pro"}
    </button>
  );
}
