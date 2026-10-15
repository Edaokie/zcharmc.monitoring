import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/http";
import { type BenchDevice, type BenchReading, benchValues } from "@/lib/bench";
import type { FleetPage } from "@/lib/firmware";

export const Route = createFileRoute("/_app/bench")({ component: BenchPage });
const button =
  "rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-40";
const when = (value: string | null) => (value ? new Date(value).toLocaleString() : "Not reported");
function BenchPage() {
  const { user } = useAuth();
  const allowed = Boolean(user?.can_manage_firmware);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FleetPage<BenchDevice> | null>(null);
  const [selected, setSelected] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [history, setHistory] = useState<FleetPage<BenchReading> | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    if (!allowed) return;
    const timer = setInterval(() => {
      if (!document.hidden) setRevision((value) => value + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, [allowed]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiRequest<FleetPage<BenchDevice>>(`/api/firmware/bench?page=${page}`, {
      signal: controller.signal,
    })
      .then((rows) => {
        if (!controller.signal.aborted) {
          setData(rows);
          setUpdated(new Date().toISOString());
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Could not load bench readings.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [allowed, page, revision]);
  useEffect(() => {
    if (!allowed || !selected) return;
    const controller = new AbortController();
    setHistory(null);
    setHistoryError(null);
    setHistoryLoading(true);
    apiRequest<FleetPage<BenchReading>>(
      `/api/firmware/devices/${encodeURIComponent(selected)}/test-readings?page=${historyPage}`,
      { signal: controller.signal },
    )
      .then((rows) => {
        if (!controller.signal.aborted) setHistory(rows);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setHistoryError(cause instanceof Error ? cause.message : "History unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [allowed, selected, historyPage, revision]);
  if (!allowed)
    return (
      <section className="p-6">
        <h1 className="text-2xl font-semibold">Bench simulation</h1>
        <p className="mt-3">An authorized firmware staff account is required.</p>
      </section>
    );
  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bench simulation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Static test data from provisioned ESP32 boards. Refreshes every 15 seconds.
          </p>
        </div>
        <button
          className={button}
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </button>
      </header>
      <div className="border border-amber-500 rounded-sm p-4 bg-amber-50 text-amber-950">
        <strong>SIMULATED DATA — no connected sensors or actuator commands.</strong>
        <p className="text-sm mt-1">
          These readings are separate from research charts. Closed/Open describes a simulated state,
          not physical equipment.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Last successful refresh: {when(updated)}. Latest means most recently received; inspect
        measurement time when testing an offline backlog.
      </p>
      {error && (
        <p role="alert" className="text-destructive">
          {error} Previously loaded data may be stale.
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm">
          Loading bench readings…
        </p>
      )}
      <div className="grid xl:grid-cols-3 gap-4">
        {data?.results.map((device) => (
          <section
            className="border border-border rounded-sm p-4 space-y-3 min-w-0"
            key={device.device_id}
          >
            <div>
              <h2 className="font-semibold break-all">{device.device_id}</h2>
              <p className="text-xs text-muted-foreground">
                {device.profile} · Firmware {device.reported_version || "not reported"}
              </p>
            </div>
            <p className="text-sm">
              {!device.enabled
                ? "Device disabled"
                : !device.allow_test_telemetry
                  ? "Test uploads disabled — enable in Django admin"
                  : "Test uploads enabled"}
            </p>
            <p className="text-xs">Device status received: {when(device.last_seen)}</p>
            {device.latest ? (
              <>
                <p className="text-xs">
                  Measurement: {when(device.latest.payload.timestamp)}
                  <br />
                  Received: {when(device.latest.received_at)}
                </p>
                <dl className="divide-y divide-border">
                  {benchValues(device.latest.payload).map((row) => (
                    <div key={row.label} className="flex justify-between gap-3 py-1 text-sm">
                      <dt>{row.label}</dt>
                      <dd className="text-right">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="font-mono text-xs break-all">{device.latest.payload.message_id}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No simulated reading received. Check provisioning, 2.4 GHz Wi-Fi, clock
                synchronization and test-upload opt-in.
              </p>
            )}
            <button
              className={button}
              onClick={() => {
                setSelected(device.device_id);
                setHistoryPage(1);
              }}
            >
              View history
            </button>
          </section>
        ))}
      </div>
      {data?.results.length === 0 && (
        <p>No provisioned devices found. Create inlet, outlet and control identities first.</p>
      )}
      <Pager page={page} next={data?.next_page ?? null} disabled={loading} onPage={setPage} />
      {selected && (
        <section className="border border-border rounded-sm p-4 space-y-3">
          <div className="flex justify-between gap-3">
            <h2 className="font-semibold break-all">{selected} — received test history</h2>
            <button className={button} onClick={() => setSelected("")}>
              Close history
            </button>
          </div>
          {historyLoading && <p role="status">Loading history…</p>}
          {historyError && (
            <p role="alert" className="text-destructive">
              {historyError}
            </p>
          )}
          {history?.results.length === 0 && <p>No recorded test readings.</p>}
          <ol className="divide-y divide-border">
            {history?.results.map((row) => (
              <li key={row.payload.message_id} className="py-3 text-sm">
                <p>
                  Measured {when(row.payload.timestamp)} · Received {when(row.received_at)}
                </p>
                <p className="font-mono text-xs break-all">{row.payload.message_id}</p>
                <p className="mt-1">
                  {benchValues(row.payload)
                    .map((value) => `${value.label}: ${value.value}`)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ol>
          <Pager
            page={historyPage}
            next={history?.next_page ?? null}
            disabled={historyLoading}
            onPage={setHistoryPage}
          />
        </section>
      )}
    </div>
  );
}
function Pager({
  page,
  next,
  disabled,
  onPage,
}: {
  page: number;
  next: number | null;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex gap-3 items-center text-sm">
      <button className={button} disabled={disabled || page === 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>Page {page}</span>
      <button
        className={button}
        disabled={disabled || next === null}
        onClick={() => next && onPage(next)}
      >
        Next
      </button>
    </div>
  );
}
