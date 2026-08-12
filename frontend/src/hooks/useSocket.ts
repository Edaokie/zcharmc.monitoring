// ─────────────────────────────────────────
// useSocket — Real-time WebSocket hook
// ─────────────────────────────────────────
// Connects to the Flask backend via Socket.IO.
// Listens for 'co2_update' and 'valve_update' events.
//
// Usage:
//   const { latestByNode, connected, valves, actuateValve } = useSocket();

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";
import { BACKEND_URL } from "@/lib/api";

export interface SocketReading {
  node_id: string;
  co2: number;
  temperature: number;
  humidity: number;
  no2?: number;
  so2?: number;
  ph?: number;
  pm25?: number;
  flow_rate?: number;
  level?: number;
  /** Pressure Sensor 01 — left tank (psi) */
  pressure1?: number;
  /** Pressure Sensor 02 — right tank (psi) */
  pressure2?: number;
  /** Vacuum pump 1 on/off */
  vacuum1?: boolean;
  /** Vacuum pump 2 on/off */
  vacuum2?: boolean;
  /** Vacuum pump 3 on/off */
  vacuum3?: boolean;
  timestamp: string;
}

export interface ValveState {
  id: string;
  label: string;
  open: boolean;
  lastToggled: number;
}

interface UseSocketReturn {
  /** Whether the WebSocket is currently connected */
  connected: boolean;
  /** Latest reading per node_id, updated in real-time */
  latestByNode: Record<string, SocketReading>;
  /** Rolling buffer of all recent readings (for live charts), newest last */
  recentReadings: SocketReading[];
  /** Rolling buffer per node_id, newest last */
  recentByNode: Record<string, SocketReading[]>;
  /** Current solenoid valve states (SV1–SV6) */
  valves: ValveState[];
  /** Actuate/toggle a solenoid valve */
  actuateValve: (valveId: string, open: boolean) => void;
  /** Vacuum pump states (Vacuum 1–3) */
  vacuums: ValveState[];
  /** Actuate/toggle a vacuum pump */
  actuateVacuum: (vacuumId: string, on: boolean) => void;
}

const MAX_BUFFER = 120; // keep last 120 data points per node (~10 min at 5s interval)

function normalizeNodeId(nodeId: string): string {
  if (nodeId === "node1") return "inlet";
  if (nodeId === "node2") return "outlet";
  if (nodeId === "node3") return "solenoid_valves";
  return nodeId;
}

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [latestByNode, setLatestByNode] = useState<Record<string, SocketReading>>({});
  const [recentReadings, setRecentReadings] = useState<SocketReading[]>([]);
  const [recentByNode, setRecentByNode] = useState<Record<string, SocketReading[]>>({});
  const [valves, setValves] = useState<ValveState[]>([
    { id: "sv1", label: "SV1 · Inlet A", open: false, lastToggled: Date.now() - 1000 * 60 * 5 },
    { id: "sv2", label: "SV2 · Inlet B", open: false, lastToggled: Date.now() - 1000 * 60 * 10 },
    { id: "sv3", label: "SV3 · Outlet", open: false, lastToggled: Date.now() - 1000 * 60 * 3 },
    {
      id: "sv4",
      label: "SV4 · Center Inlet",
      open: false,
      lastToggled: Date.now() - 1000 * 60 * 15,
    },
    { id: "sv5", label: "SV5 · Purge Left", open: false, lastToggled: Date.now() - 1000 * 60 * 20 },
    {
      id: "sv6",
      label: "SV6 · Purge Right",
      open: false,
      lastToggled: Date.now() - 1000 * 60 * 25,
    },
  ]);

  const [vacuums, setVacuums] = useState<ValveState[]>([
    {
      id: "vac1",
      label: "Vacuum 1 · Main Inlet",
      open: false,
      lastToggled: Date.now() - 1000 * 60 * 8,
    },
    {
      id: "vac2",
      label: "Vacuum 2 · Left Col",
      open: false,
      lastToggled: Date.now() - 1000 * 60 * 12,
    },
    {
      id: "vac3",
      label: "Vacuum 3 · Right Col",
      open: false,
      lastToggled: Date.now() - 1000 * 60 * 18,
    },
  ]);

  const handleUpdate = useCallback((data: SocketReading) => {
    const normNodeId = normalizeNodeId(data.node_id);
    const normalizedData = {
      ...data,
      node_id: normNodeId,
      // Map potential backend naming discrepancies
      flow_rate: data.flow_rate ?? 0,
      level: data.level ?? 0,
    };

    // Update latest per node
    setLatestByNode((prev) => ({ ...prev, [normNodeId]: normalizedData }));

    // Append to global rolling buffer
    setRecentReadings((prev) => {
      const next = [...prev, normalizedData];
      return next.length > MAX_BUFFER * 3 ? next.slice(-MAX_BUFFER * 3) : next;
    });

    // Append to per-node rolling buffer
    setRecentByNode((prev) => {
      const nodeArr = prev[normNodeId] || [];
      const next = [...nodeArr, normalizedData];
      return {
        ...prev,
        [normNodeId]: next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next,
      };
    });
  }, []);

  const handleValveUpdate = useCallback(
    (data: {
      node_id: string;
      valves: { id: string; label: string; open: boolean; lastToggled?: number }[];
    }) => {
      if (data && Array.isArray(data.valves)) {
        const mappedValves = data.valves.map((v) => ({
          id: v.id,
          label: v.label,
          open: v.open,
          lastToggled: v.lastToggled ?? Date.now(),
        }));
        setValves(mappedValves);
      }
    },
    [],
  );

  const actuateValve = useCallback(
    (valveId: string, open: boolean) => {
      if (socketRef.current && connected) {
        console.log(`[WS] Emitting actuate_valve for ${valveId} -> ${open}`);
        socketRef.current.emit("actuate_valve", { valve_id: valveId, open });
        setValves((prev) =>
          prev.map((v) => (v.id === valveId ? { ...v, open, lastToggled: Date.now() } : v)),
        );
      } else {
        console.log(`[WS] Offline mode: Toggle valve ${valveId} to ${open}`);
        setValves((prev) =>
          prev.map((v) => (v.id === valveId ? { ...v, open, lastToggled: Date.now() } : v)),
        );
      }
    },
    [connected],
  );

  const actuateVacuum = useCallback(
    (vacuumId: string, on: boolean) => {
      if (socketRef.current && connected) {
        console.log(`[WS] Emitting actuate_vacuum for ${vacuumId} -> ${on}`);
        socketRef.current.emit("actuate_vacuum", { vacuum_id: vacuumId, on });
        setVacuums((prev) =>
          prev.map((v) => (v.id === vacuumId ? { ...v, open: on, lastToggled: Date.now() } : v)),
        );
      } else {
        console.log(`[WS] Offline mode: Toggle vacuum ${vacuumId} to ${on}`);
        setVacuums((prev) =>
          prev.map((v) => (v.id === vacuumId ? { ...v, open: on, lastToggled: Date.now() } : v)),
        );
      }
    },
    [connected],
  );

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[WS] Connected to backend");
      setConnected(true);
    });

    socket.on("disconnect", () => {
      console.log("[WS] Disconnected from backend");
      setConnected(false);
    });

    socket.on("co2_update", handleUpdate);
    socket.on("valve_update", handleValveUpdate);

    return () => {
      socket.off("co2_update", handleUpdate);
      socket.off("valve_update", handleValveUpdate);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handleUpdate, handleValveUpdate]);

  return {
    connected,
    latestByNode,
    recentReadings,
    recentByNode,
    valves,
    actuateValve,
    vacuums,
    actuateVacuum,
  };
}
