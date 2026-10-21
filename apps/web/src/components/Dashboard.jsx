import {
  Plus,
  CalendarDays,
  ArrowUpRight,
  ClipboardList,
  Users,
  ArrowRight,
  CheckCheck,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Panel, Loading, useLoad, Badge, format, initials } from "./common";
export default function Dashboard({
  overview: data,
  meta,
  revision,
  navigate,
  openOrder,
}) {
  const { data: orders, loading, error } = useLoad("/orders?limit=6", revision);
  const open = Object.entries(data.statuses)
    .filter(([s]) => !["CONCLUÍDO", "CANCELADO"].includes(s))
    .reduce((a, [, n]) => a + n, 0);
  const stats = [
    ["Atendimentos hoje", data.totals.today, "Agendados para hoje", "blue"],
    ["Ordens em aberto", open, "Atendimentos em andamento", "violet"],
    [
      "Serviços concluídos",
      data.statuses["CONCLUÍDO"] || 0,
      "Conferidos na operação",
      "mint",
    ],
    [
      "Precisam de atenção",
      data.totals.overdue,
      "Agendamentos em atraso",
      "amber",
    ],
  ];
  const chart = meta.statuses.map((s) => ({
    name:
      s === "AGUARDANDO VALIDAÇÃO"
        ? "Validação"
        : s[0] + s.slice(1).toLowerCase(),
    total: data.statuses[s] || 0,
  }));
  return (
    <div className="dashboard-view">
      <div className="dashboard-intro">
        <div>
          <span className="eyebrow">PAINEL DE CONTROLE</span>
          <h2>Uma visão clara dos atendimentos.</h2>
          <p>Agendamentos, equipe técnica e conclusão em um só lugar.</p>
        </div>
        <button className="primary-button" onClick={() => openOrder()}>
          <Plus size={17} />
          Nova ordem de serviço
        </button>
      </div>
      <section className="zen-priorities" aria-label="Ações prioritárias">
        <button className="zen-priority" onClick={() => navigate("batches")}>
          <CheckCheck size={23} />
          <div>
            <strong>
              {data.validations
                ? `${data.validations} retorno(s) para conferir`
                : "Conferências em dia"}
            </strong>
            <span>
              {data.validations
                ? "Abra as evidências e dê sequência à conclusão."
                : "Acompanhe os próximos envios dos técnicos."}
            </span>
          </div>
          <ArrowRight size={18} />
        </button>
        <button className="zen-priority" onClick={() => navigate("agenda")}>
          <CalendarDays size={23} />
          <div>
            <strong>Agenda da equipe</strong>
            <span>
              {data.totals.today || 0} atendimento(s) previsto(s) para hoje.
            </span>
          </div>
          <ArrowRight size={18} />
        </button>
      </section>
      <div className="stat-grid">
        {stats.map(([label, value, caption, color]) => (
          <article className={"stat-card " + color} key={label}>
            <div className="stat-card-top">
              <span>{label}</span>
              <span className="stat-icon">
                <ArrowUpRight size={18} />
              </span>
            </div>
            <strong className="stat-value">{value || 0}</strong>
            <span className="stat-caption">{caption}</span>
          </article>
        ))}
      </div>
      <div className="dashboard-columns">
        <Panel
          title="Situação dos atendimentos"
          subtitle={`${data.totals.total} ordens registradas em todas as bases`}
          className="chart-panel"
        >
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={chart}
                margin={{ left: -20, right: 15, top: 15, bottom: 8 }}
              >
                <CartesianGrid
                  vertical={false}
                  strokeDasharray="3 3"
                  stroke="var(--ep-line)"
                />
                <XAxis
                  dataKey="name"
                  fontSize={10}
                  tick={{ fill: "var(--ep-muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  fontSize={11}
                  tick={{ fill: "var(--ep-muted)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--ep-surface)",
                    borderColor: "var(--ep-line)",
                    borderRadius: 10,
                    color: "var(--ep-text)",
                  }}
                  labelStyle={{ color: "var(--ep-text)" }}
                  cursor={{ fill: "var(--ep-soft)" }}
                />
                <Bar
                  dataKey="total"
                  name="Ordens"
                  fill="#2563eb"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={35}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel
          title="Equipe em campo"
          subtitle="Atendimentos em aberto por técnico"
        >
          <div className="zc-team-list">
            {data.technicians.length ? (
              data.technicians.slice(0, 5).map((t) => (
                <div className="zc-team" key={t.id}>
                  <span className="avatar">{initials(t.name)}</span>
                  <div>
                    <strong>{t.name}</strong>
                    <small>Técnico cadastrado</small>
                  </div>
                  <span className="zc-counter">{t.open_orders} OS</span>
                </div>
              ))
            ) : (
              <p className="zc-muted">
                Cadastre os técnicos para organizar os atendimentos.
              </p>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="Últimos atendimentos"
        subtitle="Ordens atualizadas mais recentemente"
        action={
          <button className="zc-link" onClick={() => navigate("orders")}>
            Ver todas <ArrowRight size={14} />
          </button>
        }
      >
        {loading || error ? (
          <Loading error={error} />
        ) : (
          <div className="zc-table-scroll">
            <table className="zc-table zc-responsive-table">
              <thead>
                <tr>
                  <th>ORDEM / ASSOCIADO</th>
                  <th>VEÍCULO</th>
                  <th>AGENDAMENTO</th>
                  <th>SITUAÇÃO</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.items.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Ordem / associado">
                      <button
                        className="zc-link zc-mono"
                        onClick={() => openOrder(o.id)}
                      >
                        {o.id}
                      </button>
                      <small>
                        {o.customer_name || "Associado não informado"}
                      </small>
                    </td>
                    <td data-label="Veículo">
                      <span className="zc-plate">
                        {o.vehicle || "Sem identificação"}
                      </span>
                    </td>
                    <td data-label="Agendamento / técnico">
                      <strong>{format(o.scheduled_at, true)}</strong>
                      <small>{o.technician_name || "Sem técnico"}</small>
                    </td>
                    <td data-label="Situação">
                      <Badge value={o.status} />
                    </td>
                    <td data-label="Ações">
                      <button
                        className="icon-button"
                        aria-label={"Abrir " + o.id}
                        onClick={() => openOrder(o.id)}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!orders.items.length && (
              <p className="zc-table-empty">As novas ordens aparecerão aqui.</p>
            )}
          </div>
        )}
      </Panel>
      <div className="zc-quick-grid">
        {[
          [
            "orders",
            "Cadastrar um atendimento",
            "Crie uma OS e escolha o responsável",
            ClipboardList,
          ],
          [
            "agenda",
            "Organizar a agenda",
            "Confira os próximos horários",
            CalendarDays,
          ],
          [
            "batches",
            "Conferir retornos",
            "Fotos e evidências dos técnicos",
            CheckCheck,
          ],
        ].map(([id, title, description, Icon]) => (
          <button
            key={id}
            onClick={() => (id === "orders" ? openOrder() : navigate(id))}
          >
            <span className="quick-action-icon">
              <Icon size={21} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}
