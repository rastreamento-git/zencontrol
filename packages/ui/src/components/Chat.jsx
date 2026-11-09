import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Search, Send } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { useChatStream } from "../lib/chat-stream";

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
function Conversation({ thread, revision, staff, onBack }) {
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
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
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
  }, [route, revision]);
  useEffect(() => {
    const list = scroll.current;
    if (list && pinned.current) list.scrollTop = list.scrollHeight;
  }, [messages]);
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
      aria-label={
        staff ? "Conversa com " + thread.name : "Conversa com a central"
      }
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
        <span className="zen-profile-avatar">
          <MessageCircle size={21} />
        </span>
        <div>
          <h3>{staff ? thread.name : "Central de operações"}</h3>
          <small>
            {staff
              ? "Respondendo como " + user.nome
              : "Operadores e administradores podem responder"}
          </small>
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
              <div>
                <strong>
                  {m.sender_user_id === user.id ? "Você" : m.sender_name}
                </strong>
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
              staff ? "Escreva para o técnico…" : "Escreva para a central…"
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

export default function Chat() {
  const user = useSession(),
    staff = user.papel !== "tecnico";
  const [items, setItems] = useState(null),
    [selected, setSelected] = useState(null);
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const live = useChatStream(() => setRevision((n) => n + 1));
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        api
          .get("/chat/threads", {
            signal: controller.signal,
            params: { q: query },
          })
          .then(({ data }) => {
            if (controller.signal.aborted) return;
            setItems(data.items);
            setError("");
            if (!staff) setSelected(data.items[0] || null);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorMessage(e));
          });
      },
      query ? 230 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, staff]);
  return (
    <section className="zen-chat" aria-label="Conversas">
      <div className="zen-chat-heading">
        <div>
          <h2>{staff ? "Conversas com técnicos" : "Chat com a central"}</h2>
          <p>
            {staff
              ? "Acompanhe as dúvidas e responda à equipe em campo."
              : "Fale com a equipe de operação durante seu atendimento."}
          </p>
        </div>
        <span
          className={"zen-chat-status " + (live ? "is-live" : "")}
          role="status"
        >
          {live ? "Em tempo real" : "Atualizando conversa"}
        </span>
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
          (selected ? "has-thread" : "")
        }
      >
        {staff && (
          <aside className="zen-chat-threads" aria-label="Lista de conversas">
            <label className="zen-chat-search">
              <Search size={17} />
              <input
                type="search"
                aria-label="Buscar técnico nas conversas"
                placeholder="Buscar técnico"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {!items && !error && <p role="status">Carregando técnicos…</p>}
            {items?.length === 0 && <p>Nenhum técnico encontrado.</p>}
            {items?.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={selected?.id === t.id ? "true" : undefined}
                className={selected?.id === t.id ? "is-selected" : ""}
                onClick={() => setSelected(t)}
              >
                <MessageCircle size={17} />
                <span>
                  <strong>{t.name}</strong>
                  <small>{t.preview || "Sem mensagens"}</small>
                </span>
              </button>
            ))}
          </aside>
        )}
        {selected ? (
          <Conversation
            key={selected.id}
            thread={selected}
            revision={revision}
            staff={staff}
            onBack={staff ? () => setSelected(null) : undefined}
          />
        ) : (
          <div className="zen-chat-placeholder">
            <MessageCircle size={28} />
            <p>
              {staff
                ? "Selecione um técnico para abrir a conversa."
                : "Abrindo conversa…"}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
