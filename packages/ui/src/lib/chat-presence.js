import { useEffect, useRef, useState } from "react";
import { api, sessionToken } from "./api";

const idleAfter = 5 * 60 * 1000;
export const presenceLabels = {
  online: "Online",
  away: "Ausente",
  busy: "Ocupado",
  offline: "Offline",
};

export function useChatPresence(userId) {
  const [clientId] = useState(() => crypto.randomUUID?.());
  const [choice, setChoice] = useState("online");
  const preferred = useRef("online"),
    send = useRef(null);
  useEffect(() => {
    const token = sessionToken();
    if (!userId || !token || !clientId) return;
    const controller = new AbortController();
    let lastActivity = Date.now(),
      pending = false,
      queued = false;
    async function publish() {
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      const status =
        preferred.current !== "online"
          ? preferred.current
          : document.hidden || Date.now() - lastActivity >= idleAfter
            ? "away"
            : "online";
      try {
        await fetch(api.defaults.baseURL + "/chat/presence", {
          method: "PUT",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ client_id: clientId, status }),
          signal: controller.signal,
        });
      } catch {
        // The next heartbeat retries transient failures.
      } finally {
        pending = false;
        if (queued && !controller.signal.aborted) {
          queued = false;
          publish();
        }
      }
    }
    function activity() {
      const wasIdle = Date.now() - lastActivity >= idleAfter;
      lastActivity = Date.now();
      if (wasIdle) publish();
    }
    function visibility() {
      if (!document.hidden) lastActivity = Date.now();
      publish();
    }
    send.current = publish;
    publish();
    const timer = setInterval(publish, 30000);
    document.addEventListener("pointerdown", activity, { passive: true });
    document.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      send.current = null;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clientId, userId]);
  return [
    choice,
    (next) => {
      preferred.current = next;
      setChoice(next);
      send.current?.();
    },
  ];
}
