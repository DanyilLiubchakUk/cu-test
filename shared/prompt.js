export const SPEC_VERSION = 2;

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
      recordTarget: "active-window",
      captureStrategy: "action-bursts",
      keepRaw: true,
      idleMinimumSeconds: 2,
      maxFinalIdleSeconds: 1.5,
      paddingBeforeMotion: 0.5,
      paddingAfterMotion: 0.75,
      preserveAfterActionSeconds: 1,
      speedLongWaitsBy: 20,
      showSpeedLabel: true,
      outputFormat: "mp4",
      minOutputHeight: 1080,
      minOutputFps: 30,
      privacyReview: true,
      editingRequired: true,
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
  if (spec.video?.enabled) {
    if (!["active-window", "agent-region"].includes(spec.video.recordTarget)) {
      errors.push("Video capture must target the active test window or an agent-controlled region, never the full display.");
    }
    const maxIdle = Number(spec.video.maxFinalIdleSeconds);
    if (!Number.isFinite(maxIdle) || maxIdle < 0.5 || maxIdle > 5) {
      errors.push("Final video idle limit must be between 0.5 and 5 seconds.");
    }
    if (![720, 1080, 1440, 2160].includes(Number(spec.video.minOutputHeight))) {
      errors.push("Minimum video height must be 720, 1080, 1440, or 2160 pixels.");
    }
  }
  return errors;
}

function compileVideoContract(video = {}) {
  if (!video.enabled) return "## Video contract\n\n- Disabled.";

  return `## Video contract — action-only delivery

- Capture scope: ${value(video.recordTarget, "active-window")}. Never record the full display.
- Capture strategy: ${value(video.captureStrategy, "action-bursts")}.
- The user may keep using this computer during the run. Their cursor movement, windows, notifications, and unrelated activity must never appear in the test video.
- Record only the agent-controlled target window or a tightly bounded agent-controlled region. For multi-app workflows, create separate clips for each target surface and join them chronologically.
- Start each clip no more than 1 second before the next visible agent action. Stop or pause after the observable result; do not record planning, reasoning, tool latency, or off-screen setup.
- Append a timestamp before every click, keypress, type, drag, and scroll. Use these timestamps as the primary edit decision list.
- Treat visually idle sections of at least ${Number(video.idleMinimumSeconds)} seconds as mandatory cut or speed-up regions, not optional candidates.
- No final-video interval without an agent action or meaningful visible product response may exceed ${Number(video.maxFinalIdleSeconds)} seconds.
- Preserve ${Number(video.paddingBeforeMotion)} second(s) before motion, ${Number(video.paddingAfterMotion)} second(s) after motion, and at least ${Number(video.preserveAfterActionSeconds)} second(s) after each action when needed to show the result.
- Remove thinking time completely. Speed only meaningful visible progress or loading by ${Number(video.speedLongWaitsBy)}x; show speed label: ${yesNo(video.showSpeedLabel)}.
- Keep raw capture: ${yesNo(video.keepRaw)}. Output: ${value(video.outputFormat, "mp4")}.
- Quality floor: native source and final output must be at least ${Number(video.minOutputHeight)}p and ${Number(video.minOutputFps)} fps, with UI text readable at normal playback size. Upscaling a low-quality source does not pass.
- Privacy review required: ${yesNo(video.privacyReview)}. Inspect representative frames from every kept segment. Any unrelated user app, private notification, or user-controlled activity makes the final video invalid; recrop, re-edit, or rerecord.
- Editing required: ${yesNo(video.editingRequired)}. A transcode, resize, or format conversion of the raw recording without real cuts does not qualify as a final video.
- The edit manifest must list source clips, kept time ranges, removed idle ranges, sped-up ranges, action timestamps covered, source/final duration, resolution, fps, codec, and privacy-review result.
- Before delivery, verify first/last frames, every cut boundary, readable UI text, continuous action coverage, maximum idle duration, codec, resolution, fps, and absence of unrelated activity.
- If deterministic editing or validation tooling is unavailable, mark the video deliverable blocked. Never rename or transcode the raw capture and claim it is edited.`;
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
      "",
      compileVideoContract(spec.video),
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

${compileVideoContract(video)}

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
- \`clips/\` with per-surface source clips when video is enabled
- \`screenshots/\`

Start by restating the target, exclusions, and success criteria in no more than eight lines. Then prepare the environment and begin the session.`;
}

export function normalizeSpec(input) {
  const defaults = defaultSpec();
  const video = { ...defaults.video, ...(input?.video || {}) };
  if (video.recordTarget === "window") video.recordTarget = "active-window";
  return {
    ...defaults,
    ...input,
    target: { ...defaults.target, ...(input?.target || {}) },
    environment: { ...defaults.environment, ...(input?.environment || {}) },
    testing: { ...defaults.testing, ...(input?.testing || {}) },
    safety: { ...defaults.safety, ...(input?.safety || {}) },
    report: { ...defaults.report, ...(input?.report || {}) },
    video,
  };
}
