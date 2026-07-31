import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge } from "../src/bridge.ts";

let bridge: Awaited<ReturnType<typeof startBridge>>;

beforeAll(async () => {
  bridge = await startBridge({ port: 0, quiet: true, allowedOrigins: ["https://example.vercel.app"] });
});

afterAll(() => bridge?.stop());

describe("local bridge", () => {
  test("serves the web app", async () => {
    const response = await fetch(`${bridge.url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("What should Codex test?");
  });

  test("serves search and install metadata", async () => {
    const [icon, manifest, robots, sitemap] = await Promise.all([
      fetch(`${bridge.url}/favicon.svg`),
      fetch(`${bridge.url}/site.webmanifest`),
      fetch(`${bridge.url}/robots.txt`),
      fetch(`${bridge.url}/sitemap.xml`),
    ]);
    expect(icon.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(manifest.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(await robots.text()).toContain("Sitemap:");
    expect(await sitemap.text()).toContain("cu-test-beta.vercel.app");
  });

  test("requires pairing for cross-origin API calls", async () => {
    const response = await fetch(`${bridge.url}/api/prompt`, {
      method: "POST",
      headers: { Origin: "https://example.vercel.app", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://example.vercel.app");
  });

  test("answers browser private-network preflights", async () => {
    const response = await fetch(`${bridge.url}/api/status`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.vercel.app",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
  });

  test("compiles through the authenticated API", async () => {
    const response = await fetch(`${bridge.url}/api/prompt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bridge.pairCode}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "API run", target: { startUrl: "https://example.com" } }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).prompt).toContain("API run");
  });

  test("allows a local same-origin browser request without pairing", async () => {
    const response = await fetch(`${bridge.url}/api/prompt`, {
      method: "POST",
      headers: {
        Referer: `${bridge.url}/`,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Local run", target: { startUrl: "https://example.com" } }),
    });
    expect(response.status).toBe(200);
  });
});
