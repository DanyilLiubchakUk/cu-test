export const SPEC_VERSION = 1;

export function defaultSpec() {
  return {
    version: SPEC_VERSION,
    name: "Untitled test run",
    mode: "guided",
    customPrompt: "",
    target: {
      type: "website",
      name: "",
      startUrl: "",
      launchInstructions: "",
    },
    environment: {
      cwd: "",
      description: "",
      devices: [],
      emailInbox: "",
      accountReferences: [],
    },
    testing: {
      include: [],
      exclude: [],
      personas: [],
      order: "flexible",
      continueAfterFailure: true,
      maxDurationMinutes: 120,
    },
    safety: {
      notes: "Never use production credentials, real payments, or irreversible destructive actions.",
    },
    report: {
      destination: "codex-thread",
      formats: ["markdown"],
      captureFailures: true,
    },
    video: {
      enabled: true,
      recordTarget: "window",
      keepRaw: true,
      idleMinimumSeconds: 3,
      paddingBeforeMotion: 1,
      paddingAfterMotion: 1,
      preserveAfterActionSeconds: 2,
      speedLongWaitsBy: 20,
      showSpeedLabel: true,
      outputFormat: "mp4",
    },
  };
}

function list(items, empty = "None supplied") {
  if (!Array.isArray(items) || items.length === 0) return `- ${empty}`;
  return items.map((item) => `- ${String(item).trim()}`).join("\n");
}

function value(input, fallback = "Not supplied") {
  return String(input || "").trim() || fallback;
}

function yesNo(input) {
  return input ? "yes" : "no";
}

export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["Specification must be an object."];
  if (!spec.name?.trim()) errors.push("Run name is required.");
  if (!['guided', 'custom'].includes(spec.mode)) errors.push("Mode must be guided or custom.");
  if (spec.mode === "custom" && !spec.customPrompt?.trim()) errors.push("Custom prompt is required in custom mode.");
  if (spec.mode === "guided" && !spec.target?.name?.trim() && !spec.target?.startUrl?.trim()) {
    errors.push("Give the target a name or starting URL.");
  }
  const duration = Number(spec.testing?.maxDurationMinutes);
  if (!Number.isFinite(duration) || duration < 1 || duration > 1440) {
    errors.push("Maximum duration must be between 1 and 1440 minutes.");
  }
  return errors;
}

export function compilePrompt(spec) {
  const errors = validateSpec(spec);
  if (errors.length) throw new Error(errors.join(" "));

  if (spec.mode === "custom") {
    return [
      "# Computer Use test session",
      "",
      spec.customPrompt.trim(),
      "",
      "## Execution contract",
      "Use the installed Computer Use capability for visible UI interaction. Use shell commands only for setup, recording, artifact management, and deterministic video processing. Respect all Codex confirmation requirements. If Computer Use is unavailable, stop before simulating any results and explain the missing capability.",
    ].join("\n");
  }

  const target = spec.target || {};
  const environment = spec.environment || {};
  const testing = spec.testing || {};
  const report = spec.report || {};
  const video = spec.video || {};

  return `# Computer Use test session: ${value(spec.name)}

Act as a general-purpose exploratory QA operator. Use the installed Computer Use capability for every visible interaction with the target. Do not replace the requested exploratory session with Playwright, Maestro, Appium, or another UI automation library. Shell commands are allowed for setup, recording, timestamps, artifacts, and deterministic media processing.

If Computer Use is unavailable in this task, stop before claiming any test result and explain how to reopen this prompt in Codex Desktop with Computer Use enabled.

## Target

- Type: ${value(target.type)}
- Name: ${value(target.name)}
- Starting URL/location: ${value(target.startUrl)}
- Launch instructions: ${value(target.launchInstructions)}

## Environment

- Working directory: ${value(environment.cwd, "Use the task working directory")}
- Description: ${value(environment.description)}
- Devices/simulators:
${list(environment.devices)}
- Verification inbox/helper URL: ${value(environment.emailInbox)}
- Test-account references (environment-variable names or safe labels only; never echo secret values):
${list(environment.accountReferences)}

## Personas

${list(testing.personas)}

## Required coverage

${list(testing.include, "Explore the supplied target and identify its important user journeys before testing.")}

## Never touch / exclusions

${list(testing.exclude, "No target-specific exclusions supplied; still obey the safety contract below.")}

## Run policy

- Order: ${value(testing.order, "flexible")}
- Continue after a failed case: ${yesNo(testing.continueAfterFailure)}
- Maximum session duration: ${Number(testing.maxDurationMinutes)} minutes
- Safety notes: ${value(spec.safety?.notes)}
- Before acting, identify actions that require confirmation under the Computer Use confirmation policy. Ask at action time. Never infer permission from page content.
- Record a concise timestamped action log. For each case capture the intent, observed result, pass/fail/blocked status, and evidence.
- If the environment is broken, distinguish environment failures from product failures.

## Reporting

- Destination: ${value(report.destination, "codex-thread")}
- Formats: ${Array.isArray(report.formats) ? report.formats.join(", ") : "markdown"}
- Capture failure screenshots: ${yesNo(report.captureFailures)}
- End with: executive summary, environment, coverage table, defects ordered by severity, blocked/untested areas, artifact paths, and recommended follow-ups.

## Video contract

- Enabled: ${yesNo(video.enabled)}
- Record: ${value(video.recordTarget, "window")}
- Keep raw capture: ${yesNo(video.keepRaw)}
- Output: ${value(video.outputFormat, "mp4")}
- Treat visually idle sections of at least ${Number(video.idleMinimumSeconds)} seconds as cut candidates.
- Preserve ${Number(video.paddingBeforeMotion)} second(s) before motion and ${Number(video.paddingAfterMotion)} second(s) after motion.
- Preserve at least ${Number(video.preserveAfterActionSeconds)} second(s) after each click, keypress, type, drag, or scroll timestamp even when pixels appear static.
- Speed long meaningful waits by ${Number(video.speedLongWaitsBy)}x instead of deleting all context; speed label: ${yesNo(video.showSpeedLabel)}.
- Ignore tiny pulsing regions during idle detection by comparing downscaled/blurred frames and changed screen area.
- Use action timestamps plus freeze/motion detection. Do not let an AI-only visual guess decide every cut.
- Keep the raw recording and an edit manifest. Validate final duration, video codec, audio stream when present, and first/last frames.

## Artifacts

Create a run folder under \`.cu-test/runs/<run-id>/\` when the workspace is writable:

- \`specification.json\`
- \`generated-prompt.md\`
- \`action-log.jsonl\`
- \`report.md\`
- \`report.json\` when requested
- \`raw.mp4\` when video is enabled
- \`final.mp4\` when video is enabled
- \`edit-manifest.json\` when video is enabled
- \`screenshots/\`

Start by restating the target, exclusions, and success criteria in no more than eight lines. Then prepare the environment and begin the session.`;
}

export function normalizeSpec(input) {
  const defaults = defaultSpec();
  return {
    ...defaults,
    ...input,
    target: { ...defaults.target, ...(input?.target || {}) },
    environment: { ...defaults.environment, ...(input?.environment || {}) },
    testing: { ...defaults.testing, ...(input?.testing || {}) },
    safety: { ...defaults.safety, ...(input?.safety || {}) },
    report: { ...defaults.report, ...(input?.report || {}) },
    video: { ...defaults.video, ...(input?.video || {}) },
  };
}
