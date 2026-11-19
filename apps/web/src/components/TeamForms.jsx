import { useState } from "react";
import Modal from "@zen/ui/components/Modal";
import { useSession } from "@zen/ui/lib/session";
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
  ["price_visit", "Visita improdutiva (R$)"],
];

export function AccountForm({
  account,
  role,
  accounts,
  technicians,
  onSaved,
  onClose,
}) {
  const requester = useSession();
  const editRecovery =
    requester.papel === "admin" || account?.papel === "tecnico";
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
      description={
        account?.papel === "tecnico"
          ? "Use o e-mail de recuperação para redefinir a senha. A senha temporária é gerada em Acesso ao ZenField."
          : passwordRequirements
      }
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
        ...(editRecovery
          ? [
              {
                name: "recovery_email",
                label: "E-mail de recuperação",
                type: "email",
                autoComplete: "email",
                full: true,
                maxLength: 254,
              },
            ]
          : []),
        ...(account?.papel !== "tecnico"
          ? [
              {
                name: "password",
                ...passwordInputProps,
                title: passwordRequirements,
                label: account ? "Nova senha (opcional)" : "Senha inicial",
                type: "password",
                required: !account,
              },
            ]
          : []),
        { name: "ativo", label: "Acesso habilitado", type: "checkbox" },
      ]}
      onClose={onClose}
      onSave={async (values) => {
        const {
          nome,
          login,
          papel,
          ativo,
          technician_id,
          password,
          recovery_email,
        } = values;
        const payload = {
          nome,
          login,
          papel,
          ativo,
          ...(papel === "tecnico" ? { technician_id } : {}),
          ...(password ? { password } : {}),
          ...(editRecovery ? { recovery_email: recovery_email || "" } : {}),
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
  const base = technician?.operational_base || {};
  const structured = Boolean(base.street);
  const states = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
  return (
    <FormModal
      title={technician ? "Editar cadastro técnico" : "Cadastrar técnico"}
      description={
        technician
          ? "Atualize identificação, base de partida e vínculo de estoque. Tarifas e acordos são administrados no financeiro."
          : "Cadastre os dados de trabalho. O acesso ao ZenField será criado ao salvar."
      }
      wide
      initial={{
        active: true,
        ...technician,
        ...Object.fromEntries(Object.entries(base).map(([k,v]) => ["base_"+k,v??""])),
        base_mode: structured || !technician ? "structured" : "legacy",
        ...(technician &&
          Object.fromEntries(
            rates.map(([key]) => [
              key,
              (Number(technician[key] || 0) / 100).toFixed(2),
            ]),
          )),
      }}
      fields={(values) => [
        { name: "name", label: "Nome", required: true, full: true },
        ...(!technician
          ? [
              {
                name: "recovery_email",
                label: "E-mail de recuperação",
                type: "email",
                maxLength: 254,
                full: true,
              },
            ]
          : []),
        { name: "phone", label: "Telefone com DDI e DDD" },
        { name: "tags", label: "Habilidades" },
        { name: "base_mode", label: "Base de partida para os trajetos", full: true, options: [
          ["structured", "Endereço estruturado"],
          ...(technician && !structured ? [["legacy", "Manter endereço anterior (não validado)"]] : []),
          ["none", "Sem base definida por enquanto"],
        ] },
        ...(values.base_mode === "legacy" ? [
          { name: "address", label: "Endereço anterior (somente leitura)", full: true, disabled: true },
        ] : values.base_mode === "structured" ? [
          { name: "base_cep", label: "CEP", required: true, pattern: "[0-9]{5}-?[0-9]{3}", maxLength: 9 },
          { name: "base_street", label: "Logradouro", required: true, full: true, maxLength: 160 },
          { name: "base_number", label: "Número", required: true, pattern: "[0-9]+[A-Za-z]?", maxLength: 12 },
          { name: "base_complement", label: "Complemento (opcional)", maxLength: 100 },
          { name: "base_district", label: "Bairro", required: true, maxLength: 100 },
          { name: "base_city", label: "Município", required: true, maxLength: 100 },
          { name: "base_state", label: "UF", required: true, options: [["","Selecione"],...states.map(uf=>[uf,uf])] },
          { name: "base_transport", label: "Meio de transporte", options: [["","Não informado"],["car","Automóvel"],["moto","Motocicleta"],["other","Outro"]] },
          { name: "base_radius_km", label: "Raio preferencial (km)", type: "number" },
          { name: "base_municipalities", label: "Municípios atendidos (informativo)", full: true, maxLength: 500 },
        ] : []),
        {
          name: "stock_technician_id",
          label: "Cadastro correspondente no Estoque Pro",
          full: true,
          options: stockOptions,
          disabled: loading || Boolean(error),
        },
        ...(!technician ? rates.map(([name, label]) => ({ name, label, type: "number" })) : []),
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
            ...(!technician ? ["recovery_email"] : []),
            ...(!technician ? rates.map(([key]) => key) : []),
          ]
            .filter((key) => values[key] !== undefined)
            .map((key) => [key, values[key]]),
        );
        if (values.base_mode === "structured") {
          payload.operational_base = Object.fromEntries(
            ["cep","street","number","complement","district","city","state","transport","radius_km","municipalities"].map(k=>[k,values["base_"+k]??""])
          );
        } else if (values.base_mode === "none") {
          payload.address = "";
          payload.operational_base = null;
        }
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
      <p className="dialog-description">O endereço estruturado será usado como ponto de partida estimado. A confirmação geográfica ocorre na consulta de rotas; raio e municípios são informativos, não bloqueiam a operação.</p>
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
  const [email, setEmail] = useState("");
  const action = !account
    ? "Criar acesso e gerar senha"
    : account.ativo
      ? "Gerar nova senha temporária"
      : "Reativar e gerar senha";
  async function issue() {
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(
        "/technicians/" + technician.id + "/activation",
        account ? {} : { recovery_email: email },
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
        {account && (
          <div>
            <dt>E-mail de recuperação</dt>
            <dd>{account.recovery_email || "Ainda não cadastrado"}</dd>
          </div>
        )}
      </dl>
      {!account && (
        <div className="zen-profile-form">
          <label htmlFor="technician-recovery-email">
            E-mail de recuperação (opcional)
          </label>
          <input
            id="technician-recovery-email"
            type="email"
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
      )}
      <p className="dialog-description">
        {!account
          ? "Crie o usuário e a senha temporária para o primeiro acesso."
          : account.ativo
            ? "A nova senha temporária encerra as sessões abertas. O técnico define uma senha definitiva ao entrar."
            : "A conta será reativada com uma senha temporária para o próximo acesso."}
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
          {busy ? "Gerando senha…" : action}
        </button>
      </div>
    </Modal>
  );
}

export function ActivationDetails({ access, onClose }) {
  const [copied, setCopied] = useState("");
  return (
    <Modal title="Primeiro acesso ao ZenField" onClose={onClose}>
      <p className="dialog-description">
        Entregue os dados ao técnico por um canal verificado. A senha temporária
        aparece nesta tela.
      </p>
      <dl className="team-access-details">
        <div>
          <dt>Usuário</dt>
          <dd>{access.login}</dd>
        </div>
        <div>
          <dt>Senha temporária</dt>
          <dd>
            <code>{access.temporary_password}</code>
          </dd>
        </div>
        <div>
          <dt>Válido até</dt>
          <dd>{new Date(access.expires_at).toLocaleString("pt-BR")}</dd>
        </div>
      </dl>
      <p className="dialog-description">
        Entre com estes dados no ZenTracking ou ZenField. A próxima tela pede a
        senha definitiva.
      </p>
      {copied && (
        <p className="dialog-description" role="status">
          {copied}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                "Usuário: " +
                  access.login +
                  "\nSenha temporária: " +
                  access.temporary_password,
              );
              setCopied("Dados copiados.");
            } catch {
              setCopied("Selecione o usuário e a senha acima para copiá-los.");
            }
          }}
        >
          Copiar dados
        </button>
        <button type="button" className="primary-button" onClick={onClose}>
          Concluir
        </button>
      </div>
    </Modal>
  );
}
