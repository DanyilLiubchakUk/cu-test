import { CodexAppServer, type AppServerEvent } from "./app-server.ts";
import { compilePrompt, normalizeSpec, validateSpec } from "../shared/prompt.js";

type RunRecord = {
  id: string;
  name: string;
  status: "starting" | "running" | "completed" | "failed" | "interrupted";
  createdAt: string;
  updatedAt: string;
  threadId: string | null;
  turnId: string | null;
  prompt: string;
  spec: any;
  events: AppServerEvent[];
  finalMessage: string;
  error?: string;
};

export type BridgeOptions = {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  cwd?: string;
  quiet?: boolean;
};

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

function getMime(pathname: string) {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

export async function startBridge(options: BridgeOptions = {}) {
  const host = options.host || "127.0.0.1";
  const port = options.port ?? 4318;
  const cwd = options.cwd || process.cwd();
  const pairCode = crypto.randomUUID().replaceAll("-", "");
  const appServer = new CodexAppServer();
  const runs = new Map<string, RunRecord>();
  const ownOrigins = new Set(options.allowedOrigins || []);

  function corsHeaders(request: Request) {
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Private-Network": "true",
      "Vary": "Origin",
    };
    if (origin && ownOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    return headers;
  }

  function authorized(request: Request) {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    const localOrigins = new Set([
      `http://127.0.0.1:${server.port}`,
      `http://localhost:${server.port}`,
    ]);
    if (request.headers.get("sec-fetch-site") === "same-origin") return true;
    if (!origin && referer && [...localOrigins].some((localOrigin) => referer.startsWith(`${localOrigin}/`))) return true;
    if (origin && ownOrigins.has(origin) && localOrigins.has(origin)) return true;
    return request.headers.get("authorization") === `Bearer ${pairCode}`;
  }

  function applyRunEvent(event: AppServerEvent) {
    const threadId = event.params?.threadId || event.params?.thread?.id;
    for (const run of runs.values()) {
      if (threadId && run.threadId && threadId !== run.threadId) continue;
      if (!run.threadId && threadId) continue;
      run.events.push(event);
      if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
      run.updatedAt = new Date().toISOString();

      if (event.method === "item/agentMessage/delta") {
        run.finalMessage += event.params?.delta || "";
      }
      if (event.method === "turn/completed") {
        const status = event.params?.turn?.status || "completed";
        run.status = status === "failed" ? "failed" : status === "interrupted" ? "interrupted" : "completed";
      }
    }
  }

  appServer.onEvent(applyRunEvent);

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
      const url = new URL(request.url);
      const cors = corsHeaders(request);

      if (request.method === "OPTIONS") {
        const origin = request.headers.get("origin");
        if (origin && !ownOrigins.has(origin)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: cors });
      }

      if (url.pathname.startsWith("/api/")) {
        if (!authorized(request)) return json({ error: "Pairing code required or origin not allowed." }, { status: 401, headers: cors });
        try {
          if (request.method === "GET" && url.pathname === "/api/status") {
            const codex = await appServer.status(cwd);
            return json({ bridge: true, version: "0.1.0", codex, cwd }, { headers: cors });
          }

          if (request.method === "POST" && url.pathname === "/api/prompt") {
            const body = await request.json();
            const spec = normalizeSpec(body);
            const errors = validateSpec(spec);
            if (errors.length) return json({ errors }, { status: 422, headers: cors });
            return json({ prompt: compilePrompt(spec), spec }, { headers: cors });
          }

          if (request.method === "POST" && url.pathname === "/api/run") {
            const spec = normalizeSpec(await request.json());
            const errors = validateSpec(spec);
            if (errors.length) return json({ errors }, { status: 422, headers: cors });
            const prompt = compilePrompt(spec);
            const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
            const now = new Date().toISOString();
            const run: RunRecord = {
              id,
              name: spec.name,
              status: "starting",
              createdAt: now,
              updatedAt: now,
              threadId: null,
              turnId: null,
              prompt,
              spec,
              events: [],
              finalMessage: "",
            };
            runs.set(id, run);
            try {
              const started = await appServer.startTurn(prompt, { cwd: spec.environment?.cwd || cwd });
              run.threadId = started.threadId;
              run.turnId = started.turnId;
              run.status = "running";
              run.updatedAt = new Date().toISOString();
              return json({ run }, { status: 201, headers: cors });
            } catch (error: any) {
              run.status = "failed";
              run.error = error.message;
              return json({ error: error.message, run }, { status: 500, headers: cors });
            }
          }

          if (request.method === "GET" && url.pathname === "/api/runs") {
            return json({ runs: [...runs.values()].reverse().map((run) => ({ ...run, events: run.events.slice(-50) })) }, { headers: cors });
          }

          const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
          if (request.method === "GET" && runMatch) {
            const run = runs.get(decodeURIComponent(runMatch[1]));
            return run ? json({ run }, { headers: cors }) : json({ error: "Run not found." }, { status: 404, headers: cors });
          }

          const stopMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stop$/);
          if (request.method === "POST" && stopMatch) {
            const run = runs.get(decodeURIComponent(stopMatch[1]));
            if (!run?.threadId || !run.turnId) return json({ error: "Run is not active." }, { status: 409, headers: cors });
            await appServer.interrupt(run.threadId, run.turnId);
            return json({ ok: true }, { headers: cors });
          }

          if (request.method === "GET" && url.pathname === "/api/approvals") {
            return json({ approvals: appServer.listApprovals() }, { headers: cors });
          }

          const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
          if (request.method === "POST" && approvalMatch) {
            const body = await request.json();
            const rawId = decodeURIComponent(approvalMatch[1]);
            const id = /^\d+$/.test(rawId) ? Number(rawId) : rawId;
            appServer.answerApproval(id, body.action, Boolean(body.session));
            return json({ ok: true }, { headers: cors });
          }

          return json({ error: "Not found." }, { status: 404, headers: cors });
        } catch (error: any) {
          return json({ error: error.message || "Unexpected bridge error." }, { status: 500, headers: cors });
        }
      }

      const staticFiles: Record<string, string> = {
        "/": "web/index.html",
        "/index.html": "web/index.html",
        "/styles.css": "web/styles.css",
        "/app.js": "web/app.js",
        "/prompt.js": "shared/prompt.js",
      };
      const relative = staticFiles[url.pathname];
      if (!relative) return new Response("Not found", { status: 404 });
      const file = Bun.file(new URL(`../${relative}`, import.meta.url));
      return new Response(file, {
        headers: {
          "Content-Type": getMime(url.pathname === "/" ? ".html" : url.pathname),
          "Cache-Control": url.pathname === "/" ? "no-cache" : "public, max-age=60",
        },
      });
    },
  });

  ownOrigins.add(`http://127.0.0.1:${server.port}`);
  ownOrigins.add(`http://localhost:${server.port}`);

  const stop = () => {
    appServer.close();
    server.stop(true);
  };
  const stopFromSignal = () => {
    stop();
    process.exit(0);
  };
  process.once("SIGINT", stopFromSignal);
  process.once("SIGTERM", stopFromSignal);

  if (!options.quiet) {
    console.log(`\n  CU Test is ready`);
    console.log(`  Web:       http://${host}:${server.port}`);
    console.log(`  Pair code: ${pairCode}`);
    if (options.allowedOrigins?.length) console.log(`  Allowed:   ${options.allowedOrigins.join(", ")}`);
    console.log(`\n  Keep this terminal open while the web app is connected.\n`);
  }

  return { server, appServer, pairCode, url: `http://${host}:${server.port}`, stop };
}
