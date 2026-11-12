import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
} from "lucide-react";
import { api } from "../lib/api";
import Modal from "./Modal";

export const maxChatPhotos = 4;
export const chatPhotoAccept = "image/jpeg,image/png,image/webp";
export const chatPhotoContentType = "application/vnd.zencontrol.chat+json";
const maxUploadLength = 23 + Math.ceil((1024 * 1024) / 3) * 4;

function photoDraft(source, width, height, name) {
  const scale = Math.min(1, 1800 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw Error("Não foi possível preparar a foto.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let data = canvas.toDataURL("image/jpeg", 0.88);
  if (data.length > maxUploadLength)
    data = canvas.toDataURL("image/jpeg", 0.72);
  if (data.length > maxUploadLength)
    throw Error("Esta foto é muito grande. Escolha uma imagem menor.");
  return { id: crypto.randomUUID(), name, data };
}

export async function prepareChatPhoto(file) {
  if (!chatPhotoAccept.split(",").includes(file.type))
    throw Error("Escolha fotos em JPEG, PNG ou WebP.");
  if (file.size > 20 * 1024 * 1024)
    throw Error("Escolha uma foto de até 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw Error("Não foi possível abrir a foto selecionada.");
    }
    return photoDraft(
      image,
      image.naturalWidth,
      image.naturalHeight,
      file.name,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ChatCamera({ onClose, onCapture, onNative }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let closed = false;
    let stream;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
      })
      .then((result) => {
        stream = result;
        if (closed) stop();
        else video.current.srcObject = stream;
      })
      .catch((cause) => {
        if (closed) return;
        setError(
          cause.name === "NotAllowedError"
            ? "Permita o acesso à câmera no navegador para fotografar."
            : "A câmera está indisponível. Confira a conexão ou escolha uma foto.",
        );
      });
    return () => {
      closed = true;
      stop();
    };
  }, []);

  function capture() {
    const frame = video.current;
    if (!frame?.videoWidth) return;
    try {
      onCapture(
        photoDraft(
          frame,
          frame.videoWidth,
          frame.videoHeight,
          "Foto da câmera.jpg",
        ),
      );
    } catch {
      setError("Não foi possível capturar a imagem. Tente novamente.");
    }
  }

  return (
    <Modal title="Câmera do chat" onClose={onClose}>
      <div className="zen-chat-camera">
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          onLoadedData={() => setReady(true)}
        />
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          !ready && <p role="status">Abrindo a câmera…</p>
        )}
        <div className="zen-chat-camera-actions">
          {error && (
            <button
              type="button"
              className="secondary-button"
              onClick={onNative}
            >
              Câmera do dispositivo
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            disabled={!ready}
            onClick={capture}
          >
            <Camera size={18} /> Tirar foto
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ChatMessagePhoto({
  path,
  author,
  position,
  name,
  names = [],
  count = 1,
  open,
}) {
  const [selected, setSelected] = useState(position);
  const activePath = path.slice(0, path.lastIndexOf("/") + 1) + selected;
  const [source, setSource] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded || !open) return;
    const controller = new AbortController();
    let url;
    setSource(null);
    setError(false);
    api
      .get(activePath, { signal: controller.signal, responseType: "blob" })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(data);
        setSource({ path: activePath, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [activePath, attempt, expanded, open]);
  useEffect(() => {
    if (!expanded || !open || count < 2) return;
    function navigate(event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setSelected((n) => Math.max(1, n - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setSelected((n) => Math.min(count, n + 1));
      }
    }
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [expanded, open, count]);
  const filename =
    name || "imagem-" + path.split("/").at(-3) + "-" + position + ".jpg";
  const activeName =
    names[selected - 1] ||
    (selected === position ? name : null) ||
    "imagem-" + path.split("/").at(-3) + "-" + selected + ".jpg";
  return (
    <>
      <button
        type="button"
        className="zen-chat-file"
        onClick={() => {
          setSelected(position);
          setExpanded(true);
        }}
        aria-label={"Abrir imagem " + filename}
        title={filename}
      >
        <ImageIcon size={16} aria-hidden="true" />
        <span>{filename}</span>
      </button>
      {open && expanded && (
        <Modal title={activeName} wide onClose={() => setExpanded(false)}>
          {count > 1 && (
            <nav
              className="zen-chat-gallery-nav"
              aria-label="Navegar pelas imagens da mensagem"
            >
              <button
                type="button"
                className="secondary-button"
                aria-label="Imagem anterior"
                disabled={selected === 1}
                onClick={() => setSelected((n) => Math.max(1, n - 1))}
              >
                <ChevronLeft size={20} />
              </button>
              <span role="status">
                {selected} de {count}
              </span>
              <button
                type="button"
                className="secondary-button"
                aria-label="Próxima imagem"
                disabled={selected === count}
                onClick={() => setSelected((n) => Math.min(count, n + 1))}
              >
                <ChevronRight size={20} />
              </button>
            </nav>
          )}

          {source?.path === activePath && !error && (
            <div className="zen-chat-gallery-download">
              <a
                className="secondary-button"
                href={source.url}
                download={
                  activeName.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg"
                }
                aria-label={"Baixar " + activeName}
              >
                <Download size={17} aria-hidden="true" /> Baixar
              </a>
            </div>
          )}
          {error ? (
            <div role="alert">
              <p>Não foi possível carregar a imagem.</p>
              <button
                className="secondary-button"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Tentar novamente
              </button>
            </div>
          ) : source?.path === activePath ? (
            <img
              className="zen-chat-photo-expanded"
              src={source.url}
              alt={"Imagem enviada por " + author}
            />
          ) : (
            <p role="status">Carregando imagem…</p>
          )}
        </Modal>
      )}
    </>
  );
}
