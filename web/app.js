import { compilePrompt, defaultSpec, normalizeSpec, validateSpec } from "/prompt.js";

const form = document.querySelector("#specForm");
const promptPreview = document.querySelector("#promptPreview");
const jsonPreview = document.querySelector("#jsonPreview");
const validationMessage = document.querySelector("#validationMessage");
const promptStats = document.querySelector("#promptStats");
const launchButton = document.querySelector("#launchButton");
const connectionDialog = document.querySelector("#connectionDialog");
const connectionLabel = document.querySelector("#connectionLabel");
const statusDot = document.querySelector("#statusDot");
const toast = document.querySelector("#toast");

let mode = "guided";
let targetType = "website";
let activeStep = "target";
let compiledPrompt = "";
let currentSpec = defaultSpec();
let activeRunId = null;
let pollTimer = null;
let currentApproval = null;
let bridge = {
  url: localStorage.getItem("cu-test-bridge-url") || "http://127.0.0.1:4318",
  token: localStorage.getItem("cu-test-pair-code") || "",
  connected: false,
};

const lines = (value) => value.split("\n").map((item) => item.trim()).filter(Boolean);
const field = (name) => form.elements.namedItem(name);
const checked = (name) => Boolean(field(name)?.checked);
const guidedSteps = ["target", "environment", "coverage", "evidence"];

const templates = {
  website: {
    name: "Website smoke test",
    target: { type: "website", name: "Local web app", startUrl: "http://localhost:3000", launchInstructions: "Start the development server if it is not already running." },
    environment: { description: "Local development environment in a desktop browser.", devices: ["Desktop browser"] },
    testing: { personas: ["First-time visitor", "Returning user"], include: ["Open the app and verify the primary page loads", "Complete the main user journey", "Check empty, loading, success, and error states"], exclude: ["Never use production data", "Never perform irreversible destructive actions"] },
  },
  mobile: {
    name: "Mobile checkout test",
    target: { type: "simulator", name: "Mobile staging app", startUrl: "iPhone 17 simulator", launchInstructions: "Start the app in the simulator and wait for the home screen." },
    environment: { description: "Staging API with disposable test accounts.", devices: ["iPhone 17 simulator"], emailInbox: "http://127.0.0.1:8025", accountReferences: ["QA_EMAIL and QA_PASSWORD environment variables"] },
    testing: { personas: ["Guest shopper", "Verified customer"], include: ["Browse products", "Add an item to cart", "Complete a test checkout", "Verify confirmation email"], exclude: ["Never submit a real payment", "Never use production customer data"] },
  },
  desktop: {
    name: "Desktop app exploration",
    target: { type: "desktop-app", name: "Desktop application", startUrl: "Application home window", launchInstructions: "Open the application and wait for it to become ready." },
    environment: { description: "Local desktop application with test data only.", devices: ["Desktop app window"] },
    testing: { personas: ["Standard user"], include: ["Verify primary navigation", "Complete the main workflow", "Check settings and recovery paths"], exclude: ["Never change system security settings", "Never delete user files"] },
  },
};

function collectSpec() {
  const formats = [...form.querySelectorAll('input[name="format"]:checked')].map((input) => input.value);
  return normalizeSpec({
    version: 1,
    name: field("name").value.trim(),
    mode,
    customPrompt: field("customPrompt").value,
    target: {
      type: targetType,
      name: field("targetName").value.trim(),
      startUrl: field("startUrl").value.trim(),
      launchInstructions: field("launchInstructions").value.trim(),
    },
    environment: {
      cwd: field("cwd").value.trim(),
      description: field("environmentDescription").value.trim(),
      devices: lines(field("devices").value),
      emailInbox: field("emailInbox").value.trim(),
      accountReferences: lines(field("accountReferences").value),
    },
    testing: {
      include: lines(field("include").value),
      exclude: lines(field("exclude").value),
      personas: lines(field("personas").value),
      order: field("order").value,
      continueAfterFailure: checked("continueAfterFailure"),
      maxDurationMinutes: Number(field("maxDuration").value || 120),
    },
    safety: { notes: field("safetyNotes").value.trim() },
    report: {
      destination: field("reportDestination").value,
      formats: formats.length ? formats : ["markdown"],
      captureFailures: checked("captureFailures"),
    },
    video: {
      enabled: checked("videoEnabled"),
      recordTarget: "window",
      keepRaw: checked("keepRaw"),
      idleMinimumSeconds: Number(field("idleMinimum").value || 3),
      paddingBeforeMotion: Number(field("motionPadding").value || 1),
      paddingAfterMotion: Number(field("motionPadding").value || 1),
      preserveAfterActionSeconds: Number(field("afterAction").value || 2),
      speedLongWaitsBy: Number(field("speedLongWaits").value || 20),
      showSpeedLabel: checked("showSpeedLabel"),
      outputFormat: "mp4",
    },
  });
}

function updatePreview() {
  currentSpec = collectSpec();
  const errors = validateSpec(currentSpec);
  jsonPreview.textContent = JSON.stringify(currentSpec, null, 2);
  if (errors.length) {
    compiledPrompt = mode === "custom" ? field("customPrompt").value : "Complete the highlighted fields to compile the prompt.";
    promptPreview.value = compiledPrompt;
    validationMessage.className = "validation error";
    validationMessage.innerHTML = `<span>!</span><div><strong>Needs attention</strong><small>${escapeHtml(errors[0])}</small></div>`;
    launchButton.disabled = true;
  } else {
    compiledPrompt = compilePrompt(currentSpec);
    promptPreview.value = compiledPrompt;
    validationMessage.className = "validation";
    validationMessage.innerHTML = `<span>✓</span><div><strong>Ready to review</strong><small>All required fields are present</small></div>`;
    launchButton.disabled = false;
  }
  const words = compiledPrompt.trim() ? compiledPrompt.trim().split(/\s+/).length : 0;
  promptStats.textContent = `${words} words`;
  updateWorkspaceSummary();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelector("#guidedFields").hidden = mode !== "guided";
  document.querySelector("#customFields").hidden = mode !== "custom";
  document.querySelector(".guided-stepper").hidden = mode !== "guided";
  document.querySelector(".step-controls").hidden = mode !== "guided";
  document.querySelectorAll(".mode-option").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (mode === "guided") setActiveStep(activeStep);
  updatePreview();
}

function setActiveStep(step) {
  if (!guidedSteps.includes(step)) return;
  activeStep = step;
  document.querySelectorAll(".step-panel").forEach((panel) => {
    const active = panel.dataset.panel === step;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  document.querySelectorAll(".step-link").forEach((button) => {
    const active = button.dataset.step === step;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  });
  const index = guidedSteps.indexOf(step);
  const previous = document.querySelector("#previousStep");
  const next = document.querySelector("#nextStep");
  previous.disabled = index === 0;
  document.querySelector("#stepProgress").textContent = `Step ${index + 1} of ${guidedSteps.length}`;
  if (index === guidedSteps.length - 1) {
    next.innerHTML = `<span>Review prompt</span><b>→</b>`;
  } else {
    const label = document.querySelector(`.step-link[data-step="${guidedSteps[index + 1]}"] strong`)?.textContent || "Next";
    next.innerHTML = `<span>${escapeHtml(label)}</span><b>→</b>`;
  }
}

function updateWorkspaceSummary() {
  document.querySelector("#summaryMode").textContent = mode === "guided" ? "Guided" : "Custom";
  document.querySelector("#summaryTarget").textContent = currentSpec.target?.name || currentSpec.target?.startUrl || "Not set";
  document.querySelector("#summaryDuration").textContent = `${currentSpec.testing?.maxDurationMinutes || 0} min`;
  const completed = {
    target: Boolean(currentSpec.target?.name || currentSpec.target?.startUrl),
    environment: Boolean(currentSpec.environment?.cwd || currentSpec.environment?.description || currentSpec.environment?.devices?.length || currentSpec.environment?.emailInbox),
    coverage: Boolean(currentSpec.testing?.include?.length),
    evidence: Boolean(currentSpec.report?.formats?.length),
  };
  document.querySelectorAll(".step-link").forEach((button) => button.classList.toggle("complete", completed[button.dataset.step]));
}

function setTargetType(value) {
  targetType = value;
  document.querySelectorAll("#targetType button").forEach((button) => {
    const selected = button.dataset.value === value;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  updatePreview();
}

function applySpec(input) {
  const spec = normalizeSpec(input);
  setMode(spec.mode);
  field("name").value = spec.name;
  field("customPrompt").value = spec.customPrompt;
  setTargetType(spec.target.type);
  field("targetName").value = spec.target.name;
  field("startUrl").value = spec.target.startUrl;
  field("launchInstructions").value = spec.target.launchInstructions;
  field("cwd").value = spec.environment.cwd;
  field("environmentDescription").value = spec.environment.description;
  field("devices").value = spec.environment.devices.join("\n");
  field("emailInbox").value = spec.environment.emailInbox;
  field("accountReferences").value = spec.environment.accountReferences.join("\n");
  field("personas").value = spec.testing.personas.join("\n");
  field("include").value = spec.testing.include.join("\n");
  field("exclude").value = spec.testing.exclude.join("\n");
  field("order").value = spec.testing.order;
  field("continueAfterFailure").checked = spec.testing.continueAfterFailure;
  field("maxDuration").value = spec.testing.maxDurationMinutes;
  field("safetyNotes").value = spec.safety.notes;
  field("reportDestination").value = spec.report.destination;
  form.querySelectorAll('input[name="format"]').forEach((input) => { input.checked = spec.report.formats.includes(input.value); });
  field("captureFailures").checked = spec.report.captureFailures;
  field("videoEnabled").checked = spec.video.enabled;
  field("idleMinimum").value = spec.video.idleMinimumSeconds;
  field("speedLongWaits").value = spec.video.speedLongWaitsBy;
  field("motionPadding").value = spec.video.paddingBeforeMotion;
  field("afterAction").value = spec.video.preserveAfterActionSeconds;
  field("keepRaw").checked = spec.video.keepRaw;
  field("showSpeedLabel").checked = spec.video.showSpeedLabel;
  updatePreview();
}

async function bridgeFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (bridge.token) headers.set("Authorization", `Bearer ${bridge.token}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${bridge.url}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.errors?.join(" ") || `Bridge returned ${response.status}.`);
  return data;
}

async function connect(showErrors = true) {
  bridge.url = document.querySelector("#bridgeUrl").value.trim().replace(/\/$/, "");
  bridge.token = document.querySelector("#pairCode").value.trim();
  const error = document.querySelector("#connectionError");
  error.textContent = "";
  try {
    const status = await bridgeFetch("/api/status");
    bridge.connected = true;
    localStorage.setItem("cu-test-bridge-url", bridge.url);
    if (bridge.token) localStorage.setItem("cu-test-pair-code", bridge.token);
    statusDot.classList.add("connected");
    connectionLabel.textContent = status.codex.authenticated ? "Codex connected" : "Codex needs sign-in";
    connectionDialog.close();
    document.querySelector("#connectionButton").setAttribute("aria-expanded", "false");
    notify("Local Codex connected");
    return true;
  } catch (cause) {
    bridge.connected = false;
    statusDot.classList.remove("connected");
    connectionLabel.textContent = "Codex not connected";
    if (showErrors) error.textContent = `${cause.message} Check the command, pair code, allowed origin, and browser local-network permission.`;
    return false;
  }
}

async function launch() {
  if (!bridge.connected && !(await connect(false))) {
    connectionDialog.showModal();
    document.querySelector("#connectionButton").setAttribute("aria-expanded", "true");
    document.querySelector("#connectionError").textContent = "Connect the local bridge before launching.";
    return;
  }
  launchButton.disabled = true;
  launchButton.querySelector("span").textContent = "Starting…";
  try {
    const data = await bridgeFetch("/api/run", { method: "POST", body: JSON.stringify(currentSpec) });
    activeRunId = data.run.id;
    showRun(data.run, true);
    startPolling();
  } catch (cause) {
    notify(cause.message, true);
  } finally {
    launchButton.disabled = false;
    launchButton.querySelector("span").textContent = "Launch in Codex";
  }
}

function showRun(run, scroll = false) {
  document.querySelector("#runSection").hidden = false;
  document.querySelector("#runName").textContent = run.name;
  document.querySelector("#runStatus").textContent = run.status;
  const link = document.querySelector("#threadLink");
  link.href = run.threadId ? `codex://threads/${run.threadId}` : "#";
  link.hidden = !run.threadId;
  const stream = document.querySelector("#eventStream");
  const events = run.events || [];
  stream.innerHTML = events.length ? events.slice(-30).map(formatEvent).join("") : '<div class="event-line">Waiting for Codex events…</div>';
  stream.scrollTop = stream.scrollHeight;
  if (scroll) document.querySelector("#runSection").scrollIntoView({ behavior: "smooth" });
}

function formatEvent(event) {
  const time = new Date(event.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let detail = event.method;
  if (event.method === "item/agentMessage/delta") detail = String(event.params?.delta || "Agent response").slice(0, 100);
  if (event.method === "turn/completed") detail = `Turn ${event.params?.turn?.status || "completed"}`;
  if (event.method === "item/started") detail = `Started ${event.params?.item?.type || "item"}`;
  return `<div class="event-line"><strong>${escapeHtml(time)}</strong>${escapeHtml(detail)}</div>`;
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!activeRunId) return;
    try {
      const [{ run }, { approvals }] = await Promise.all([
        bridgeFetch(`/api/runs/${encodeURIComponent(activeRunId)}`),
        bridgeFetch("/api/approvals"),
      ]);
      showRun(run);
      showApproval(approvals[0] || null);
      if (["completed", "failed", "interrupted"].includes(run.status)) {
        clearInterval(pollTimer);
        notify(`Run ${run.status}`);
      }
    } catch (cause) {
      clearInterval(pollTimer);
      notify(cause.message, true);
    }
  }, 1400);
}

function showApproval(approval) {
  currentApproval = approval;
  const card = document.querySelector("#approvalCard");
  card.hidden = !approval;
  if (!approval) return;
  document.querySelector("#approvalTitle").textContent = approval.method;
  document.querySelector("#approvalDetails").textContent = JSON.stringify(approval.params, null, 2);
}

async function answerApproval(action, session = false) {
  if (!currentApproval) return;
  try {
    await bridgeFetch(`/api/approvals/${encodeURIComponent(currentApproval.id)}`, {
      method: "POST",
      body: JSON.stringify({ action, session }),
    });
    showApproval(null);
    notify(action === "approve" ? "Approved" : "Denied");
  } catch (cause) {
    notify(cause.message, true);
  }
}

function download(filename, contents, type) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([contents], { type }));
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 500);
}

function notify(message, error = false) {
  toast.textContent = message;
  toast.style.background = error ? "#b92d16" : "";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

form.addEventListener("input", updatePreview);
form.addEventListener("change", updatePreview);
document.querySelectorAll(".mode-option").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
document.querySelectorAll("#targetType button").forEach((button) => button.addEventListener("click", () => setTargetType(button.dataset.value)));
document.querySelectorAll(".step-link").forEach((button) => button.addEventListener("click", () => setActiveStep(button.dataset.step)));
document.querySelector("#previousStep").addEventListener("click", () => {
  const index = guidedSteps.indexOf(activeStep);
  if (index > 0) setActiveStep(guidedSteps[index - 1]);
});
document.querySelector("#nextStep").addEventListener("click", () => {
  const index = guidedSteps.indexOf(activeStep);
  if (index === guidedSteps.length - 1) document.querySelector("#reviewPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  else setActiveStep(guidedSteps[index + 1]);
});
document.querySelectorAll("[data-template]").forEach((button) => button.addEventListener("click", () => {
  const template = templates[button.dataset.template];
  if (!template) return;
  applySpec({ ...template, mode: "guided" });
  setActiveStep("target");
  notify(`${button.querySelector("strong").textContent} template applied`);
}));
document.querySelectorAll(".review-tabs button").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".review-tabs button").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
  promptPreview.hidden = button.dataset.review !== "prompt";
  jsonPreview.hidden = button.dataset.review !== "json";
}));
document.querySelector("#copyButton").addEventListener("click", async () => { await navigator.clipboard.writeText(promptPreview.value); notify("Prompt copied"); });
document.querySelector("#exportButton").addEventListener("click", () => download(`${currentSpec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "cu-test"}.json`, `${JSON.stringify(currentSpec, null, 2)}\n`, "application/json"));
document.querySelector("#savePresetButton").addEventListener("click", () => { localStorage.setItem("cu-test-last-spec", JSON.stringify(currentSpec)); notify("Preset saved in this browser"); });
document.querySelector("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try { applySpec(JSON.parse(await file.text())); notify("Specification imported"); } catch { notify("That JSON file is not valid", true); }
});
launchButton.addEventListener("click", launch);
document.querySelector("#connectionButton").addEventListener("click", () => {
  connectionDialog.showModal();
  document.querySelector("#connectionButton").setAttribute("aria-expanded", "true");
});
document.querySelector("#closeDialog").addEventListener("click", () => connectionDialog.close());
connectionDialog.addEventListener("close", () => document.querySelector("#connectionButton").setAttribute("aria-expanded", "false"));
document.querySelector("#connectButton").addEventListener("click", () => connect(true));
document.querySelector("#stopButton").addEventListener("click", async () => {
  if (!activeRunId) return;
  try { await bridgeFetch(`/api/runs/${encodeURIComponent(activeRunId)}/stop`, { method: "POST" }); notify("Stop requested"); } catch (cause) { notify(cause.message, true); }
});
document.querySelector("#denyApproval").addEventListener("click", () => answerApproval("deny"));
document.querySelector("#approveOnce").addEventListener("click", () => answerApproval("approve"));
document.querySelector("#approveSession").addEventListener("click", () => answerApproval("approve", true));

document.querySelector("#bridgeUrl").value = bridge.url;
document.querySelector("#pairCode").value = bridge.token;
if (location.protocol.startsWith("http") && !location.hostname.match(/^(127\.0\.0\.1|localhost)$/)) {
  document.querySelector("#bridgeCommand").textContent = `cu-test web --allow-origin ${location.origin}`;
}

const saved = localStorage.getItem("cu-test-last-spec");
setActiveStep(activeStep);
if (saved) { try { applySpec(JSON.parse(saved)); } catch { updatePreview(); } } else { updatePreview(); }
if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) || bridge.token) connect(false);
