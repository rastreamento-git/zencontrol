import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Maximize2,
  MessageCircle,
  Minimize2,
  Search,
  Send,
  Users,
  X,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useChatStream } from "../lib/chat-stream";
import { presenceLabels, useChatPresence } from "../lib/chat-presence";
import PersonAvatar, { roleLabels } from "./PersonAvatar";

const teamThread = { id: "equipe", name: "Sala da operação" };
function Presence({ status }) {
  const value = presenceLabels[status] ? status : "offline";
  return (
    <span className="zen-person-status" data-status={value}>
      {presenceLabels[value]}
    </span>
  );
}

const stamp = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
function mergeMessages(current, incoming) {
  const values = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) values.set(m.id, m);
  return [...values.values()].sort((a, b) =>
    BigInt(a.id) < BigInt(b.id) ? -1 : 1,
  );
}
function Conversation({ thread, revision, staff, onBack, mode }) {
  const user = useSession(),
    composer = useId();
  const scroll = useRef(null),
    pinned = useRef(true),
    olderLoaded = useRef(false);
  const request = useRef(null),
    alive = useRef(true);
  const [messages, setMessages] = useState([]),
    [loading, setLoading] = useState(true);
  const [older, setOlder] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false);
  const [readError, setReadError] = useState(""),
    [sendError, setSendError] = useState("");
  const route = "/chat/threads/" + thread.id + "/messages";
  const team = thread.id === teamThread.id;
  const open = mode !== "closed";
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    api
      .get(route, { signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setMessages((old) => mergeMessages(old, data.items));
        if (!olderLoaded.current) setOlder(data.has_older);
        setReadError("");
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setReadError(errorMessage(e));
        if ([401, 403, 404].includes(e.response?.status)) setMessages([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, route, revision]);
  useEffect(() => {
    const list = scroll.current;
    if (mode !== "closed" && list && pinned.current)
      list.scrollTop = list.scrollHeight;
  }, [messages, mode]);
  async function loadOlder() {
    if (loadingOlder || !messages[0]) return;
    setLoadingOlder(true);
    const list = scroll.current,
      oldHeight = list?.scrollHeight || 0,
      oldTop = list?.scrollTop || 0;
    try {
      const { data } = await api.get(route, {
        params: { before: messages[0].id },
      });
      if (!alive.current) return;
      pinned.current = false;
      olderLoaded.current = true;
      setMessages((old) => mergeMessages(old, data.items));
      setOlder(data.has_older);
      requestAnimationFrame(() => {
        if (scroll.current === list && list)
          list.scrollTop = oldTop + list.scrollHeight - oldHeight;
      });
    } catch (e) {
      if (alive.current) setReadError(errorMessage(e));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }
  async function send(e) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    if (request.current?.body !== body)
      request.current = { body, request_id: crypto.randomUUID() };
    setSending(true);
    setSendError("");
    try {
      const { data } = await api.post(route, request.current);
      if (!alive.current) return;
      pinned.current = true;
      setMessages((old) => mergeMessages(old, [data.message]));
      setDraft("");
      request.current = null;
    } catch (e) {
      if (alive.current) setSendError(errorMessage(e));
    } finally {
      if (alive.current) setSending(false);
    }
  }
  return (
    <section
      className="zen-chat-conversation"
      aria-label={staff ? thread.name : "Conversa com a central"}
    >
      <div className="zen-chat-person">
        {onBack && (
          <button
            type="button"
            className="icon-button zen-chat-back"
            aria-label="Voltar às conversas"
            onClick={onBack}
          >
            <ArrowLeft size={19} />
          </button>
        )}
        {staff && !team ? (
          <PersonAvatar
            name={thread.name}
            userId={thread.user_id}
            version={thread.avatar_version}
          />
        ) : (
          <span className="zen-person-avatar" aria-hidden="true">
            <Users size={21} />
          </span>
        )}
        <div>
          <h3>{staff ? thread.name : "Central de operações"}</h3>
          {staff && !team ? (
            <Presence status={thread.status} />
          ) : (
            <small>
              {team
                ? "Operadores e administradores"
                : "Caixa compartilhada por operadores e administradores"}
            </small>
          )}
        </div>
      </div>
      {readError && (
        <p role="alert" className="error-banner">
          {readError}
        </p>
      )}
      <div
        ref={scroll}
        className="zen-chat-scroll"
        onScroll={(e) => {
          const node = e.currentTarget;
          pinned.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 60;
        }}
      >
        {older && (
          <button
            type="button"
            className="secondary-button zen-chat-older"
            onClick={loadOlder}
            disabled={loadingOlder}
          >
            Carregar mensagens anteriores
          </button>
        )}
        {loading && (
          <p role="status" className="zen-chat-empty">
            Carregando conversa…
          </p>
        )}
        {!loading && !messages.length && !readError && (
          <p className="zen-chat-empty">
            Nenhuma mensagem ainda. Escreva abaixo para começar.
          </p>
        )}
        <ol
          className="zen-chat-messages"
          role="log"
          aria-label="Histórico de mensagens"
          aria-live="polite"
        >
          {messages.map((m) => (
            <li
              key={m.id}
              className={m.sender_user_id === user.id ? "is-mine" : ""}
            >
              <div className="zen-chat-message-meta">
                <PersonAvatar
                  name={m.sender_name}
                  userId={m.sender_user_id}
                  version={m.sender_avatar_version}
                />
                <div className="zen-chat-message-author">
                  <strong>
                    {m.sender_name}
                    {m.sender_user_id === user.id ? " (você)" : ""}
                  </strong>
                  <small>{roleLabels[m.sender_role]}</small>
                </div>
                <time dateTime={m.created_at}>
                  {stamp.format(new Date(m.created_at))}
                </time>
              </div>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <form onSubmit={send} className="zen-chat-compose">
        {sendError && (
          <p role="alert" className="error-banner">
            {sendError}
          </p>
        )}
        <label htmlFor={composer}>Mensagem</label>
        <div>
          <textarea
            id={composer}
            rows={2}
            maxLength={2000}
            value={draft}
            disabled={sending}
            placeholder={
              team
                ? "Escreva para a equipe…"
                : staff
                  ? "Escreva para o técnico…"
                  : "Escreva para a central…"
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                e.currentTarget.form.requestSubmit();
              }
            }}
          />
          <button
            type="submit"
            className="primary-button"
            disabled={sending || !draft.trim()}
          >
            <Send size={17} /> Enviar
          </button>
        </div>
      </form>
    </section>
  );
}

export default function Chat({ mode, onModeChange, targetThread, onNotice }) {
  const user = useSession(),
    staff = user.papel !== "tecnico";
  const id = useId(),
    windowRef = useRef(null),
    launcher = useRef(null);
  const open = mode !== "closed",
    compact = mode === "mini";
  const sizeLabel = compact
    ? "Abrir chat em tela cheia"
    : "Voltar ao mini chat";
  const [items, setItems] = useState(null),
    [selected, setSelected] = useState(null),
    [people, setPeople] = useState(null),
    [section, setSection] = useState("inbox");
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useChatPresence(user.id);
  const live = useChatStream((reason) => {
    if (open) setRevision((n) => n + 1);
    if (staff && reason !== "change") onNotice?.(reason === "notice");
  }, staff || open);
  const activeThread =
    items?.find((item) => item.id === selected?.id) || selected;
  function showSection(next) {
    if (next === section) return;
    setSection(next);
    setSelected(null);
    setError("");
  }
  useEffect(() => {
    if (!targetThread) return;
    setSection("inbox");
    setQuery("");
    setSelected(targetThread);
  }, [targetThread]);
  useLayoutEffect(() => {
    const panel = windowRef.current;
    const hadFocus = panel.contains(document.activeElement);
    // Change modality without remounting the conversation or its composer.
    if (panel.open) panel.close();
    if (mode === "full") panel.showModal();
    else if (mode === "mini") panel.show();
    else if (hadFocus && document.activeElement === document.body)
      launcher.current.focus();
  }, [mode]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        const team = section === "team";
        api
          .get(team ? "/chat/team" : "/chat/threads", {
            signal: controller.signal,
            params: team ? undefined : { q: query },
          })
          .then(({ data }) => {
            if (controller.signal.aborted) return;
            if (team) setPeople(data.items);
            else setItems(data.items);
            setError("");
            if (!staff) setSelected(data.items[0] || null);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorMessage(e));
          });
      },
      section === "inbox" && query ? 230 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, revision, section, staff]);
  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="primary-button zen-chat-launcher"
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={open}
        hidden={open}
        onClick={() => onModeChange("mini")}
      >
        <MessageCircle size={19} aria-hidden="true" /> Mini chat
      </button>
      <dialog
        ref={windowRef}
        id={id}
        className={"zen-chat-window " + (compact ? "is-mini" : "is-full")}
        aria-labelledby={id + "-title"}
        onCancel={(e) => {
          e.preventDefault();
          onModeChange("closed");
        }}
        onKeyDown={(e) => {
          if (compact && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onModeChange("closed");
          }
        }}
      >
        <div className="zen-chat">
          <header className="zen-chat-heading">
            <div className="zen-chat-title">
              <span className="zen-profile-avatar" aria-hidden="true">
                <MessageCircle size={21} />
              </span>
              <div>
                <h2 id={id + "-title"}>
                  {staff ? "Conversas da operação" : "Chat com a central"}
                </h2>
                <span
                  className={"zen-chat-status " + (live ? "is-live" : "")}
                  role="status"
                >
                  {live ? "Em tempo real" : "Atualizando conversa"}
                </span>
              </div>
            </div>
            <div className="zen-chat-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={sizeLabel}
                title={sizeLabel}
                onClick={() => onModeChange(compact ? "full" : "mini")}
              >
                {compact ? <Maximize2 size={19} /> : <Minimize2 size={19} />}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Fechar chat"
                title="Fechar chat"
                onClick={() => onModeChange("closed")}
              >
                <X size={21} />
              </button>
            </div>
          </header>
          <div className="zen-chat-preferences">
            <label>
              Meu status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="online">Online</option>
                <option value="away">Ausente</option>
                <option value="busy">Ocupado</option>
              </select>
            </label>
          </div>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div
            className={
              "zen-chat-layout " +
              (staff ? "is-staff " : "") +
              (activeThread ? "has-thread" : "")
            }
          >
            {staff && (
              <aside
                className="zen-chat-threads"
                aria-label="Lista de conversas"
              >
                <nav className="zen-chat-sections" aria-label="Seções do chat">
                  <button
                    type="button"
                    aria-pressed={section === "inbox"}
                    onClick={() => showSection("inbox")}
                  >
                    Caixa da operação
                  </button>
                  <button
                    type="button"
                    aria-pressed={section === "team"}
                    onClick={() => showSection("team")}
                  >
                    Equipe interna
                  </button>
                </nav>
                {section === "team" ? (
                  <>
                    <button
                      type="button"
                      className="zen-chat-thread"
                      onClick={() => setSelected(teamThread)}
                      aria-current={
                        activeThread?.id === teamThread.id ? "true" : undefined
                      }
                    >
                      <span className="zen-person-avatar" aria-hidden="true">
                        <Users size={18} />
                      </span>
                      <strong>{teamThread.name}</strong>
                    </button>
                    <h3 className="zen-chat-roster-title">Colaboradores</h3>
                    {!people && !error && (
                      <p role="status">Carregando equipe…</p>
                    )}
                    <ul className="zen-chat-roster">
                      {people?.map((person) => (
                        <li key={person.id} className="zen-chat-thread">
                          <PersonAvatar
                            name={person.name}
                            userId={person.id}
                            version={person.avatar_version}
                          />
                          <span className="zen-chat-thread-name">
                            <strong>{person.name}</strong>
                            <small>{roleLabels[person.role]}</small>
                            <Presence status={person.status} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <label className="zen-chat-search">
                      <Search size={17} />
                      <input
                        type="search"
                        aria-label="Buscar técnico nas conversas"
                        placeholder="Buscar técnico ou empresa"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    {!items && !error && (
                      <p role="status">Carregando técnicos…</p>
                    )}
                    {items?.length === 0 && <p>Nenhum técnico encontrado.</p>}
                    {items?.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        aria-current={
                          activeThread?.id === t.id ? "true" : undefined
                        }
                        className="zen-chat-thread"
                        disabled={t.user_id === null}
                        onClick={() => setSelected(t)}
                      >
                        <PersonAvatar
                          name={t.name}
                          userId={t.user_id}
                          version={t.avatar_version}
                        />
                        <span className="zen-chat-thread-name">
                          <strong>{t.name}</strong>
                          <Presence status={t.status} />
                          <small>
                            {t.user_id === null
                              ? "Sem acesso ao chat"
                              : t.preview || "Sem mensagens"}
                          </small>
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </aside>
            )}
            {activeThread ? (
              <Conversation
                key={activeThread.id}
                thread={activeThread}
                revision={revision}
                staff={staff}
                onBack={staff ? () => setSelected(null) : undefined}
                mode={mode}
              />
            ) : (
              <div className="zen-chat-placeholder">
                <MessageCircle size={28} />
                <p>
                  {staff
                    ? section === "team"
                      ? "Abra a sala para conversar com a equipe."
                      : "Selecione um técnico para abrir a conversa."
                    : "Abrindo conversa…"}
                </p>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
