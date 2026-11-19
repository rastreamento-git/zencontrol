import { useMemo, useState } from "react";
import {
  Headset,
  Plus,
  Search,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import Modal from "@zen/ui/components/Modal";
import { notify } from "@zen/ui/lib/feedback";
import { Empty, Intro, Loading, initials, useLoad } from "./common";
import {
  AccountForm,
  ActivationDetails,
  TechnicianAccess,
  TechnicianForm,
} from "./TeamForms";
import "./team-access.css";

const categories = [
  {
    id: "admin",
    label: "Administradores",
    singular: "Administrador",
    description: "Acesso às aplicações e à gestão do ZenTracking.",
    icon: ShieldCheck,
  },
  {
    id: "operador",
    label: "Operadores",
    singular: "Operador",
    description: "Acesso às aplicações e à gestão do ZenTracking.",
    icon: Headset,
  },
  {
    id: "tecnico",
    label: "Técnicos",
    singular: "Técnico",
    description: "Cadastro operacional e acesso individual ao ZenField.",
    icon: Wrench,
  },
];

function accessStatus(role, account, technician) {
  if (technician?.active === false)
    return { id: "inactive", text: "Cadastro inativo", tone: "gray" };
  if (role === "tecnico" && !technician)
    return { id: "unlinked", text: "Vínculo pendente", tone: "amber" };
  if (!account) return { id: "missing", text: "Sem acesso", tone: "amber" };
  if (!account.ativo)
    return { id: "inactive", text: "Desativado", tone: "gray" };
  if (account.activation_required)
    return { id: "pending", text: "Troca de senha pendente", tone: "amber" };
  return { id: "enabled", text: "Habilitado", tone: "mint" };
}

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function buildDirectory(accounts, technicians) {
  const techIds = new Set(technicians.map((t) => t.id));
  const linked = new Map();
  const groups = { admin: [], operador: [], tecnico: [] };
  function add(role, account, technician = null) {
    const name = technician?.name || account.nome;
    groups[role].push({
      id: technician ? "technician-" + technician.id : "account-" + account.id,
      role,
      name,
      account,
      technician,
      status: accessStatus(role, account, technician),
      searchText: normalize(
        [
          name,
          account?.nome,
          account?.login,
          technician?.phone,
          technician?.address,
          technician?.tags,
        ]
          .filter(Boolean)
          .join(" "),
      ),
    });
  }
  for (const account of accounts) {
    if (account.papel === "tecnico" && techIds.has(account.technician_id))
      linked.set(account.technician_id, account);
    else if (Object.hasOwn(groups, account.papel)) add(account.papel, account);
  }
  for (const technician of technicians)
    add("tecnico", linked.get(technician.id), technician);
  for (const people of Object.values(groups))
    people.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return groups;
}

function PersonRow({ person, onOpen }) {
  const { name, role, account, technician, status } = person;
  return (
    <li className="team-access-row">
      <div className="team-identity">
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <div>
          <strong>{name}</strong>
          <small>
            {account ? "Usuário: " + account.login : "Login ainda não criado"}
          </small>
          {technician && (technician.phone || technician.address) && (
            <small>
              {[technician.phone, technician.address]
                .filter(Boolean)
                .join(" · ")}
            </small>
          )}
        </div>
      </div>
      <span className={"zc-badge " + status.tone}>
        <i aria-hidden="true" />
        {status.text}
      </span>
      <div className="team-row-actions" role="group" aria-label={name}>
        {technician ? (
          <>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpen({ type: "technician", technician })}
            >
              Editar cadastro
            </button>
            {technician.active && (
              <button
                type="button"
                className="secondary-button team-access-action"
                onClick={() => onOpen({ type: "access", person })}
              >
                Acesso ZenField
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onOpen({ type: "account", account, role })}
          >
            {role === "tecnico" ? "Vincular cadastro" : "Editar acesso"}
          </button>
        )}
      </div>
    </li>
  );
}

export default function TeamAccess({ revision, refresh }) {
  const users = useLoad("/users", revision);
  const roster = useLoad("/technicians", revision);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dialog, setDialog] = useState(null);
  const accounts = users.data?.items || [];
  const technicians = roster.data?.items || [];
  const ready = Boolean(users.data && roster.data);
  const error = users.error || roster.error;
  const groups = useMemo(
    () => buildDirectory(users.data?.items || [], roster.data?.items || []),
    [users.data, roster.data],
  );
  const total = Object.values(groups).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const hasFilters = terms.length > 0 || status !== "all";
  const visible = categories
    .filter(({ id }) => category === "all" || category === id)
    .map((group) => ({
      ...group,
      people: groups[group.id].filter(
        ({ searchText, status: access }) =>
          (status === "all" || access.id === status) &&
          terms.every((term) => searchText.includes(term)),
      ),
    }))
    .filter((group) => group.people.length);
  const count = visible.reduce((sum, group) => sum + group.people.length, 0);
  const filters = [{ id: "all", label: "Todas", icon: Users }, ...categories];
  const close = () => setDialog(null);
  function clearFilters() {
    setQuery("");
    setStatus("all");
  }
  function showNew(role) {
    setCategory(role);
    clearFilters();
  }

  return (
    <div className="team-page">
      <Intro
        title="Pessoas e permissões"
        subtitle="Gerencie as contas da central e os cadastros e acessos do ZenField em um só lugar."
      >
        <button
          type="button"
          className="primary-button"
          onClick={() => setDialog({ type: "category" })}
        >
          <Plus size={17} aria-hidden="true" />
          Adicionar pessoa
        </button>
      </Intro>
      <div
        className="team-categories"
        role="group"
        aria-label="Categoria da equipe"
      >
        {filters.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-pressed={category === id}
            onClick={() => setCategory(id)}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
            {ready && <b>{id === "all" ? total : groups[id].length}</b>}
          </button>
        ))}
      </div>
      <div className="team-filters">
        <label className="team-filter-field">
          <span>Buscar pessoa</span>
          <span className="trace-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nome ou usuário"
            />
          </span>
        </label>
        <label className="team-filter-field">
          <span>Status do acesso</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">Todos os status</option>
            <option value="enabled">Habilitado</option>
            <option value="pending">Troca de senha pendente</option>
            <option value="inactive">Inativo ou desativado</option>
            <option value="missing">Sem acesso</option>
            <option value="unlinked">Vínculo pendente</option>
          </select>
        </label>
      </div>
      {error || !ready ? (
        <Loading error={error} />
      ) : (
        <>
          <p className="team-count" role="status">
            {count} {count === 1 ? "pessoa" : "pessoas"}
          </p>
          {visible.length ? (
            <div className="team-groups">
              {visible.map(({ id, label, description, people }) => (
                <section
                  className="dashboard-panel team-group"
                  aria-labelledby={"team-" + id}
                  key={id}
                >
                  <header className="team-group-heading">
                    <h3 id={"team-" + id}>{label}</h3>
                    <p>{description}</p>
                  </header>
                  <ul className="team-people" role="list">
                    {people.map((person) => (
                      <PersonRow
                        key={person.id}
                        person={person}
                        onOpen={setDialog}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <section className="dashboard-panel">
              <Empty
                title={
                  hasFilters
                    ? "Nenhuma pessoa encontrada"
                    : "Nenhum cadastro nesta categoria"
                }
                description={
                  hasFilters
                    ? "Tente outro nome ou ajuste o status do acesso."
                    : "Use Adicionar pessoa para fazer o primeiro cadastro."
                }
              >
                {hasFilters && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={clearFilters}
                  >
                    Limpar filtros
                  </button>
                )}
              </Empty>
            </section>
          )}
        </>
      )}
      {dialog?.type === "category" && (
        <Modal title="Adicionar pessoa" onClose={close}>
          <p className="dialog-description">Escolha o perfil da pessoa.</p>
          <div className="team-profile-options">
            {categories.map(({ id, singular, description, icon: Icon }) => (
              <button
                type="button"
                key={id}
                onClick={() =>
                  setDialog(
                    id === "tecnico"
                      ? { type: "technician" }
                      : { type: "account", role: id },
                  )
                }
              >
                <Icon size={21} aria-hidden="true" />
                <span>
                  <strong>{singular}</strong>
                  <small>{description}</small>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {dialog?.type === "account" && (
        <AccountForm
          account={dialog.account}
          role={dialog.role}
          accounts={accounts}
          technicians={technicians}
          onClose={close}
          onSaved={(role) => {
            if (!dialog.account) showNew(role);
            else if (category !== "all" && role !== dialog.role)
              setCategory(role);
            close();
            refresh();
            notify("Acesso salvo.");
          }}
        />
      )}
      {dialog?.type === "technician" && (
        <TechnicianForm
          technician={dialog.technician}
          onClose={close}
          onSaved={(access) => {
            if (!dialog.technician) showNew("tecnico");
            setDialog(access ? { type: "credentials", access } : null);
            refresh();
            notify("Cadastro do técnico salvo.");
          }}
        />
      )}
      {dialog?.type === "access" && (
        <TechnicianAccess
          person={dialog.person}
          onClose={close}
          onEdit={() =>
            setDialog({
              type: "account",
              role: "tecnico",
              account: dialog.person.account,
            })
          }
          onIssued={(access) => {
            setDialog({ type: "credentials", access });
            refresh();
          }}
        />
      )}
      {dialog?.type === "credentials" && (
        <ActivationDetails access={dialog.access} onClose={close} />
      )}
    </div>
  );
}
