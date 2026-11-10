import { useEffect, useRef, useState } from "react";
import { Camera, Image as ImageIcon } from "lucide-react";
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

export function ChatMessagePhoto({ path, author, position, open }) {
  const button = useRef(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url;
    async function load() {
      try {
        const { data } = await api.get(path, {
          signal: controller.signal,
          responseType: "blob",
        });
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(data);
        setSource(url);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(button.current);
    return () => {
      observer.disconnect();
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, attempt]);

  const label = "Foto " + position + " de " + author;
  function show() {
    if (source) setExpanded(true);
    else {
      setError(false);
      setAttempt((value) => value + 1);
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="zen-chat-photo"
        disabled={!source && !error}
        aria-label={
          source
            ? "Ampliar " + label.toLowerCase()
            : error
              ? "Carregar foto novamente"
              : label
        }
        onClick={show}
      >
        {source ? (
          <img src={source} alt={label} />
        ) : (
          <span>
            <ImageIcon size={20} />{" "}
            {error ? "Tentar novamente" : "Carregando foto…"}
          </span>
        )}
      </button>
      {open && expanded && source && (
        <Modal title={label} wide onClose={() => setExpanded(false)}>
          <img className="zen-chat-photo-expanded" src={source} alt={label} />
        </Modal>
      )}
    </>
  );
}
