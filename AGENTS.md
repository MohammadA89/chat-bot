# Project overview

Local-first Persian web coding agent. The React client talks to an OpenAI- or Anthropic-compatible model and an optional localhost bridge. The bridge exposes one allowlisted workspace and the user's existing GitHub CLI session, so edits appear immediately in VS Code or Cursor.

## Goals and requirements

- Chat in the browser with streaming, project memory, and model tool calls.
- Read and edit the folder open in VS Code/Cursor through a localhost-only bridge.
- Inspect Git state and connect to GitHub through the authenticated `gh` CLI.
- Keep filesystem access path-jailed; make write, shell, and GitHub mutations opt-in.
- Show connection and tool activity clearly in Persian.

## Technology stack

- React 18, TypeScript, Vite
- Native Node.js HTTP sidecar with no runtime dependencies
- OpenAI-compatible and Anthropic-compatible APIs
- Browser storage for conversations and settings
- Local `git` and optional `gh` CLI integration

## Architecture decisions

- The web UI never accesses the filesystem directly; it calls the bridge RPC endpoint.
- The bridge binds to `127.0.0.1`, requires a bearer token, validates every path against one workspace root, and caps body/output sizes.
- Read access is available after authentication. File writes, terminal commands, and GitHub mutations require separate launch flags.
- Every mutating tool call passes an approval gate in the client: `plan` blocks it, `ask` shows the exact diff or command for confirmation, `auto` lets it through.
- The model only receives tools reported as available by the connected bridge.
- API keys remain browser-local in this local-first version. A hosted deployment must proxy model calls server-side and encrypt credentials.

## Folder structure

- `src/components`: UI and connection surfaces
- `src/lib/api.ts`: provider adapters and streaming tool-call parsing
- `src/lib/harness.ts`: prompt assembly, context, tool loop, and memory
- `src/lib/bridge.ts`: browser client for the localhost sidecar, typed calls, and the event stream
- `src/lib/diff.ts`: unified-diff parsing and file-viewer helpers
- `src/lib/tools.ts`: tool declarations and dispatch
- `scripts/local-bridge.mjs`: workspace, Git, terminal, GitHub, and file-watch sidecar

## Coding standards

- Use strict TypeScript and validate every trust boundary.
- Keep functions focused and avoid hidden global mutation.
- User-facing copy is natural Persian; protocol names may remain English.
- Preserve unrelated user changes and avoid broad rewrites.

## Naming conventions

- Components and exported types: PascalCase.
- Functions and variables: camelCase.
- RPC methods: dotted domains such as `workspace.read` and `github.issues`.

## API conventions

- `POST /rpc` accepts `{ "method": string, "params": object }`.
- Success is `{ "ok": true, "result": ... }`; failure is `{ "ok": false, "error": string }`.
- `GET /health` returns workspace, editor, integration, and capability status.
- `GET /events` is an SSE stream of file changes and terminal job output.
- Every request requires `Authorization: Bearer <token>`.

## Database conventions

- No database is used locally. Conversations and settings use version-tolerant browser storage migrations.
- A hosted version should use encrypted per-user records with retention/deletion controls.

## Security requirements

- Bind only to loopback; never expose the bridge on `0.0.0.0`.
- Reject traversal, paths outside the workspace, symlink escapes, large requests, and oversized reads.
- Never return tokens, API keys, environment variables, or GitHub credentials to the model.
- GitHub mutations require both `--allow-github-write` and an explicit product approval flow before model exposure.

## Testing strategy

- `npm run build` is the required type and production build gate.
- `npm run bridge:self-test` validates confinement and argument parsing.
- Smoke-test bridge health/RPC and one browser chat turn against the mock API.
- Add focused tests when changing protocol parsing or tool dispatch.

## Deployment notes

- Run `npm run bridge -- --workspace "C:\\path\\to\\repo"`, then `npm run dev`.
- Add `--allow-write` or `--allow-shell` only when those capabilities are intended.
- GitHub read access uses `gh auth status`; authenticate with `gh auth login` outside the app.
- Do not publish the browser-key architecture without a server-side credential proxy and authenticated user isolation.

## Future improvements

- Per-tool approval queue with diff previews.
- Patch-native editing, terminal streaming, and cancellable commands.
- VS Code/Cursor extension for workspace discovery and diagnostics.
- Encrypted secret storage, remote workspace isolation, and multi-device sync.
