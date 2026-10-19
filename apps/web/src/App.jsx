import { passwordInputProps, passwordRequirements } from "@zen/ui/lib/password-policy";
import AppLinks from "@zen/ui/components/AppLinks";
import { NoticeBell, FinancePanel } from "./components/Ecosystem";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  ClipboardList,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Users,
  Wallet,
  Wrench,
  X,
  Download,
  Heart,
  KeyRound,
} from "lucide-react";
import { useSession } from "@zen/ui/lib/session";
import { api, errorMessage, saveToken } from "@zen/ui/lib/api";
import { notify } from "@zen/ui/lib/feedback";
import AppFooter from "@zen/ui/components/AppFooter";
import Dashboard from "./components/Dashboard";
import {
  Orders,
  OrderEditor,
  Technicians,
  Volunteers,
  UsersPage,
} from "./components/Records";
import {
  Batches,
  Finance,
  SettingsPage,
  Queue,
  HistoryPage,
} from "./components/Operations";
import { FormModal, initials, download, Loading } from "./components/common";
const groups = [
  {
    label: "Visão geral",
    items: [["dashboard", "Painel de controle", LayoutDashboard]],
  },
  {
    label: "Operação",
    items: [
      ["orders", "Ordens de serviço", ClipboardList],
      ["agenda", "Agenda", CalendarDays],
      ["batches", "Validações", CheckCheck],
      ["technicians", "Equipe técnica", Wrench],
    ],
  },
  {
    label: "Gestão",
    items: [
      ["volunteers", "Voluntários", Heart],
      ["finance", "Financeiro", Wallet, true],
      ["history", "Histórico", History, true],
      ["users", "Equipe e acessos", Users, true],
      ["settings", "Configurações", Settings, true],
    ],
  },
];
export default function App() {
  const user = useSession(),
    admin = user.papel === "admin";
  const [tab, setTab] = useState("dashboard"),
    [menu, setMenu] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [meta, setMeta] = useState(null),
    [overview, setOverview] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [order, setOrder] = useState(null),
    [password, setPassword] = useState(false),
    [updated, setUpdated] = useState(null);
  const body = useRef(null);
  const title =
    groups.flatMap((g) => g.items).find((v) => v[0] === tab)?.[1] ||
    "Fila de integrações";
  const [loading, setLoading] = useState(true);
  function navigate(t) {
    setTab(t);
    setMenu(false);
  }
  function refresh() {
    setRevision((r) => r + 1);
  }
  useEffect(() => {
    const handler = (e) => setBusy(e.detail);
    window.addEventListener("invent:busy", handler);
    return () => window.removeEventListener("invent:busy", handler);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.get("/meta"), api.get("/overview")])
      .then(([m, o]) => {
        if (active) {
          setMeta(m.data);
          setOverview(o.data);
          setError("");
          setUpdated(new Date());
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [tab]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !busy) refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [busy]);
  const props = {
    user,
    meta,
    overview,
    revision,
    refresh,
    navigate,
    openOrder: (id) => setOrder({ id: id || null }),
  };
  return (
    <div className="inventory-app">
      {menu && (
        <button
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        id="zencontrol-menu"
        className={"app-sidebar " + (menu ? "is-open" : "")}
      >
        <div className="brand">
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <div>
            <strong>
              Zen<span>Control</span>
            </strong>
            <small>Agendamentos & atendimento</small>
          </div>
          <button
            className="icon-button sidebar-close"
            aria-label="Fechar menu"
            onClick={() => setMenu(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {groups.map((g) => (
            <div className="nav-group" key={g.label}>
              <p>{g.label}</p>
              {g.items
                .filter(([, , , a]) => !a || admin)
                .map(([id, label, Icon]) => (
                  <button
                    key={id}
                    className={"nav-item " + (tab === id ? "is-active" : "")}
                    onClick={() => navigate(id)}
                    aria-current={tab === id ? "page" : undefined}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    {tab === id && <ChevronRight size={15} />}
                  </button>
                ))}
            </div>
          ))}
          <AppLinks />
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{initials(user.nome)}</span>
          <div>
            <strong>{user.nome}</strong>
            <small>{admin ? "Administrador" : "Operador"}</small>
          </div>
          <button
            className="icon-button"
            title="Alterar senha"
            aria-label="Alterar senha"
            onClick={() => setPassword(true)}
          >
            <KeyRound size={17} />
          </button>
          <button
            className="icon-button"
            title="Sair"
            aria-label="Sair"
            disabled={busy}
            onClick={async () => {
              try {
                await api.post("/auth/logout", {});
              } catch (e) {
                notify(errorMessage(e), "error");
                return;
              }
              saveToken(null);
              window.dispatchEvent(
                new CustomEvent("invent:unauthorized", {
                  detail: { reason: "logout" },
                }),
              );
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <button
              className="icon-button menu-toggle"
              aria-label="Abrir menu"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Menu size={22} />
            </button>
            <div>
              <div className="breadcrumb">
                ZenControl <ChevronRight size={12} />
                {title}
              </div>
              <h1>{title}</h1>
            </div>
          </div>
          <form
            className="topbar-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search.trim());
              navigate("orders");
            }}
          >
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar OS, placa ou associado…"
              aria-label="Pesquisar OS, placa ou associado"
              maxLength={200}
            />
            <button type="submit" aria-label="Executar pesquisa">
              <ChevronRight size={18} />
            </button>
          </form>
          <div className="topbar-actions">
            <span className="header-date">
              {new Date().toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
              })}
            </span>
            <NoticeBell
              onOpen={(n) => {
                if (n.detail.order_id) {
                  setOrder({ id: n.detail.order_id });
                  navigate("batches");
                } else
                  navigate(n.target === "requests" ? "finance" : "batches");
              }}
            />
            {admin && (
              <button
                className="icon-button"
                aria-label="Baixar backup"
                title="Baixar backup"
                onClick={() =>
                  download("/backup", "ZenControl-backup.zip").catch((e) =>
                    notify(errorMessage(e), "error"),
                  )
                }
              >
                <Download size={19} />
              </button>
            )}
            <span className="avatar header-avatar" title={user.nome}>
              {initials(user.nome)}
            </span>
          </div>
        </header>
        <div className="app-content" ref={body}>
          <div className="sync-toolbar">
            <span
              className={"sync-status " + (error ? "has-error" : "")}
              role="status"
            >
              <i />
              {busy
                ? "Salvando alterações…"
                : loading
                  ? "Atualizando operação…"
                  : error
                    ? "Falha na atualização"
                    : `Última atualização às ${updated?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "—"}`}
            </span>
            <button
              className="refresh-button"
              disabled={loading || busy}
              onClick={refresh}
            >
              <RefreshCw size={14} />
              Atualizar dados
            </button>
          </div>
          <div className="workspace-view">
            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}
            {!meta || !overview ? (
              <Loading error={error} />
            ) : tab === "dashboard" ? (
              <Dashboard {...props} />
            ) : ["orders", "agenda"].includes(tab) ? (
              <Orders
                {...props}
                agenda={tab === "agenda"}
                globalQuery={query}
              />
            ) : tab === "technicians" ? (
              <Technicians {...props} />
            ) : tab === "volunteers" ? (
              <Volunteers {...props} />
            ) : tab === "users" ? (
              <UsersPage {...props} />
            ) : tab === "batches" ? (
              <Batches {...props} />
            ) : tab === "finance" ? (
              <FinancePanel />
            ) : tab === "history" ? (
              <HistoryPage {...props} />
            ) : tab === "settings" ? (
              <SettingsPage {...props} />
            ) : (
              <Queue {...props} />
            )}
          </div>
        </div>
        <AppFooter />
      </main>
      {order && (
        <OrderEditor
          key={order.id || "new"}
          {...props}
          id={order.id}
          onClose={() => setOrder(null)}
        />
      )}{" "}
      {password && (
        <FormModal
          title="Alterar senha"
          description={passwordRequirements}
          fields={[
            {
              name: "current_password",
              autoComplete: "current-password",
              label: "Senha atual",
              type: "password",
              required: true,
              full: true,
            },
            {
              name: "new_password",
              ...passwordInputProps,
              label: "Nova senha",
              type: "password",
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
