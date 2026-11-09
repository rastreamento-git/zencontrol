import { useState } from "react";
import Modal from "@zen/ui/components/Modal";
import {
  passwordInputProps,
  passwordRequirements,
} from "@zen/ui/lib/password-policy";
import { api, errorMessage, FormModal, useLoad } from "./common";

const roles = [
  ["operador", "Operador"],
  ["admin", "Administrador"],
  ["tecnico", "Técnico"],
];
const rates = [
  ["price_install", "Instalação (R$)"],
  ["price_maintenance", "Manutenção (R$)"],
  ["price_removal", "Retirada (R$)"],
  ["price_visit", "Visita / improdutiva (R$)"],
];

export function AccountForm({
  account,
  role,
  accounts,
  technicians,
  onSaved,
  onClose,
}) {
  const otherLinks = new Set(
    accounts
      .filter((user) => user.id !== account?.id && user.papel === "tecnico")
      .map((user) => user.technician_id),
  );
  const availableTechnicians = technicians.filter(
    (technician) => technician.active && !otherLinks.has(technician.id),
  );
  return (
    <FormModal
      title={
        account
          ? "Editar acesso"
          : role === "admin"
            ? "Novo administrador"
            : "Novo operador"
      }
      description={passwordRequirements}
      initial={{ ativo: true, papel: role, ...account }}
      fields={({ papel }) => [
        { name: "nome", label: "Nome de exibição", required: true },
        { name: "login", label: "Usuário", required: true },
        ...(account
          ? [{ name: "papel", label: "Perfil de acesso", options: roles }]
          : []),
        ...(papel === "tecnico"
          ? [
              {
                name: "technician_id",
                label: "Cadastro técnico vinculado",
                full: true,
                required: true,
                options: [
                  [
                    "",
                    availableTechnicians.length
                      ? "Selecione o técnico"
                      : "Nenhum cadastro ativo disponível",
                  ],
                  ...availableTechnicians.map((t) => [t.id, t.name]),
                ],
              },
            ]
          : []),
        {
          name: "password",
          ...passwordInputProps,
          title: passwordRequirements,
          label: account ? "Nova senha (opcional)" : "Senha inicial",
          type: "password",
          required: !account,
        },
        { name: "ativo", label: "Acesso habilitado", type: "checkbox" },
      ]}
      onClose={onClose}
      onSave={async (values) => {
        const { nome, login, papel, ativo, technician_id, password } = values;
        const payload = {
          nome,
          login,
          papel,
          ativo,
          ...(papel === "tecnico" ? { technician_id } : {}),
          ...(password ? { password } : {}),
        };
        if (account) await api.patch("/users/" + account.id, payload);
        else await api.post("/users", payload);
        onSaved(papel);
      }}
    />
  );
}

export function TechnicianForm({ technician, onSaved, onClose }) {
  const { data: catalog, loading, error } = useLoad("/stock/catalog");
  const stockTechnicians = catalog?.technicians || [];
  const currentStockId = technician?.stock_technician_id;
  const stockOptions = [
    ["", "Sem vínculo"],
    ...stockTechnicians.map((t) => [t.id, t.nome]),
    ...(currentStockId != null &&
    !stockTechnicians.some((t) => t.id === currentStockId)
      ? [[currentStockId, "Vínculo atual"]]
      : []),
  ];
  return (
    <FormModal
      title={technician ? "Editar cadastro técnico" : "Cadastrar técnico"}
      description={
        technician
          ? "Atualize os contatos, a região e os valores de atendimento."
          : "Ao salvar, você recebe os dados de primeiro acesso ao ZenField."
      }
      wide
      initial={{
        active: true,
        ...technician,
        ...(technician &&
          Object.fromEntries(
            rates.map(([key]) => [
              key,
              (Number(technician[key] || 0) / 100).toFixed(2),
            ]),
          )),
      }}
      fields={[
        { name: "name", label: "Nome", required: true, full: true },
        { name: "phone", label: "Telefone com DDI e DDD" },
        { name: "tags", label: "Habilidades" },
        { name: "address", label: "Endereço / região base", full: true },
        {
          name: "stock_technician_id",
          label: "Cadastro correspondente no Estoque Pro",
          full: true,
          options: stockOptions,
          disabled: loading || Boolean(error),
        },
        ...rates.map(([name, label]) => ({ name, label, type: "number" })),
        ...(technician
          ? [
              {
                name: "active",
                label: "Cadastro técnico ativo",
                type: "checkbox",
              },
            ]
          : []),
      ]}
      onClose={onClose}
      onSave={async (values) => {
        const payload = Object.fromEntries(
          [
            "name",
            "phone",
            "stock_technician_id",
            "tags",
            "address",
            ...rates.map(([key]) => key),
          ]
            .filter((key) => values[key] !== undefined)
            .map((key) => [key, values[key]]),
        );
        // Sending an unchanged active flag would revoke or re-enable the linked account.
        if (!technician || values.active !== technician.active)
          payload.active = values.active;
        const { data } = technician
          ? await api.patch("/technicians/" + technician.id, {
              ...payload,
              version: technician.version,
            })
          : await api.post("/technicians", payload);
        onSaved(data.access);
      }}
    >
      {error && (
        <p className="dialog-description">
          O Estoque Pro está indisponível. Você pode salvar os outros dados; o
          vínculo atual será mantido.
        </p>
      )}
    </FormModal>
  );
}

export function TechnicianAccess({ person, onClose, onEdit, onIssued }) {
  const { account, name, technician, status } = person;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = !account
    ? "Gerar código de acesso"
    : account.ativo
      ? "Reemitir código"
      : "Reativar e gerar código";
  async function issue() {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(
        "/technicians/" + technician.id + "/activation",
      );
      onIssued(data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Acesso ao ZenField" onClose={onClose} busy={busy}>
      <p className="dialog-description">{name}</p>
      <dl className="team-access-details">
        <div>
          <dt>Usuário</dt>
          <dd>{account?.login || "Ainda não criado"}</dd>
        </div>
        <div>
          <dt>Status do acesso</dt>
          <dd>{status.text}</dd>
        </div>
      </dl>
      <p className="dialog-description">
        {!account
          ? "Gere um login individual e um código para o primeiro acesso."
          : account.ativo
            ? "Reemitir o código encerra as sessões abertas. O técnico precisará ativar o acesso novamente."
            : "A conta será reativada e o técnico receberá um novo código de ativação."}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {account && (
          <button
            type="button"
            className="secondary-button"
            onClick={onEdit}
            disabled={busy}
          >
            Editar acesso
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          onClick={issue}
          disabled={busy}
        >
          {busy ? "Gerando código…" : action}
        </button>
      </div>
    </Modal>
  );
}

export function ActivationDetails({ access, onClose }) {
  return (
    <Modal title="Dados de ativação do ZenField" onClose={onClose}>
      <p className="dialog-description">
        Entregue estes dados ao técnico por um canal verificado. O código só é
        mostrado nesta emissão.
      </p>
      <dl className="team-access-details">
        <div>
          <dt>Usuário</dt>
          <dd>{access.login}</dd>
        </div>
        <div>
          <dt>Senha provisória</dt>
          <dd>{access.temporary_password}</dd>
        </div>
        <div>
          <dt>Código de uso único</dt>
          <dd>
            <code>{access.code}</code>
          </dd>
        </div>
        <div>
          <dt>Válido até</dt>
          <dd>{new Date(access.expires_at).toLocaleString("pt-BR")}</dd>
        </div>
      </dl>
      <p className="dialog-description">
        No ZenTracking ou no ZenField, selecione{" "}
        <strong>Primeiro acesso ou redefinição</strong> para definir a senha
        definitiva. {passwordRequirements}
      </p>
      <div className="dialog-actions">
        <button type="button" className="primary-button" onClick={onClose}>
          Concluir
        </button>
      </div>
    </Modal>
  );
}
