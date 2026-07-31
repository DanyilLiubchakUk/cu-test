# CU Test agent instructions

Read `README.md` before changing the project. For any Computer Use test,
recording, report, or rerun, also read and follow `skills/cu-test/SKILL.md`.

## Project rules

- Use Bun. Do not introduce npm, npx, or package-install steps.
- Run `bun test` before handing off changes.
- Keep the web UI, CLI, shared prompt compiler, and skill instructions aligned.
- Keep the local bridge bound to loopback unless the user explicitly requests a
  reviewed network change.
- Never put credentials in specs, source files, logs, or reports.
- Treat `.cu-test/` as generated local evidence; do not commit its contents.

## Computer Use evidence

- Use Computer Use for every visible interaction. Shell commands are only for
  setup, action logs, artifacts, deterministic media editing, and validation.
- Capture only the active test window or a tight agent-controlled region. Never
  record the full display by default.
- Record action bursts and timestamp every click, keypress, type, drag, and
  scroll before the action occurs.
- In zsh helpers, do not use reserved parameter names such as `status`; use a
  name such as `result_status`.
- Cut thinking and tool latency. Validate the final idle limit, native quality,
  first and last frames, cut boundaries, action coverage, and privacy.
- If isolated capture or deterministic editing is unavailable, mark the video
  blocked. Never rename or transcode raw footage and call it edited.

## Repository map

- `web/`: static Vercel-compatible interface.
- `shared/prompt.js`: shared specification defaults, validation, and compiler.
- `src/`: Bun CLI, loopback bridge, and Codex App Server client.
- `skills/cu-test/`: installable Codex skill and agent metadata.
- `test/`: prompt and bridge regression tests.
- `examples/`: safe connection smoke specifications.
