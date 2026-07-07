// ─────────────────────────────────────────
// useSocket — Real-time WebSocket hook
// ─────────────────────────────────────────
// Connects to the Flask backend via Socket.IO.
// Listens for 'co2_update' events pushed when the ESP32
// sends new MQTT data.
//
// Usage:
//   const { latestByNode, connected } = useSocket();
//   // latestByNode = { "inlet": {...}, "outlet": {...}, "solenoid_valves": {...} }

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { BACKEND_URL, type Reading } from '@/lib/api';

export interface SocketReading {
  node_id: string;
  co2: number;
  temperature: number;
  humidity: number;
  timestamp: string;
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
}

const MAX_BUFFER = 120; // keep last 120 data points per node (~10 min at 5s interval)

export function useSocket(): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [latestByNode, setLatestByNode] = useState<Record<string, SocketReading>>({});
  const [recentReadings, setRecentReadings] = useState<SocketReading[]>([]);
  const [recentByNode, setRecentByNode] = useState<Record<string, SocketReading[]>>({});

  const handleUpdate = useCallback((data: SocketReading) => {
    // Update latest per node
    setLatestByNode(prev => ({ ...prev, [data.node_id]: data }));

    // Append to global rolling buffer
    setRecentReadings(prev => {
      const next = [...prev, data];
      return next.length > MAX_BUFFER * 3 ? next.slice(-MAX_BUFFER * 3) : next;
    });

    // Append to per-node rolling buffer
    setRecentByNode(prev => {
      const nodeArr = prev[data.node_id] || [];
      const next = [...nodeArr, data];
      return {
        ...prev,
        [data.node_id]: next.length > MAX_BUFFER ? next.slice(-MAX_BUFFER) : next,
      };
    });
  }, []);

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected to backend');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('[WS] Disconnected from backend');
      setConnected(false);
    });

    socket.on('co2_update', handleUpdate);

    return () => {
      socket.off('co2_update', handleUpdate);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [handleUpdate]);

  return { connected, latestByNode, recentReadings, recentByNode };
}
