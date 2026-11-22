"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { showAlertToast } from "@/components/iw/toasts";
import type { ThresholdSettings } from "@/lib/analysis/modules";
import { withBasePath } from "@/lib/base-path";
import type { HighRiskIncidentEvent } from "@/lib/incidents/contract";
import { invalidateIncidents, keys } from "./api";

// Połączenie Socket.io (docs/KONTRAKT.md §10). Port serwera podaje GET /api/realtime.
// Kontekst niesie stan połączenia (panel „Na żywo”) i id incydentów z alertów tej sesji
// (wiersz z alertu wsuwa się z tłem risk-50, które gaśnie).

type RealtimeState = { connected: boolean; alertIds: ReadonlySet<string> };

const RealtimeContext = createContext<RealtimeState>({ connected: false, alertIds: new Set() });

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [alertIds, setAlertIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let disconnect: (() => void) | undefined;

    async function connect() {
      let port = 3001;
      try {
        const response = await fetch(withBasePath("/api/realtime"));
        if (response.ok) {
          const body = (await response.json()) as { port?: unknown };
          if (typeof body.port === "number") port = body.port;
        }
      } catch {
        // Bez odpowiedzi zostaje domyślny port serwera Socket.io.
      }
      if (cancelled) return;
      const socket = io(`${window.location.protocol}//${window.location.hostname}:${port}`, {
        transports: ["websocket", "polling"],
      });
      socket.on("connect", () => setConnected(true));
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => setConnected(false));
      socket.on("incident.high_risk", (event: HighRiskIncidentEvent) => {
        setAlertIds((previous) => new Set(previous).add(event.id));
        invalidateIncidents(client);
        showAlertToast(event, () => router.push(`/kolejka/${event.id}`));
      });
      socket.on("result", () => invalidateIncidents(client));
      socket.on("job", () => void client.invalidateQueries({ queryKey: keys.sources }));
      socket.on("thresholds", (event: { thresholds: ThresholdSettings }) => {
        client.setQueryData(keys.thresholds, event.thresholds);
        invalidateIncidents(client);
      });
      disconnect = () => {
        socket.removeAllListeners();
        socket.disconnect();
      };
    }

    void connect();
    return () => {
      cancelled = true;
      disconnect?.();
    };
  }, [client, router]);

  return (
    <RealtimeContext.Provider value={{ connected, alertIds }}>{children}</RealtimeContext.Provider>
  );
}
