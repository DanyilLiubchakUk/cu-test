#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CodexAppServer } from "./app-server.ts";
import { startBridge } from "./bridge.ts";
import { compilePrompt, defaultSpec, normalizeSpec, validateSpec } from "../shared/prompt.js";

const args = process.argv.slice(2);
const command = args[0] || "help";

function flag(name: string, fallback?: string) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function values(name: string) {
  const output: string[] = [];
  args.forEach((arg, index) => {
    if (arg === `--${name}` && args[index + 1]) output.push(args[index + 1]);
  });
  return output;
}

function printHelp() {
  console.log(`CU Test — plan and run Codex Computer Use test sessions

Usage:
  cu-test web [--port 4318] [--allow-origin https://site.vercel.app]
  cu-test bridge [--port 4318] [--allow-origin https://site.vercel.app]
  cu-test new
  cu-test prompt <spec.json>
  cu-test validate <spec.json>
  cu-test run <spec.json> [--model MODEL]
  cu-test status
  cu-test skill-path
  cu-test help

No npm install or npx command is required.`);
}

async function readSpec(path: string) {
  if (!path) throw new Error("A specification JSON path is required.");
  return normalizeSpec(await Bun.file(resolve(path)).json());
}

async function interactiveNew() {
  const rl = createInterface({ input, output });
  try {
    console.log("\nCU Test / new session\n");
    const modeAnswer = (await rl.question("Choose 1 for guided fields or 2 for a custom prompt [1]: ")).trim();
    const mode = modeAnswer === "2" ? "custom" : "guided";
    const spec: any = defaultSpec();
    spec.mode = mode;
    spec.name = (await rl.question("Run name: ")).trim() || "Untitled test run";

    if (mode === "custom") {
      spec.customPrompt = await rl.question("Full prompt (single line; edit the JSON later for multiline): ");
    } else {
      spec.target.type = (await rl.question("Target type [website/simulator/desktop-app/mixed]: ")).trim() || "website";
      spec.target.name = (await rl.question("Target name: ")).trim();
      spec.target.startUrl = (await rl.question("Starting URL/location: ")).trim();
      spec.target.launchInstructions = (await rl.question("Launch instructions: ")).trim();
      spec.environment.cwd = (await rl.question(`Working directory [${process.cwd()}]: `)).trim() || process.cwd();
      spec.environment.description = (await rl.question("Environment description: ")).trim();
      spec.environment.devices = split(await rl.question("Devices/simulators (comma-separated): "));
      spec.environment.emailInbox = (await rl.question("Verification inbox/helper URL: ")).trim();
      spec.testing.personas = split(await rl.question("Personas (comma-separated): "));
      spec.testing.include = split(await rl.question("Things to test (semicolon-separated): "), ";");
      spec.testing.exclude = split(await rl.question("Never touch (semicolon-separated): "), ";");
      const duration = Number((await rl.question("Maximum minutes [120]: ")).trim() || 120);
      spec.testing.maxDurationMinutes = duration;
      spec.video.enabled = !/^n/i.test(await rl.question("Record and edit video? [Y/n]: "));
      spec.report.formats = split(await rl.question("Report formats [markdown]: "));
      if (!spec.report.formats.length) spec.report.formats = ["markdown"];
    }

    const errors = validateSpec(spec);
    if (errors.length) throw new Error(errors.join("\n"));
    const destination = resolve((await rl.question("Save as [cu-test-spec.json]: ")).trim() || "cu-test-spec.json");
    await writeFile(destination, `${JSON.stringify(spec, null, 2)}\n`);
    console.log(`\nSaved ${destination}`);
    console.log(`Preview: cu-test prompt ${JSON.stringify(destination)}`);
    console.log(`Run:     cu-test run ${JSON.stringify(destination)}\n`);
  } finally {
    rl.close();
  }
}

function split(value: string, separator = ",") {
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

async function runSpec(path: string) {
  const spec = await readSpec(path);
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(errors.join("\n"));
  const prompt = compilePrompt(spec);
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
  const runDir = resolve(".cu-test", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(runDir, "specification.json"), `${JSON.stringify(spec, null, 2)}\n`),
    writeFile(resolve(runDir, "generated-prompt.md"), `${prompt}\n`),
  ]);

  const appServer = new CodexAppServer();
  let finished = false;
  let outcome = "unknown";
  let finalMessage = "";
  const eventLines: string[] = [];
  appServer.onEvent((event) => {
    eventLines.push(JSON.stringify(event));
    if (event.method === "item/agentMessage/delta") {
      const delta = event.params?.delta || "";
      finalMessage += delta;
      process.stdout.write(delta);
    }
    if (event.method === "bridge/approvalRequested") {
      console.error(`\nApproval required. Open the task in Codex, or use the web UI to review it: ${event.params?.method}`);
    }
    if (event.method === "turn/completed") {
      outcome = event.params?.turn?.status || "completed";
      finished = true;
    }
  });

  try {
    console.log(`Starting ${spec.name}…\n`);
    const started = await appServer.startTurn(prompt, {
      cwd: spec.environment?.cwd || process.cwd(),
      model: flag("model"),
    });
    console.log(`Codex task: codex://threads/${started.threadId}\n`);
    while (!finished) await Bun.sleep(250);
    await Promise.all([
      writeFile(resolve(runDir, "app-server-events.jsonl"), `${eventLines.join("\n")}\n`),
      writeFile(resolve(runDir, "codex-final.md"), `${finalMessage}\n`),
    ]);
    console.log(`\n\nFinished: ${outcome}`);
    console.log(`Artifacts: ${runDir}`);
    process.exitCode = outcome === "completed" ? 0 : 1;
  } finally {
    appServer.close();
  }
}

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "web" || command === "bridge") {
    await startBridge({
      host: flag("host", "127.0.0.1"),
      port: Number(flag("port", "4318")),
      allowedOrigins: [...values("allow-origin"), ...split(process.env.CU_TEST_ALLOWED_ORIGINS || "")],
      cwd: flag("cwd", process.cwd()),
    });
    await new Promise(() => {});
  } else if (command === "new") {
    await interactiveNew();
  } else if (command === "prompt") {
    console.log(compilePrompt(await readSpec(args[1])));
  } else if (command === "validate") {
    const errors = validateSpec(await readSpec(args[1]));
    if (errors.length) throw new Error(errors.join("\n"));
    console.log("Specification is valid.");
  } else if (command === "run") {
    await runSpec(args[1]);
  } else if (command === "status") {
    const appServer = new CodexAppServer();
    try {
      console.log(JSON.stringify(await appServer.status(process.cwd()), null, 2));
    } finally {
      appServer.close();
    }
  } else if (command === "skill-path") {
    console.log(new URL("../skills/cu-test", import.meta.url).pathname);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error: any) {
  console.error(`\nCU Test error: ${error.message}\n`);
  process.exitCode = 1;
}
