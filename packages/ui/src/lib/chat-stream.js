import { useEffect, useRef, useState } from "react";
import { api, sessionToken, saveToken } from "./api";

export function useChatStream(onUpdate) {
  const callback = useRef(onUpdate);
  const [live, setLive] = useState(false);
  useEffect(() => {
    callback.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    const controller = new AbortController();
    let retry,
      delay = 1500;
    function refresh() {
      if (!document.hidden) callback.current();
    }
    async function connect() {
      const token = sessionToken();
      if (!token) return;
      try {
        const response = await fetch(api.defaults.baseURL + "/chat/stream", {
          headers: {
            Authorization: "Bearer " + token,
            Accept: "text/event-stream",
          },
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 401) {
          saveToken(null);
          window.dispatchEvent(new Event("invent:unauthorized"));
          return;
        }
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        )
          throw Error("Chat indisponível");
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        let buffer = "";
        try {
          while (!controller.signal.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end;
            while ((end = buffer.indexOf("\n\n")) >= 0) {
              const frame = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (frame.startsWith("event: ready")) {
                setLive(true);
                delay = 1500;
                refresh();
              } else if (frame.startsWith("event: change")) refresh();
            }
            if (buffer.length > 8192) throw Error("Evento inválido");
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      } catch {
        // The history fetch below also covers temporary disconnects and other instances.
      } finally {
        if (!controller.signal.aborted) {
          setLive(false);
          retry = setTimeout(connect, delay);
          delay = Math.min(15000, delay * 2);
        }
      }
    }
    connect();
    const poll = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearTimeout(retry);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return live;
}
