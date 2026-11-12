import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Image as ImageIcon,
  Maximize2,
  MessageCircle,
  Minimize2,
  Paperclip,
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
import {
  ChatCamera,
  ChatMessagePhoto,
  chatPhotoAccept,
  chatPhotoContentType,
  maxChatPhotos,
  prepareChatPhoto,
} from "./ChatPhotos";

const teamThread = { id: "equipe", name: "Sala da operação" };
const outdatedChat =
  "A API do ZenControl deste ambiente precisa ser atualizada para carregar o chat.";

function chatError(error) {
  if (
    error.response?.status === 404 &&
    error.response.data?.error === "Rota não encontrada."
  )
    return outdatedChat;
  return errorMessage(error);
}

function ChatLoadError({ message, onRetry }) {
  return (
    <div className="error-banner zen-chat-error" role="alert">
      <p>{message}</p>
      <button type="button" className="secondary-button" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

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
function Conversation({
  thread,
  revision,
  staff,
  onBack,
  mode,
  photosEnabled,
}) {
  const user = useSession(),
    composer = useId();
  const scroll = useRef(null),
    pinned = useRef(true),
    olderLoaded = useRef(false);
  const request = useRef(null),
    alive = useRef(true);
  const draftInput = useRef(null);
  const attachmentInput = useRef(null);
  const cameraInput = useRef(null);
  const [messages, setMessages] = useState([]),
    [loading, setLoading] = useState(true);
  const [older, setOlder] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [preparing, setPreparing] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [camera, setCamera] = useState(false);
  const [readError, setReadError] = useState(""),
    [sendError, setSendError] = useState(""),
    [retry, setRetry] = useState(0);
  const route = "/chat/threads/" + thread.id + "/messages";
  const team = thread.id === teamThread.id;
  const open = mode !== "closed";
  const blocked = sending || loading || Boolean(readError);
  const canAttach =
    photosEnabled && !blocked && !preparing && photos.length < maxChatPhotos;
  const canSend =
    !blocked &&
    !preparing &&
    (!photos.length || photosEnabled) &&
    Boolean(draft.trim() || photos.length);
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
        setReadError(chatError(e));
        if ([401, 403, 404].includes(e.response?.status)) setMessages([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, route, revision, retry]);
  useEffect(() => {
    const list = scroll.current;
    if (mode !== "closed" && list && pinned.current)
      list.scrollTop = list.scrollHeight;
  }, [messages, mode]);
  useLayoutEffect(() => {
    const input = draftInput.current;
    if (!input || !open) return;
    input.style.height = "0px";
    input.style.height = Math.min(input.scrollHeight, 112) + "px";
  }, [draft, mode, open]);
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
      if (alive.current) setReadError(chatError(e));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }
  async function addFiles(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length || !canAttach) return;
    setPreparing(true);
    setPhotoError("");
    const remaining = maxChatPhotos - photos.length;
    let error =
      selected.length > remaining
        ? "O limite é de quatro fotos por mensagem."
        : "";
    const added = [];
    for (const file of selected.slice(0, remaining)) {
      try {
        added.push(await prepareChatPhoto(file));
      } catch (cause) {
        error = cause.message || "Não foi possível preparar a foto.";
      }
    }
    if (!alive.current) return;
    setPhotos((current) => [...current, ...added]);
    setPhotoError(error);
    setPreparing(false);
  }

  function openCamera() {
    if (navigator.mediaDevices?.getUserMedia) setCamera(true);
    else cameraInput.current.click();
  }

  async function send(e) {
    e.preventDefault();
    if (!canSend) return;
    const body = draft.trim();
    if (request.current?.body !== body || request.current.photos !== photos)
      request.current = { body, photos, request_id: crypto.randomUUID() };
    const payload = { body, request_id: request.current.request_id };
    if (photos.length) payload.photos = photos.map((photo) => photo.data);
    setSending(true);
    setSendError("");
    try {
      const { data } = await api.post(
        route,
        payload,
        photos.length
          ? { headers: { "Content-Type": chatPhotoContentType } }
          : undefined,
      );
      if (!alive.current) return;
      pinned.current = true;
      setMessages((old) => mergeMessages(old, [data.message]));
      setDraft("");
      setPhotos([]);
      setPhotoError("");
      request.current = null;
    } catch (e) {
      if (alive.current) setSendError(chatError(e));
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
            aria-label="Voltar aos técnicos"
            title="Voltar aos técnicos"
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
        <ChatLoadError
          message={readError}
          onRetry={() => setRetry((n) => n + 1)}
        />
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
          <div className="zen-chat-empty">
            <MessageCircle size={26} aria-hidden="true" />
            <strong>Comece a conversa</strong>
            <p>
              {photosEnabled
                ? "Escreva uma mensagem ou compartilhe uma foto."
                : "Escreva uma mensagem para começar."}
            </p>
          </div>
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
              className={
                (m.sender_user_id === user.id ? "is-mine " : "") +
                (m.photo_count > 0 ? "has-photos" : "")
              }
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
              {m.body && <p>{m.body}</p>}
              {m.photo_count > 0 && (
                <div
                  className={
                    "zen-chat-photo-grid" +
                    (m.photo_count === 1 ? " is-single" : "")
                  }
                >
                  {Array.from({ length: m.photo_count }, (_, index) => (
                    <ChatMessagePhoto
                      key={index}
                      path={route + "/" + m.id + "/photos/" + (index + 1)}
                      author={m.sender_name}
                      position={index + 1}
                      open={open}
                    />
                  ))}
                </div>
              )}
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
        {photoError && (
          <p role="alert" className="error-banner">
            {photoError}
          </p>
        )}
        <label className="zen-chat-sr-only" htmlFor={composer}>
          Mensagem
        </label>
        <div className="zen-chat-compose-box">
          {photos.length > 0 && (
            <div className="zen-chat-photo-drafts" aria-label="Fotos a enviar">
              {photos.map((photo) => (
                <div className="zen-chat-photo-draft" key={photo.id}>
                  <img src={photo.data} alt={photo.name} />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={"Remover " + photo.name}
                    title={"Remover " + photo.name}
                    disabled={sending || preparing}
                    onClick={() => {
                      setPhotos((items) =>
                        items.filter((item) => item.id !== photo.id),
                      );
                      setPhotoError("");
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            id={composer}
            ref={draftInput}
            rows={1}
            maxLength={2000}
            value={draft}
            disabled={blocked}
            placeholder={
              photos.length
                ? "Adicione uma legenda (opcional)…"
                : team
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
          <div className="zen-chat-compose-toolbar">
            <div className="zen-chat-attachment-actions">
              <button
                type="button"
                className="secondary-button"
                aria-label="Anexar fotos"
                disabled={!canAttach}
                onClick={() => attachmentInput.current.click()}
              >
                <Paperclip size={17} /> Anexar
              </button>
              <button
                type="button"
                className="secondary-button"
                aria-label="Abrir câmera"
                disabled={!canAttach}
                onClick={openCamera}
              >
                <Camera size={17} /> Câmera
              </button>
              <input
                ref={attachmentInput}
                type="file"
                accept={chatPhotoAccept}
                aria-label="Selecionar fotos"
                multiple
                hidden
                onChange={addFiles}
              />
              <input
                ref={cameraInput}
                type="file"
                accept={chatPhotoAccept}
                aria-label="Fotografar com o dispositivo"
                capture="environment"
                hidden
                onChange={addFiles}
              />
            </div>
            <button
              type="submit"
              className="primary-button"
              disabled={!canSend}
            >
              <Send size={17} /> {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
        {preparing ? (
          <small role="status" className="zen-chat-compose-note">
            Preparando fotos…
          </small>
        ) : photos.length > 0 ? (
          <small className="zen-chat-compose-note">
            <ImageIcon size={14} /> {photos.length} de {maxChatPhotos} fotos
          </small>
        ) : (
          !photosEnabled &&
          !loading &&
          !readError && (
            <small className="zen-chat-compose-note">
              O envio de fotos requer a API atualizada.
            </small>
          )
        )}
      </form>
      {open && camera && photosEnabled && (
        <ChatCamera
          onClose={() => setCamera(false)}
          onCapture={(photo) => {
            setPhotos((items) => [...items, photo]);
            setPhotoError("");
            setCamera(false);
          }}
          onNative={() => {
            cameraInput.current.click();
            setCamera(false);
          }}
        />
      )}
    </section>
  );
}

export default function Chat({ mode, onModeChange, targetThread, onNotice }) {
  const user = useSession(),
    staff = user.papel !== "tecnico";
  const id = useId(),
    windowRef = useRef(null),
    rosterRef = useRef(null),
    launcher = useRef(null);
  const open = mode !== "closed",
    compact = mode === "mini";
  const sizeLabel = compact
    ? "Abrir chat em tela cheia"
    : "Voltar ao mini chat";
  const [directory, setDirectory] = useState(null),
    [selected, setSelected] = useState(null),
    [section, setSection] = useState("inbox");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useChatPresence(user.id);
  const live = useChatStream(
    (reason) => {
      if (open) setRevision((n) => n + 1);
      if (reason !== "change") onNotice?.(reason === "notice");
    },
    Boolean(user.id) && (Boolean(onNotice) || open),
  );
  const team = section === "team";
  const search = staff && !team ? query.trim() : "";
  const directoryKey = team ? "team" : "inbox:" + search;
  const result = directory?.key === directoryKey ? directory : null;
  const items = result?.items;
  const error = result?.error;
  const ready = live && items && !error;
  const technicianThread = staff
    ? items?.find((item) => item.id === selected?.id) || selected
    : items?.[0];
  const activeThread = team ? items && teamThread : technicianThread;
  useLayoutEffect(() => {
    const roster = rosterRef.current;
    const panel = windowRef.current;
    if (!roster || !open) return;
    let wide;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width > 700;
      if (next !== wide) roster.open = next;
      wide = next;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [team, open, mode]);
  function showSection(next) {
    if (next === section) return;
    setSection(next);
    setSelected(null);
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
        api
          .get(team ? "/chat/team" : "/chat/threads", {
            signal: controller.signal,
            params: staff && !team ? { q: search } : undefined,
          })
          .then(({ data }) => {
            if (controller.signal.aborted) return;
            // Old APIs return a partial technician list with the same URL.
            const legacy = staff && !team && data?.directory_version !== 1;
            if (!Array.isArray(data?.items) || legacy) {
              setDirectory({ key: directoryKey, error: outdatedChat });
              return;
            }
            setDirectory({
              key: directoryKey,
              items: data.items,
              hasMore: data.has_more,
              photosEnabled: data.photo_version === 1,
            });
          })
          .catch((e) => {
            if (controller.signal.aborted) return;
            const status = e.response?.status;
            setDirectory((previous) => ({
              key: directoryKey,
              items:
                previous?.key === directoryKey &&
                ![401, 403, 404].includes(status)
                  ? previous.items
                  : undefined,
              error: status === 404 ? outdatedChat : chatError(e),
            }));
          });
      },
      search ? 230 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, search, revision, directoryKey, team, staff]);
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
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          onModeChange("closed");
        }}
        onKeyDown={(e) => {
          if (
            compact &&
            e.key === "Escape" &&
            !e.target.closest(".pro-dialog")
          ) {
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
                  className={"zen-chat-status " + (ready ? "is-live" : "")}
                  role="status"
                >
                  {error
                    ? "Falha ao carregar o chat"
                    : ready
                      ? "Em tempo real"
                      : "Atualizando conversa"}
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
            {staff && (
              <nav className="zen-chat-sections" aria-label="Seções do chat">
                <button
                  type="button"
                  aria-pressed={!team}
                  onClick={() => showSection("inbox")}
                >
                  Técnicos
                </button>
                <button
                  type="button"
                  aria-pressed={team}
                  onClick={() => showSection("team")}
                >
                  Equipe interna
                </button>
              </nav>
            )}
            <label>
              <span className="zen-chat-status-label">Meu status</span>
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
            <ChatLoadError
              message={error}
              onRetry={() => setRevision((n) => n + 1)}
            />
          )}
          <div
            className={
              "zen-chat-layout " +
              (staff ? "is-staff " : "") +
              (activeThread ? "has-thread " : "") +
              (team ? "is-team" : "")
            }
          >
            {staff && (
              <aside
                className="zen-chat-threads"
                aria-label={
                  team ? "Equipe da operação" : "Técnicos cadastrados"
                }
              >
                {team ? (
                  <details ref={rosterRef} className="zen-chat-team-members">
                    <summary>
                      Colaboradores {items ? "(" + items.length + ")" : ""}
                    </summary>
                    {!items && !error && (
                      <p role="status">Carregando equipe…</p>
                    )}
                    {!error && items?.length === 0 && (
                      <p>Nenhum colaborador ativo cadastrado.</p>
                    )}
                    <ul className="zen-chat-roster">
                      {items?.map((person) => (
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
                  </details>
                ) : (
                  <>
                    <label className="zen-chat-search">
                      <Search size={17} />
                      <input
                        type="search"
                        aria-label="Buscar técnico nas conversas"
                        placeholder="Buscar técnico ou empresa"
                        value={query}
                        maxLength={120}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    {!items && !error && (
                      <p role="status">Carregando técnicos…</p>
                    )}
                    {!error && items?.length === 0 && (
                      <p>
                        {search
                          ? "Nenhum técnico corresponde à busca."
                          : "Nenhum técnico ativo cadastrado."}
                      </p>
                    )}
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
                              : t.preview ||
                                (t.activation_required
                                  ? "Recebe ao primeiro acesso"
                                  : "Iniciar conversa")}
                          </small>
                        </span>
                      </button>
                    ))}
                    {result?.hasMore && (
                      <p>Refine a busca para localizar outros técnicos.</p>
                    )}
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
                onBack={staff && !team ? () => setSelected(null) : undefined}
                mode={mode}
                photosEnabled={result?.photosEnabled === true}
              />
            ) : (
              !error && (
                <div className="zen-chat-placeholder">
                  <MessageCircle size={28} />
                  <p>
                    {staff && !team
                      ? "Selecione um técnico para abrir a conversa."
                      : "Abrindo conversa…"}
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
