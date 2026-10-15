import { useState, useEffect, useRef, useId } from "react";
import {
  Camera,
  ImagePlus,
  FileText,
  Plus,
  ScanLine,
  Pause,
  Play,
  RotateCcw,
  CheckCheck,
  Keyboard,
  LoaderCircle,
} from "lucide-react";
import { mergeSerials, MAX_BATCH } from "../lib/serials";
import {
  cameraConstraints,
  cameraError,
  confirmationGate,
  frameSize,
  scanRegion,
  stopStream,
  tuneCamera,
} from "../lib/scanner";
import { createDecoder } from "../lib/scanner-client";

export default function LeitorSeriais({
  seriais,
  setSeriais,
  initialCamera = false,
  maxBatch = MAX_BATCH,
}) {
  const [mode, setMode] = useState("auto");
  const [hidden, setHidden] = useState(() => document.hidden);
  const [hint, setHint] = useState("");
  const [dimensions, setDimensions] = useState({ width: 1920, height: 1080 });
  const [controls, setControls] = useState({});
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(1);
  const videoRef = useRef(null),
    streamRef = useRef(null),
    photoDecoder = useRef(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [manual, setManual] = useState("");
  const [camera, setCamera] = useState(initialCamera);
  const [paused, setPaused] = useState(false);
  const [device, setDevice] = useState("");
  const [devices, setDevices] = useState([]);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [lastCode, setLastCode] = useState("");
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const photoInput = useRef(null),
    txtInput = useRef(null);
  const current = useRef(seriais),
    setter = useRef(setSeriais);
  const audio = useRef(null);
  const mounted = useRef(true),
    generation = useRef(0);
  const importing = useRef(false),
    recent = useRef({ code: "", at: 0 });
  current.current = seriais;
  setter.current = setSeriais;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      photoDecoder.current?.close();
      if (audio.current) audio.current.close().catch(() => {});
    };
  }, []);

  function beep() {
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      if (!audio.current || audio.current.state === "closed")
        audio.current = new Context();
      const ctx = audio.current;
      ctx.resume().catch(() => {});
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.035;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.07);
    } catch {
      /* Som opcional */
    }
  }

  function add(codes, fromCamera = false) {
    if (!mounted.current) return;
    if (fromCamera) {
      const now = Date.now();
      if (recent.current.code === codes[0] && now - recent.current.at < 2000)
        return;
      recent.current = { code: codes[0], at: now };
    }
    try {
      const next = mergeSerials(current.current, codes);
      if (next.length > maxBatch)
        throw Error(`Limite de ${maxBatch} equipamentos por atendimento.`);
      const added = next.length - current.current.length;
      if (added) {
        current.current = next;
        setter.current(next);
        beep();
        setLastCode(next[0]);
      }
      if (!fromCamera) setManual("");
      setMessage(
        added
          ? `${added} serial(is) adicionado(s) à conferência.`
          : `Nenhum novo serial. Códigos repetidos foram ignorados.`,
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  const addRef = useRef(add);
  addRef.current = add;

  useEffect(() => {
    const change = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);

  useEffect(() => {
    if (!camera || paused || hidden) {
      setStatus("idle");
      return;
    }
    let cancelled = false,
      stream,
      decoder,
      timer,
      detachEnded;
    const video = videoRef.current;
    const gate = confirmationGate();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let lastFrame = -1,
      lastMode = modeRef.current,
      frameNumber = 0,
      misses = 0;
    const cleanup = () => {
      clearTimeout(timer);
      detachEnded?.();
      decoder?.close();
      stopStream(stream);
      if (streamRef.current === stream) streamRef.current = null;
      if (video?.srcObject === stream) video.srcObject = null;
    };
    setStatus("starting");
    setMessage("");
    setHint("Mostre uma etiqueta em qualquer posição da imagem.");
    setControls({});
    setTorch(false);
    recent.current = { code: "", at: 0 };
    async function readFrame() {
      if (cancelled) return;
      const started = performance.now();
      try {
        if (video.closest("fieldset")?.disabled) {
          gate.reset();
          timer = setTimeout(readFrame, 125);
          return;
        }
        if (
          video.readyState >= 2 &&
          video.videoWidth &&
          video.currentTime !== lastFrame
        ) {
          lastFrame = video.currentTime;
          const scanMode = modeRef.current;
          if (lastMode !== scanMode) {
            gate.reset();
            lastMode = scanMode;
            misses = 0;
          }
          const region = scanRegion(
            video.videoWidth,
            video.videoHeight,
            scanMode,
          );
          // Most frames use a quick full-image pass. Periodically retain native
          // pixels and try harder for smaller, tilted or inverted labels.
          frameNumber++;
          const profile =
            misses >= 2 && frameNumber % 3 === 0 ? "accurate" : "fast";
          const size = frameSize(region.width, region.height, profile);
          if (canvas.width !== size.width || canvas.height !== size.height) {
            canvas.width = size.width;
            canvas.height = size.height;
          }
          ctx.drawImage(
            video,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            size.width,
            size.height,
          );
          const results = await decoder.decode(
            ctx.getImageData(0, 0, size.width, size.height),
            scanMode,
            profile,
          );
          misses = results.length ? 0 : misses + 1;
          if (cancelled) return;
          if (video.closest("fieldset")?.disabled) {
            gate.reset();
            timer = setTimeout(readFrame, 125);
            return;
          }
          if (scanMode !== modeRef.current) {
            gate.reset();
          } else {
            const observation = gate.observe(results, performance.now());
            setHint(
              observation.ambiguous
                ? "Mais de um código visível. Isole uma etiqueta ou selecione QR Code / Barras."
                : observation.result
                  ? current.current.includes(observation.result.text)
                    ? "Já conferido. Mostre o próximo equipamento."
                    : `${observation.result.format} confirmado em ${observation.required} quadros.`
                  : observation.count
                    ? `Confirmando leitura (${observation.count}/${observation.required})…`
                    : "Leitura da imagem inteira. Mostre o código nítido, sem precisar centralizar.",
            );
            if (
              observation.result &&
              !current.current.includes(observation.result.text)
            )
              addRef.current([observation.result.text], true);
          }
        }
        // Sequential loop: never overlap decoding work or repeatedly confirm one frame.
        if (!cancelled)
          timer = setTimeout(
            readFrame,
            Math.max(16, 66 - (performance.now() - started)),
          );
      } catch (error) {
        if (cancelled) return;
        cleanup();
        setStatus("error");
        setMessage(
          error.message || "A leitura foi interrompida. Tente novamente.",
        );
      }
    }
    (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error("secure-context");
        decoder = createDecoder();
        await decoder.ready();
        if (cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia(
          cameraConstraints(device),
        );
        // Permission dialogs may settle after closing, changing camera or unmounting.
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        const track = stream.getVideoTracks()[0];
        const ended = () => {
          if (cancelled) return;
          cleanup();
          setStatus("error");
          setMessage(
            "A câmera foi desconectada ou interrompida. Tente novamente.",
          );
        };
        track.addEventListener("ended", ended);
        detachEnded = () => track.removeEventListener("ended", ended);
        const capabilities = await tuneCamera(track);
        if (cancelled) return;
        setControls(capabilities);
        setZoom(track.getSettings?.().zoom || capabilities.zoom?.min || 1);
        setDimensions({ width: video.videoWidth, height: video.videoHeight });
        try {
          const available = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled)
            setDevices(available.filter((d) => d.kind === "videoinput"));
        } catch {
          /* Selection remains optional when enumeration is unavailable. */
        }
        if (cancelled) return;
        setStatus("active");
        readFrame();
      } catch (error) {
        cleanup();
        if (cancelled) return;
        setStatus("error");
        setMessage(
          error.message === "secure-context"
            ? "A câmera requer HTTPS ou localhost e permissão de acesso."
            : cameraError(error),
        );
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [camera, paused, hidden, device, retry]);

  async function cameraControl(name, value) {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ [name]: value }] });
      if (streamRef.current?.getVideoTracks()[0] !== track) return;
      if (name === "torch") setTorch(value);
      else setZoom(value);
    } catch {
      setMessage("Esse ajuste não é suportado pela câmera atual.");
    }
  }

  async function photos(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || importing.current) return;
    if (files.length > 100) {
      setMessage("Envie no máximo 100 fotos por vez.");
      return;
    }
    importing.current = true;
    setBusy(true);
    const token = generation.current;
    const alive = () => mounted.current && token === generation.current;
    let decoder,
      failures = 0,
      ambiguous = 0;
    const codes = [];
    try {
      decoder = createDecoder();
      photoDecoder.current = decoder;
      await decoder.ready();
      for (const [index, file] of files.entries()) {
        if (!alive()) break;
        setProgress(`${index + 1}/${files.length}`);
        if (file.size > 10 * 1024 * 1024 || !file.type.startsWith("image/")) {
          failures++;
          continue;
        }
        let url;
        try {
          url = URL.createObjectURL(file);
          const image = new Image();
          image.src = url;
          await image.decode();
          if (!alive()) break;
          const scale = Math.min(
            1,
            3200 / Math.max(image.naturalWidth, image.naturalHeight),
          );
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const results = await decoder.decode(
            ctx.getImageData(0, 0, canvas.width, canvas.height),
            modeRef.current,
          );
          if (results.length === 1) codes.push(results[0].text);
          else if (results.length > 1) ambiguous++;
          else failures++;
        } catch {
          failures++;
        } finally {
          if (url) URL.revokeObjectURL(url);
        }
      }
      if (alive()) {
        let added = 0,
          rejected = 0;
        for (const code of codes) {
          try {
            const next = mergeSerials(current.current, [code]);
            if (next.length > maxBatch)
              throw Error("Limite de equipamentos excedido.");
            added += next.length - current.current.length;
            current.current = next;
          } catch {
            rejected++;
          }
        }
        setter.current(current.current);
        if (added) {
          beep();
          setLastCode(current.current[0]);
        }
        setMessage(
          `${added} serial(is) adicionado(s); ${codes.length - added - rejected} repetido(s); ${failures} foto(s) sem leitura; ${ambiguous} foto(s) com vários códigos (isole uma etiqueta); ${rejected} código(s) inválido(s).`,
        );
      }
    } catch (error) {
      if (alive())
        setMessage(error.message || "Não foi possível analisar as fotos.");
    } finally {
      decoder?.close();
      if (photoDecoder.current === decoder) photoDecoder.current = null;
      importing.current = false;
      if (alive()) {
        setBusy(false);
        setProgress("");
      }
    }
  }

  async function txt(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setMessage(`O arquivo TXT deve ter até 1 MB.`);
      return;
    }
    const token = generation.current;
    try {
      const lines = (await file.text()).split(/\r?\n/);
      if (mounted.current && token === generation.current)
        addRef.current(lines);
    } catch {
      if (mounted.current) setMessage(`Não foi possível ler o arquivo TXT.`);
    }
  }

  return (
    <section
      className="serial-reader"
      aria-label="Leitor de QR Code e código de barras"
    >
      <div className="reader-heading">
        <span className="reader-symbol">
          <ScanLine size={20} />
        </span>
        <div>
          <h3>Adicionar equipamentos</h3>
          <p>Leitura rápida · QR Code e barras</p>
        </div>
        <span className="reader-count">
          {seriais.length}/{maxBatch}
        </span>
      </div>
      <div className="reader-actions">
        <button
          type="button"
          className={`reader-action ${camera ? "is-selected" : ""}`}
          aria-pressed={camera}
          onClick={() => {
            setCamera((v) => !v);
            setPaused(false);
            setMessage("");
          }}
        >
          <Camera size={20} />
          <strong>{camera ? "Fechar câmera" : "Usar câmera / webcam"}</strong>
          <small>Leitura contínua</small>
        </button>
        <button
          type="button"
          className="reader-action"
          disabled={busy}
          onClick={() => photoInput.current?.click()}
        >
          {busy ? (
            <LoaderCircle size={20} className="is-spinning" />
          ) : (
            <ImagePlus size={20} />
          )}
          <strong>{busy ? `Analisando ${progress}` : "Enviar fotos"}</strong>
          <small>Uma etiqueta por foto</small>
        </button>
        <button
          type="button"
          className="reader-action"
          disabled={busy}
          onClick={() => txtInput.current?.click()}
        >
          <FileText size={20} />
          <strong>Importar lista</strong>
          <small>Arquivo TXT</small>
        </button>
      </div>
      <input
        ref={photoInput}
        type="file"
        aria-label="Importar fotos de etiquetas"
        accept="image/*"
        multiple
        hidden
        disabled={busy}
        onChange={photos}
      />
      <input
        ref={txtInput}
        type="file"
        aria-label="Importar lista de seriais"
        accept=".txt,text/plain"
        hidden
        disabled={busy}
        onChange={txt}
      />
      <div className="reader-scan-mode">
        <label htmlFor={`mode-${id}`}>Tipo de leitura</label>
        <select
          id={`mode-${id}`}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="auto">Automático: QR Code e barras</option>
          <option value="qr">Somente QR Code</option>
          <option value="barcode">Somente código de barras</option>
        </select>
      </div>
      <div className="reader-camera" hidden={!camera}>
        <div className="reader-camera-toolbar">
          <label htmlFor={`device-${id}`}>Câmera</label>
          <select
            id={`device-${id}`}
            value={device}
            disabled={status === "starting" && !paused}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="">Automática (preferir traseira no celular)</option>
            {devices.map((d, index) => (
              <option key={d.id || d.deviceId} value={d.id || d.deviceId}>
                {d.label || `Câmera ${index + 1}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            aria-label={paused ? "Retomar leitura" : "Pausar leitura"}
            disabled={status !== "active" && !paused}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
        </div>
        <div
          className="reader-viewfinder"
          style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
        >
          <video
            ref={videoRef}
            className="reader-video"
            autoPlay
            muted
            playsInline
          />
          {status === "active" && !paused && (
            <div
              className="reader-frame"
              aria-hidden="true"
              style={(() => {
                const r = scanRegion(dimensions.width, dimensions.height, mode);
                return {
                  left: `${(r.x / dimensions.width) * 100}%`,
                  top: `${(r.y / dimensions.height) * 100}%`,
                  width: `${(r.width / dimensions.width) * 100}%`,
                  height: `${(r.height / dimensions.height) * 100}%`,
                };
              })()}
            />
          )}
          {(paused || hidden || status !== "active") && (
            <div className="reader-camera-placeholder">
              {status === "starting" && !paused ? (
                <LoaderCircle size={28} className="is-spinning" />
              ) : (
                <Camera size={28} />
              )}
              <span className="px-4 text-center">
                {hidden
                  ? "Leitura pausada enquanto esta aba está em segundo plano"
                  : paused
                    ? "Leitura pausada"
                    : status === "error"
                      ? message || "Câmera indisponível"
                      : "Aguardando acesso à câmera…"}
              </span>
              {status === "error" && !paused && (
                <button type="button" onClick={() => setRetry((v) => v + 1)}>
                  <RotateCcw size={15} /> Tentar novamente
                </button>
              )}
            </div>
          )}
        </div>
        {status === "active" && (
          <div className="reader-camera-controls">
            <span>
              {dimensions.width} × {dimensions.height}
            </span>
            {controls.torch && (
              <button
                type="button"
                aria-pressed={torch}
                onClick={() => cameraControl("torch", !torch)}
              >
                {torch ? "Desligar lanterna" : "Ligar lanterna"}
              </button>
            )}
            {controls.zoom && (
              <label>
                Zoom
                <input
                  type="range"
                  aria-label="Zoom da câmera"
                  min={controls.zoom.min}
                  max={controls.zoom.max}
                  step={controls.zoom.step || 0.1}
                  value={zoom}
                  onChange={(e) =>
                    cameraControl("zoom", Number(e.target.value))
                  }
                />
              </label>
            )}
          </div>
        )}
        <p className="reader-camera-tip" role="status">
          {hint ||
            "Mostre uma etiqueta por vez em qualquer posição da imagem. Ajuste a distância até ficar nítida."}
        </p>
      </div>
      <label className="reader-manual-label" htmlFor={`manual-${id}`}>
        <Keyboard size={15} /> Digitar ou usar leitor USB
      </label>
      <div className="reader-manual">
        <input
          id={`manual-${id}`}
          placeholder="IMEI ou serial do equipamento"
          autoComplete="off"
          spellCheck={false}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add([manual]);
            }
          }}
        />
        <button
          type="button"
          disabled={!manual.trim()}
          onClick={() => add([manual])}
        >
          <Plus size={18} />
          <span>Adicionar</span>
        </button>
      </div>
      {lastCode && (
        <div className="reader-last">
          <CheckCheck size={16} />
          <span>
            Último adicionado: <code>{lastCode}</code>
          </span>
        </div>
      )}
      {message && status !== "error" && (
        <p role="status" className="reader-message">
          {message}
        </p>
      )}
      <p className="reader-help">
        Até 100 fotos de 10 MB. No TXT, um serial por linha. Revise a lista
        antes de confirmar a movimentação.
      </p>
    </section>
  );
}
