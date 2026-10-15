import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/http";
import {
  compatibleRelease,
  type FleetDevice,
  type FleetPage,
  type FirmwareEvent,
  type FirmwareRelease,
} from "@/lib/firmware";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/firmware")({ component: FirmwarePage });
const button =
  "border border-border rounded-sm px-3 py-2 text-sm hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";
const primary = `${button} bg-foreground text-background hover:bg-foreground/90`;
const when = (timestamp: string | null) =>
  timestamp ? new Date(timestamp).toLocaleString() : "Never reported";
type Action =
  | { kind: "assign" | "withdraw" | "retry"; device: FleetDevice; release: FirmwareRelease | null }
  | { kind: "enable"; release: FirmwareRelease };

function FirmwarePage() {
  const { user, refresh } = useAuth();
  const allowed = Boolean(user?.can_manage_firmware);
  const [tab, setTab] = useState<"devices" | "releases">("devices");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [devicePage, setDevicePage] = useState(1);
  const [releasePage, setReleasePage] = useState(1);
  const [devices, setDevices] = useState<FleetPage<FleetDevice> | null>(null);
  const [releases, setReleases] = useState<FleetPage<FirmwareRelease> | null>(null);
  const [selected, setSelected] = useState<FleetDevice | null>(null);
  const [choices, setChoices] = useState<FirmwareRelease[]>([]);
  const [choicePage, setChoicePage] = useState(1);
  const [moreChoices, setMoreChoices] = useState<number | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [choiceLoading, setChoiceLoading] = useState(false);
  const [releaseId, setReleaseId] = useState("");
  const [events, setEvents] = useState<FirmwareEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      apiRequest<FleetPage<FleetDevice>>(
        `/api/firmware/devices?page=${devicePage}&search=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      ),
      apiRequest<FleetPage<FirmwareRelease>>(`/api/firmware/releases?page=${releasePage}`, {
        signal: controller.signal,
      }),
    ])
      .then(([deviceRows, releaseRows]) => {
        if (controller.signal.aborted) return;
        setDevices(deviceRows);
        setReleases(releaseRows);
        setSelected((current) =>
          current
            ? (deviceRows.results.find((device) => device.device_id === current.device_id) ??
              current)
            : null,
        );
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Firmware data could not be loaded.");
        setDevices(null);
        setReleases(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [allowed, devicePage, releasePage, query, revision]);

  useEffect(() => {
    if (!allowed || !selected) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    setEvents([]);
    apiRequest<{ events: FirmwareEvent[] }>(
      `/api/firmware/devices/${encodeURIComponent(selected.device_id)}/history`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) setEvents(data.events);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setHistoryError(cause instanceof Error ? cause.message : "History unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [allowed, selected, revision]);

  useEffect(() => {
    if (!allowed || !selected) return;
    const controller = new AbortController();
    setChoiceLoading(true);
    setChoiceError(null);
    if (choicePage === 1) setChoices([]);
    const params = new URLSearchParams({
      profile: selected.profile,
      hardware: selected.hardware,
      page: String(choicePage),
    });
    apiRequest<FleetPage<FirmwareRelease>>(`/api/firmware/releases?${params}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const eligible = data.results.filter((release) => compatibleRelease(selected, release));
        setChoices((current) =>
          choicePage === 1
            ? eligible
            : [
                ...current,
                ...eligible.filter((item) => !current.some((existing) => existing.id === item.id)),
              ],
        );
        setMoreChoices(data.next_page);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setChoiceError(cause instanceof Error ? cause.message : "Releases unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setChoiceLoading(false);
      });
    return () => controller.abort();
  }, [allowed, selected, choicePage, revision]);

  function review(next: Action) {
    setAction(next);
    setConfirmed(false);
    setOperationError(null);
  }
  async function approve() {
    if (!action) return;
    setBusy(true);
    setOperationError(null);
    try {
      if (action.kind === "enable") {
        await apiRequest(`/api/firmware/releases/${action.release.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !action.release.enabled }),
        });
        toast.success(
          action.release.enabled
            ? "Release disabled for future polls."
            : "Release enabled. No devices were assigned.",
        );
      } else {
        const retry = action.kind === "retry";
        const payload = {
          expected_generation: action.device.approval_generation,
          maintenance_confirmed: confirmed,
          ...(!retry ? { release_id: action.kind === "withdraw" ? null : action.release?.id } : {}),
        };
        const device = await apiRequest<FleetDevice>(
          `/api/firmware/devices/${encodeURIComponent(action.device.device_id)}/${retry ? "retry" : "target"}`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        setSelected(device);
        toast.success(
          action.kind === "withdraw"
            ? "Target withdrawn for future polls."
            : "Approval recorded. Wait for the device report to confirm its version.",
        );
      }
      setAction(null);
      setChoicePage(1);
      setReleaseId("");
      setRevision((value) => value + 1);
    } catch (cause) {
      setOperationError(cause instanceof Error ? cause.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!allowed)
    return (
      <section className="p-8 space-y-3">
        <h1 className="text-2xl font-semibold">Firmware</h1>
        <p>Firmware management requires an authorized staff account.</p>
        <button className={button} onClick={() => void refresh()}>
          Check account permissions
        </button>
      </section>
    );
  const picked = choices.find((release) => String(release.id) === releaseId);
  const requiresMaintenance =
    action &&
    action.kind !== "enable" &&
    action.kind !== "withdraw" &&
    action.device.profile === "control";
  return (
    <div className="p-3 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Firmware</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review releases and approve updates for individual devices.
          </p>
        </div>
        <button
          className={button}
          disabled={loading || busy}
          onClick={() => {
            setChoicePage(1);
            setRevision((value) => value + 1);
          }}
        >
          Refresh
        </button>
      </header>
      <p className="text-sm text-muted-foreground">
        Start with one disconnected bench board. Version and status are device reports; download
        percentage and detailed failure causes are not available.
      </p>
      <div className="flex gap-2" role="group" aria-label="Firmware views">
        <button
          aria-pressed={tab === "devices"}
          className={tab === "devices" ? primary : button}
          onClick={() => setTab("devices")}
        >
          Devices
        </button>
        <button
          aria-pressed={tab === "releases"}
          className={tab === "releases" ? primary : button}
          onClick={() => setTab("releases")}
        >
          Releases
        </button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}{" "}
          <button className="underline" onClick={() => void refresh()}>
            Check session
          </button>
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading firmware data…
        </p>
      )}
      {tab === "devices" ? (
        <>
          <form
            className="flex gap-2 items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setDevicePage(1);
              setQuery(search);
            }}
          >
            <label className="text-sm">
              Device ID
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="block border border-border rounded-sm px-3 py-2 mt-1"
              />
            </label>
            <button className={button}>Search</button>
          </form>
          <div className="border border-border rounded-sm overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Role / hardware</TableHead>
                  <TableHead>Running / target version</TableHead>
                  <TableHead>Reported status</TableHead>
                  <TableHead>Last contact</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices?.results.map((device) => (
                  <TableRow key={device.device_id}>
                    <TableCell>
                      <button
                        className="font-medium underline"
                        disabled={busy}
                        onClick={() => {
                          setSelected(device);
                          setChoicePage(1);
                          setReleaseId("");
                        }}
                      >
                        {device.device_id}
                      </button>
                      {!device.enabled && (
                        <span className="block text-muted-foreground">Disabled</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {device.profile}
                      <span className="block text-xs text-muted-foreground">{device.hardware}</span>
                    </TableCell>
                    <TableCell>
                      {device.reported_version || "Not reported"}
                      <span className="block text-xs text-muted-foreground">
                        Target: {device.desired_release?.version || "None"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {device.reported_status || "Not reported"}
                      <span className="block text-xs text-muted-foreground">
                        {device.maintenance ? "Maintenance reported" : "Maintenance not reported"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {device.contact.replaceAll("_", " ")}
                      <span className="block text-xs text-muted-foreground">
                        {when(device.last_seen)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {devices?.results.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      No devices found. Create device identities through the provisioning command.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={devicePage}
            count={devices?.count ?? 0}
            next={devices?.next_page ?? null}
            disabled={loading || busy}
            onPage={setDevicePage}
          />
          {selected && !error && (
            <section className="border border-border rounded-sm p-3 sm:p-5 space-y-4">
              <div className="flex justify-between gap-3">
                <h2 className="font-semibold">{selected.device_id}</h2>
                <button
                  className="underline text-sm"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  Close details
                </button>
              </div>
              <p className="text-sm">
                {selected.profile} · {selected.hardware} · Approval generation{" "}
                {selected.approval_generation}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm min-w-0">
                  Compatible enabled release
                  <select
                    className="block border border-border bg-background rounded-sm p-2 mt-1 max-w-full"
                    value={releaseId}
                    onChange={(event) => setReleaseId(event.target.value)}
                    disabled={choiceLoading || busy}
                  >
                    <option value="">Select a release</option>
                    {choices.map((release) => (
                      <option key={release.id} value={release.id}>
                        {release.version} · {release.commit.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={primary}
                  disabled={
                    !picked || !selected.enabled || busy || choiceLoading || Boolean(choiceError)
                  }
                  onClick={() =>
                    picked && review({ kind: "assign", device: selected, release: picked })
                  }
                >
                  Review update
                </button>
                <button
                  className={button}
                  disabled={!selected.desired_release || busy}
                  onClick={() =>
                    review({
                      kind: "withdraw",
                      device: selected,
                      release: selected.desired_release,
                    })
                  }
                >
                  Withdraw target
                </button>
                <button
                  className={button}
                  disabled={
                    !selected.desired_release ||
                    busy ||
                    selected.reported_version === selected.desired_release.version
                  }
                  onClick={() =>
                    review({ kind: "retry", device: selected, release: selected.desired_release })
                  }
                >
                  Review another attempt
                </button>
              </div>
              {choiceLoading && (
                <p role="status" className="text-sm">
                  Loading compatible releases…
                </p>
              )}
              {choiceError && (
                <p role="alert" className="text-destructive text-sm">
                  {choiceError}
                </p>
              )}
              {moreChoices && (
                <button
                  className={button}
                  disabled={choiceLoading}
                  onClick={() => setChoicePage(moreChoices)}
                >
                  Load more releases
                </button>
              )}
              <p className="text-xs text-muted-foreground">
                Only enabled, verified releases with matching role and hardware appear. Withdrawal
                affects future polls and cannot cancel an installation already underway.
              </p>
              <h3 className="text-sm font-semibold">Recent approvals and device state changes</h3>
              {historyLoading ? (
                <p role="status" className="text-sm">
                  Loading history…
                </p>
              ) : historyError ? (
                <p role="alert" className="text-destructive text-sm">
                  {historyError}
                </p>
              ) : events.length ? (
                <ol className="divide-y divide-border">
                  {events.map((event, index) => (
                    <li key={`${event.timestamp}-${event.kind}-${index}`} className="py-2 text-sm">
                      <time>{when(event.timestamp)}</time>
                      <span className="block">
                        {event.kind === "approval"
                          ? `Approval ${event.generation}: ${event.version ?? "target withdrawn"} by ${event.actor}`
                          : `${event.version}: ${event.status}${event.maintenance ? " (maintenance reported)" : ""}`}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No recorded events yet. New device state transitions will appear after this
                  backend update.
                </p>
              )}
            </section>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Enabling a release makes it eligible for assignment. Disabling it stops future offers;
            it does not uninstall running firmware.
          </p>
          <div className="border border-border rounded-sm overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version / role</TableHead>
                  <TableHead>Hardware</TableHead>
                  <TableHead>Source commit</TableHead>
                  <TableHead>Verification / availability</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {releases?.results.map((release) => (
                  <TableRow key={release.id}>
                    <TableCell>
                      {release.version}
                      <span className="block text-xs">{release.profile}</span>
                    </TableCell>
                    <TableCell>{release.hardware}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {release.commit || "Unavailable"}
                    </TableCell>
                    <TableCell>
                      {release.verified ? "Signature verified" : "Verification failed"}
                      <span className="block text-xs">
                        {release.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        className={button}
                        disabled={busy || (!release.enabled && !release.verified)}
                        onClick={() => review({ kind: "enable", release })}
                      >
                        {release.enabled ? "Disable" : "Enable"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {releases?.results.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      No releases registered. Publish a signed release through CI/CD.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <Pager
            page={releasePage}
            count={releases?.count ?? 0}
            next={releases?.next_page ?? null}
            disabled={loading || busy}
            onPage={setReleasePage}
          />
        </>
      )}
      <Dialog
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.kind === "enable"
                ? `${action.release.enabled ? "Disable" : "Enable"} release`
                : action?.kind === "withdraw"
                  ? "Withdraw update target"
                  : action?.kind === "retry"
                    ? "Approve another attempt"
                    : "Approve firmware update"}
            </DialogTitle>
            <DialogDescription>
              {action?.kind === "enable"
                ? "This changes release availability. It does not assign devices."
                : action?.kind === "withdraw"
                  ? "This affects future polls. A transfer already underway can continue."
                  : "The device may install and restart on a later poll. An approval does not confirm installation."}
            </DialogDescription>
          </DialogHeader>
          {action && (
            <div className="space-y-3 text-sm">
              <p>
                {action.kind !== "enable" && <strong>{action.device.device_id}: </strong>}
                {action.release
                  ? `${action.release.version} · ${action.release.profile} · ${action.release.hardware}`
                  : "No target"}
              </p>
              {action.kind !== "enable" && (
                <p>Reported version: {action.device.reported_version || "Not reported"}</p>
              )}
              {requiresMaintenance && (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I confirm this control device is on a disconnected bench or in a verified
                  maintenance condition. A recent device maintenance report is also required.
                </label>
              )}
              {operationError && (
                <p role="alert" className="text-destructive">
                  {operationError} Close this dialog and refresh before retrying.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <button className={button} disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </button>
            <button
              className={primary}
              disabled={busy || Boolean(requiresMaintenance && !confirmed)}
              onClick={() => void approve()}
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Pager({
  page,
  count,
  next,
  disabled,
  onPage,
}: {
  page: number;
  count: number;
  next: number | null;
  disabled: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex gap-3 items-center text-sm">
      <button className={button} disabled={disabled || page === 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} · {count} records
      </span>
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
