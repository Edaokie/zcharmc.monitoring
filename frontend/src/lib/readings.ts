interface ReadingIdentity {
  id?: number;
  message_id?: string | null;
  node_id: string;
  timestamp: string;
}

/** Match the API's measurement-time ordering, with database ID as a tie breaker. */
export function compareReadings(a: ReadingIdentity, b: ReadingIdentity): number {
  return Date.parse(a.timestamp) - Date.parse(b.timestamp) || (a.id ?? 0) - (b.id ?? 0);
}

/** Reconnects replay saved readings; delayed uploads belong at their measurement time. */
export function mergeReading<T extends ReadingIdentity>(
  readings: T[],
  incoming: T,
  limit: number,
): T[] {
  const duplicate = readings.some((reading) => {
    if (reading.node_id !== incoming.node_id) return false;
    if (incoming.id !== undefined) return reading.id === incoming.id;
    if (incoming.message_id) return reading.message_id === incoming.message_id;
    return reading.timestamp === incoming.timestamp;
  });
  if (duplicate) return readings;
  return [...readings, incoming].sort(compareReadings).slice(-limit);
}
