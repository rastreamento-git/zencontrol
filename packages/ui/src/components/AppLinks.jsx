import { useEffect, useState } from "react";
import { LayoutGrid, Smartphone, Package } from "lucide-react";
import { useSession } from "../lib/session";
import { openApp } from "../lib/sso";
import { api } from "../lib/api";
import { notify } from "../lib/feedback";
export default function AppLinks() {
  const user = useSession();
  const [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    api
      .get("/auth/config")
      .then(({ data }) => setEnabled(data.unified_login))
      .catch(() => {});
  }, []);
  if (!enabled || !["admin", "operador"].includes(user?.papel)) return null;
  return (
    <div className="nav-group">
      <p>ZenTracking</p>
      <a className="nav-item" href="/">
        <LayoutGrid size={18} />
        <span>Aplicativos</span>
      </a>
      {[
        ["zenfield", "Abrir ZenField", Smartphone],
        ["stock", "Abrir EstoquePro", Package],
      ].map(([app, label, Icon]) => (
        <button
          key={app}
          type="button"
          className="nav-item"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await openApp(app);
            } catch {
              notify(
                "Não foi possível abrir o aplicativo. Tente novamente.",
                "error",
              );
              setBusy(false);
            }
          }}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
