export interface FirmwareRelease {
  id: number;
  version: string;
  profile: string;
  hardware: string;
  enabled: boolean;
  verified: boolean;
  commit: string;
  created_at: string;
}
export interface FleetDevice {
  device_id: string;
  profile: string;
  hardware: string;
  enabled: boolean;
  reported_version: string;
  reported_status: string;
  maintenance: boolean;
  last_seen: string | null;
  contact: "never_seen" | "recent" | "stale";
  desired_release: FirmwareRelease | null;
  approval_generation: number;
}
export interface FleetPage<T> {
  count: number;
  page: number;
  next_page: number | null;
  results: T[];
}
export interface FirmwareEvent {
  kind: "approval" | "report";
  timestamp: string;
  version: string | null;
  status?: string;
  maintenance?: boolean;
  generation?: number;
  actor?: string;
}
export function compatibleRelease(device: FleetDevice, release: FirmwareRelease) {
  return (
    release.enabled &&
    release.verified &&
    release.profile === device.profile &&
    release.hardware === device.hardware
  );
}
