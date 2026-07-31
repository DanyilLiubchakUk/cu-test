# Use `cu-test` anywhere — no npm or npx

The shortest setup is a shell alias that points Bun at this cloned repository. No package is installed or packed.

## macOS or Linux with zsh

From the repository, print its absolute path:

```bash
pwd
```

Add this line to `~/.zshrc`, replacing the example path with that output:

```bash
alias cu-test='bun /absolute/path/to/cu-test/src/cli.ts'
```

Reload the shell:

```bash
source ~/.zshrc
```

Verify from any directory:

```bash
cu-test help
cu-test status
cu-test web
```

This is equivalent to running `bun run cu-test <command>` inside the repository, but the command works from every directory and keeps the current directory as the default project under test.

## Bash

Put the same alias in `~/.bashrc` instead, then run:

```bash
source ~/.bashrc
```

## Fish

```fish
alias --save cu-test 'bun /absolute/path/to/cu-test/src/cli.ts'
```

## Optional executable symlink

If `~/.local/bin` is already on `PATH`, a symlink behaves more like a normal binary:

```bash
chmod +x /absolute/path/to/cu-test/src/cli.ts
ln -s /absolute/path/to/cu-test/src/cli.ts ~/.local/bin/cu-test
```

Use an alias when you want the easiest reversible setup. Use a symlink when you prefer a real executable path. Moving the cloned repository requires updating either one.

## Install the Codex skill

The skill can remain version-controlled in this repository. Link it into the personal Codex skill directory so changes in the clone are immediately visible:

```bash
mkdir -p ~/.codex/skills
ln -s /absolute/path/to/cu-test/skills/cu-test ~/.codex/skills/cu-test
```

Restart Codex or start a new task, then invoke `$cu-test`. If that destination already exists, inspect it before replacing it.
