# Repository Guidelines

## Project Structure & Module Organization

Hootly is a monorepo for a community-manager application:

- `social-media/` contains the Expo Router mobile app; screens are in `app/` and shared TypeScript code in `src/`.
- `services/api/` is the Express 5 + Prisma public API. Domain modules are under `src/{auth,profile,brands,publications,media,social-accounts}/`; migrations are under `prisma/`.
- `services/worker/` consumes pg-boss jobs; reusable dependency-free code is in `services/shared/`.
- `graph-api/` is the FastAPI/Meta gateway (`api/routes`, `modules`, `core`, `tests`); `services/ai-service/` is the FastAPI NLP stub.
- `contracts/` holds API contracts, `docs/` holds architecture/sprint documentation, and `scripts/` manages Compose and verification.

## Build, Test, and Development Commands

From the repository root, copy `.env.example` to `.env`, install dependencies, then run `./scripts/start.ps1` to build and start Docker/Podman services. Use `./scripts/stop.ps1`, `./scripts/logs.ps1 api`, and `./scripts/seed.ps1` for lifecycle, logs, and demo data. Run `./scripts/verify-readiness.ps1` for health checks and `./scripts/test.ps1` for the full suite.

Useful focused commands include `npm --prefix services/api test`, `npm --prefix services/worker test`, `python -m pytest -q` from `graph-api/`, `npm --prefix social-media run typecheck`, and `npm --prefix social-media run lint`. Start the mobile app with `npm --prefix social-media start`.

## Coding Style & Naming Conventions

Use 2-space indentation in JavaScript/TypeScript and PEP 8 in Python. Use `camelCase` for JS/TS variables and functions, `PascalCase` for React components, and `snake_case` for Python names. Keep routes thin, validation in Zod/Pydantic schemas, and business logic in services. Run Expo ESLint and TypeScript checks before mobile changes; keep shared modules dependency-free.

## Testing Guidelines

API and worker tests use Node's built-in `node:test` and are discovered by `test/run.js`; name files `*.test.js`. Graph API tests use pytest and respx; name files `test_*.py`. Add regression coverage for changed behavior. Meta calls must remain mocked.

## Commit & Pull Request Guidelines

History uses short, lowercase, informal subjects, often identifying a sprint or fix (for example, `s4 fin` or `fix timezone`). Follow that style while making the subject specific. PRs should explain the behavior changed, list verification commands, link the relevant sprint/spec or issue, and include mobile screenshots or recordings for UI changes. Call out schema/migration, contract, and environment-variable changes explicitly.

## Security & Configuration

Never commit `.env`, tokens, passwords, or real Meta credentials. The mobile app talks only to the Express API; keep JWTs in secure storage and keep Meta tokens server-side. After editing `schema.prisma`, add a Prisma migration and restart the stack.
