# CU Test

CU Test is a local-first prompt studio for general-purpose Codex Computer Use testing. It provides the same two choices in three surfaces:

- Web: guided builder or fully custom prompt, live preview, presets, JSON import/export, local Codex launch, live events, stop, and approval controls.
- CLI: interactive authoring, validation, prompt generation, direct runs, and connection diagnostics.
- Codex skill: reusable testing, reporting, and video-editing workflow in [`skills/cu-test/SKILL.md`](skills/cu-test/SKILL.md).

It has no npm dependencies. Bun and a signed-in Codex CLI are the only runtime requirements.

## Clone and run

```bash
git clone https://github.com/DanyilLiubchakUk/cu-test.git
cd cu-test
bun test
bun run web
```

Open [http://127.0.0.1:4318](http://127.0.0.1:4318). For `cu-test` commands
from any directory, copy the setup for your shell from
[`ALIAS_SETUP.md`](ALIAS_SETUP.md).

To make the bundled skill available to Codex from this clone:

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skills/cu-test" ~/.codex/skills/cu-test
```

Restart Codex or begin a new task, then invoke `$cu-test`. Agents working in
this repository should also follow [`AGENTS.md`](AGENTS.md).

## Start locally

```bash
bun run web
```

Open [http://127.0.0.1:4318](http://127.0.0.1:4318). A page served by the bridge connects automatically and does not need the printed pair code.

Check Codex independently:

```bash
bun run cu-test status
```

## CLI

```bash
bun run cu-test new
bun run cu-test validate ./cu-test-spec.json
bun run cu-test prompt ./cu-test-spec.json
bun run cu-test run ./cu-test-spec.json
```

The interactive `new` command offers guided and full-prompt modes. Direct runs create `.cu-test/runs/<run-id>/` and print a `codex://threads/...` task URL.

Verify the complete thread/turn path without operating any UI:

```bash
bun run cu-test run ./examples/connection-smoke.json
```

To use `cu-test` from any directory without npm, npx, publishing, or packaging, follow [`ALIAS_SETUP.md`](ALIAS_SETUP.md).

## Video quality gate

Video defaults to action-only capture of the active test window. CU Test assumes the user may continue working on the same computer, so unrelated windows, notifications, cursor activity, and full-display recording are excluded from valid final footage.

For workflows that switch between a browser, inbox, simulator, or desktop app, the operator records separate clips for each target surface and joins only the action-bearing ranges. Thinking time is cut, while meaningful visible loading may be accelerated with a label.

A final video must prove all of the following in `edit-manifest.json`:

- Every kept range maps to an action timestamp or meaningful visible response.
- No idle interval exceeds the configured final-idle limit.
- Output meets the configured native resolution and frame-rate floor with readable UI text.
- Representative frames contain no unrelated user activity or private notifications.
- Source/final durations, cuts, speed changes, codec, resolution, and frame rate were validated.

A resize, transcode, or extension change without real cuts is not an edited video. If the required editing or validation tooling is unavailable, the video is reported as blocked instead of shipping the raw capture as `final`.

## Vercel + local Codex

Vercel hosts only the static UI. It cannot directly run Codex or control a developer's Mac. The developer starts the loopback bridge:

```bash
cu-test web --allow-origin https://YOUR-PROJECT.vercel.app
```

Then, in the hosted UI:

1. Open **Codex not connected**.
2. Keep the bridge URL as `http://127.0.0.1:4318`.
3. Paste the pair code printed by the CLI.
4. Press **Connect local Codex**.
5. Allow the browser's local-network prompt when it appears.

The pair code is kept in that browser's local storage and changes every time the bridge restarts. The bridge binds to loopback only, accepts the configured web origin, and adds the browser private-network preflight response. Prompts and Codex events go directly between the page and the local bridge; Vercel is not an application backend.

Deploy the repository as a Vercel project with no build command. [`vercel.json`](vercel.json) routes the static files and permits connections only to loopback addresses in Content Security Policy.

Browser security changes can affect HTTPS-to-loopback access. If a managed browser blocks local-network requests, use the identical UI locally with `cu-test web`; this path is the most reliable and requires no pairing.

## How the Codex connection works

```text
Web UI or CLI
      ↓
local Bun bridge (127.0.0.1 only)
      ↓ JSON-RPC over stdio
codex app-server
      ↓
normal local Codex task + installed Computer Use capability
```

The bridge performs the required App Server handshake, starts a thread and turn, streams task events, and routes supported approval requests back to the web UI. The generated prompt tells Codex to stop honestly if the installed Computer Use capability is unavailable.

The CLI uses the same App Server client directly, so it does not need the web bridge. Approvals are easiest in the web UI or the opened Codex task.

## Security boundary

- Do not bind the bridge to `0.0.0.0` unless you fully understand the network exposure.
- Add only the exact Vercel/custom origin with `--allow-origin`.
- Never put credentials in a spec. Refer to environment variables or safe test-account labels.
- Review the generated prompt before launch.
- Approval requests are never automatically accepted.

Official protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## License

CU Test is available under the permissive [MIT License](LICENSE).
