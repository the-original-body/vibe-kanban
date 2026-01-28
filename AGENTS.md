# Repository Guidelines

## CRITICAL: Fork Maintenance with stgit

This repository is a fork of `BloopAI/vibe-kanban`. All customizations MUST be maintained as stgit patches.

**NEVER make direct commits for fork-specific changes. Always use stgit patches.**

### Current Patch Stack
The fork maintains these patches on top of upstream:
1. `rebrand-vibe-kanban-to-tob` - All fork customizations:
   - Package names (tob-vibe-kanban), binaries, CLI
   - Storage paths (port files, config dirs, worktree dirs)
   - CI/CD: standard GitHub runners, optional macOS signing, Sentry non-blocking
   - CI/CD: npm publish, R2 verification fix, ring workaround for Windows arm64
   - Remove linux-arm64 target (no free GitHub runner)
   - MPM executor variant (claude-mpm run --headless)
2. `docs-add-stgit-fork` - This documentation about stgit workflow
3+ Feature patches may follow - Additional features built on the fork

### Making Changes
```bash
# View current patches
stg series -a

# To modify an existing patch:
stg goto <patch-name>      # Go to that patch
# Make your changes
stg refresh                # Update the patch
stg push -a                # Re-apply remaining patches

# To add a new patch:
stg new <patch-name> -m "Description"
# Make your changes
git add <files>
stg refresh
```

### Syncing with Upstream
```bash
git fetch upstream
stg pop -a                 # Pop all patches
git rebase upstream/main   # Rebase onto upstream
stg push -a                # Re-apply patches (resolve conflicts as needed)
```

### Why stgit?
- Clear separation of upstream code vs fork customizations
- Easy conflict resolution during upstream syncs
- Each patch is a logical unit that can be reviewed/modified independently
- Prevents accidental loss of fork changes during merges

## Project Structure & Module Organization
- `crates/`: Rust workspace crates — `server` (API + bins), `db` (SQLx models/migrations), `executors`, `services`, `utils`, `deployment`, `local-deployment`, `remote`.
- `frontend/`: React + TypeScript app (Vite, Tailwind). Source in `frontend/src`.
- `frontend/src/components/dialogs`: Dialog components for the frontend.
- `remote-frontend/`: Remote deployment frontend.
- `shared/`: Generated TypeScript types (`shared/types.ts`). Do not edit directly.
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets.
- `npx-cli/`: Files published to the npm CLI package.
- `scripts/`: Dev helpers (ports, DB preparation).
- `docs/`: Documentation files.

## Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.
When making changes to the types, you can regenerate them using `pnpm run generate-types`
Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs

## Build, Test, and Development Commands
- Install: `pnpm i`
- Run dev (frontend + backend with ports auto-assigned): `pnpm run dev`
- Backend (watch): `pnpm run backend:dev:watch`
- Frontend (dev): `pnpm run frontend:dev`
- Type checks: `pnpm run check` (frontend) and `pnpm run backend:check` (Rust cargo check)
- Rust tests: `cargo test --workspace`
- Generate TS types from Rust: `pnpm run generate-types` (or `generate-types:check` in CI)
- Prepare SQLx (offline): `pnpm run prepare-db`
- Prepare SQLx (remote package, postgres): `pnpm run remote:prepare-db`
- Local NPX build: `pnpm run build:npx` then `pnpm pack` in `npx-cli/`

## Automated QA
- When testing changes by running the application, you should prefer `pnpm run dev:qa` over `pnpm run dev`, which starts the application in a dedicated mode that is optimised for QA testing

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate; snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols). PascalCase components, camelCase vars/functions, kebab-case file names where practical.
- Keep functions small, add `Debug`/`Serialize`/`Deserialize` where useful.

## Testing Guidelines
- Rust: prefer unit tests alongside code (`#[cfg(test)]`), run `cargo test --workspace`. Add tests for new logic and edge cases.
- Frontend: ensure `pnpm run check` and `pnpm run lint` pass. If adding runtime logic, include lightweight tests (e.g., Vitest) in the same directory.

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST` 
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.
