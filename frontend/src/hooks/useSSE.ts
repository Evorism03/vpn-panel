import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Connects to /api/events and invalidates React Query caches on server-sent events.
 * EVENT_MAP: sse event name → query keys to invalidate.
 */
const EVENT_MAP: Record<string, string[][]> = {
  clients: [["clients"], ["admin-stats"]],
  orders:  [["orders"],  ["admin-stats"]],
  audit:   [["audit"]],
};

export function useSSE() {
  const qc  = useQueryClient();
  const ref = useRef<EventSource | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) return;

    // EventSource doesn't support custom headers — pass token as query param
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    const es  = new EventSource(url);
    ref.current = es;

    for (const [event, keys] of Object.entries(EVENT_MAP)) {
      es.addEventListener(event, () => {
        keys.forEach(k => qc.invalidateQueries({ queryKey: k }));
      });
    }

    es.onerror = () => {
      es.close();
      // Reconnect after 5s
      setTimeout(() => {
        ref.current?.close();
        ref.current = null;
      }, 5000);
    };

    return () => {
      es.close();
      ref.current = null;
    };
  }, [qc]);
}
