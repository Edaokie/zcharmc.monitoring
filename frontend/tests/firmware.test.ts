import assert from "node:assert/strict";
import { test } from "node:test";
import { compatibleRelease, type FleetDevice, type FirmwareRelease } from "../src/lib/firmware.ts";
import { apiRequest, setCsrfToken, ApiError } from "../src/lib/http.ts";

test("release selection rejects unverified, disabled, wrong-role and wrong-hardware images", () => {
  const device = { profile: "control", hardware: "board-a" } as FleetDevice;
  const release = {
    enabled: true,
    verified: true,
    profile: "control",
    hardware: "board-a",
  } as FirmwareRelease;
  assert.equal(compatibleRelease(device, release), true);
  for (const mismatch of [
    { enabled: false },
    { verified: false },
    { profile: "inlet" },
    { hardware: "board-b" },
  ]) {
    assert.equal(compatibleRelease(device, { ...release, ...mismatch }), false);
  }
});

test("browser requests use the same-origin session proxy, CSRF and no-store", async (t) => {
  let captured: { url: string; options: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    captured = { url, options };
    return Response.json({ approval_generation: 2 });
  });
  setCsrfToken("test-csrf");
  const result = await apiRequest<{ approval_generation: number }>(
    "/api/firmware/devices/test/target",
    {
      method: "POST",
      body: JSON.stringify({ expected_generation: 1, release_id: 2 }),
    },
  );
  assert.equal(result.approval_generation, 2);
  assert.equal(captured?.url, "/backend/api/firmware/devices/test/target");
  assert.equal(captured?.options.credentials, "same-origin");
  assert.equal(captured?.options.cache, "no-store");
  assert.equal(new Headers(captured?.options.headers).get("X-CSRFToken"), "test-csrf");
  assert.equal(new Headers(captured?.options.headers).has("Authorization"), false);
});

test("a stale approval remains an error with its backend status", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ detail: "Device changed. Refresh." }, { status: 409 }),
  );
  await assert.rejects(
    apiRequest("/api/firmware/devices/test/target", { method: "POST", body: "{}" }),
    (error: unknown) =>
      error instanceof ApiError && error.status === 409 && error.message.includes("Refresh"),
  );
});
