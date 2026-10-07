import { useEffect, useState, useCallback } from "react";
import { io } from "socket.io-client";
import { BACKEND_URL } from "@/lib/api";
import { compareReadings, mergeReading } from "@/lib/readings";
import type { MeasurementField } from "@/lib/monitoring";
import type { ValveState } from "@/lib/mock-data";

export type SocketReading = Partial<Record<MeasurementField, number | null>> & {
  id?: number;
  message_id?: string | null;
  node_id: string;
  timestamp: string;
  received_at?: string;
};

const MAX_BUFFER = 120;
const EMPTY_VALVES: ValveState[] = [
  "SV1 · Inlet A",
  "SV2 · Inlet B",
  "SV3 · Outlet",
  "SV4 · Center Inlet",
  "SV5 · Purge Left",
  "SV6 · Purge Right",
].map((label, index) => ({ id: `sv${index + 1}`, label, open: null, lastReported: null }));
const EMPTY_VACUUMS: ValveState[] = [
  "Vacuum 1 · Main Inlet",
  "Vacuum 2 · Left Col",
  "Vacuum 3 · Right Col",
].map((label, index) => ({ id: `vac${index + 1}`, label, open: null, lastReported: null }));

function normalizeNodeId(nodeId: string): string {
  if (nodeId === "node1") return "inlet";
  if (nodeId === "node2") return "outlet";
  if (nodeId === "node3") return "solenoid_valves";
  return nodeId;
}

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [latestByNode, setLatestByNode] = useState<Record<string, SocketReading>>({});
  const [recentReadings, setRecentReadings] = useState<SocketReading[]>([]);
  const [recentByNode, setRecentByNode] = useState<Record<string, SocketReading[]>>({});
  const [valveSnapshot, setValveSnapshot] = useState<{
    valves: ValveState[];
    timestamp: number | null;
  }>({
    valves: EMPTY_VALVES,
    timestamp: null,
  });

  const handleUpdate = useCallback((data: SocketReading) => {
    if (!data || !Number.isFinite(Date.parse(data.timestamp))) return;
    const node_id = normalizeNodeId(data.node_id);
    const reading = { ...data, node_id };
    setLatestByNode((previous) => {
      const current = previous[node_id];
      if (current && compareReadings(reading, current) <= 0) return previous;
      return { ...previous, [node_id]: reading };
    });
    setRecentReadings((previous) => mergeReading(previous, reading, MAX_BUFFER * 3));
    setRecentByNode((previous) => ({
      ...previous,
      [node_id]: mergeReading(previous[node_id] || [], reading, MAX_BUFFER),
    }));
  }, []);

  const handleValveUpdate = useCallback(
    (data: { timestamp: string; valves: { id: string; label: string; open: boolean }[] }) => {
      if (!data || !Array.isArray(data.valves)) return;
      const timestamp = Date.parse(data.timestamp);
      if (!Number.isFinite(timestamp)) return;
      setValveSnapshot((previous) => {
        if (previous.timestamp != null && timestamp <= previous.timestamp) return previous;
        return {
          timestamp,
          valves: EMPTY_VALVES.map((unknown) => {
            const reported = data.valves.find((valve) => valve.id === unknown.id);
            return reported && typeof reported.open === "boolean"
              ? { ...unknown, ...reported, lastReported: timestamp }
              : unknown;
          }),
        };
      });
    },
    [],
  );

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("co2_update", handleUpdate);
    socket.on("valve_update", handleValveUpdate);
    return () => {
      socket.off("co2_update", handleUpdate);
      socket.off("valve_update", handleValveUpdate);
      socket.disconnect();
    };
  }, [handleUpdate, handleValveUpdate]);

  // Remote actuation is unsupported. Only telemetry may change displayed hardware state.
  return {
    connected,
    latestByNode,
    recentReadings,
    recentByNode,
    valves: valveSnapshot.valves,
    valveTimestamp: valveSnapshot.timestamp,
    vacuums: EMPTY_VACUUMS,
  };
}
