# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Hootly — a monorepo for a community-manager mobile app. Five deployables, one Compose stack:

| Path | Role | Port |
|---|---|---|
| [social-media/](social-media/) | Expo SDK 55 / React Native / TypeScript mobile app (30 screens) | Metro |
| [services/api/](services/api/) | Express 5 + Prisma — the only public façade for the mobile app (`/api/v1`) | 3000 |
| [services/worker/](services/worker/) | pg-boss consumer: publishes to social networks, retries, media cleanup | 3001 |
| [graph-api/](graph-api/) | FastAPI gateway to Meta Graph API (Facebook today, Instagram later) | 8000 |
| [services/ai-service/](services/ai-service/) | FastAPI NLP service: sentiment/intent analysis (Sprint 09) and LangGraph reply generation (Sprint 10) | 8080 |

[admin-web/](admin-web/) is a sixth package outside the Compose stack: the Vite + React + TypeScript admin console (Overview, AI supervision, Analytics, Users & roles, Pages, Configuration; dev server on 5173). It is French by default with a typed in-house i18n (`src/i18n/`, `en.ts` must mirror `fr.ts`), and reads real data from the Express `/api/v1/admin` routes ([services/api/src/admin/](services/api/src/admin/), gated by `users.platform_role = PLATFORM_ADMIN`; seed account `admin@hootly.app`). Fixtures now live only in `src/test/`. A measure the API cannot compute is `null` and shows "Non disponible", never `0`. Some settings (moderation keywords, autonomy threshold, per-page auto-reply) are stored but not consumed by any pipeline — nothing is sent without human approval. The Pages screen also lets an admin link a Facebook page to a user's brand: the OAuth return never links anything by itself — graph-api stores the proposed pages (encrypted, single-use, 15 min) in `oauth_page_selections` and the admin picks; a page already linked to another brand is refused, never moved; the return URL comes from `ADMIN_WEB_URL`, never from the client. It is the **only** way to link a page: the mobile app no longer connects or reconnects accounts (it lists, syncs and disconnects them) and `POST /social-accounts/:provider/connect` answers `403 forbidden`. See [admin-web/README.md](admin-web/README.md) and [docs/ADMIN_CONSOLE.md](docs/ADMIN_CONSOLE.md). Its test tooling (Vitest 3, jsdom 26, Vite 7) is pinned for Node 20.

Plus PostgreSQL (5432) and MinIO (9000/9001) from [compose.yaml](compose.yaml), and [services/shared/](services/shared/) — dependency-free modules imported by both the API and the worker (publication statuses, mock social provider, image inspection, queue names). Never import an npm package there: each service keeps its own `node_modules` and the shared files would not resolve it.

Work is sprint-driven: `sprint_listing/` holds the 14-sprint plan and per-sprint specs (git-ignored, local only), [docs/](docs/) holds the delivered-state documentation. Before implementing a feature, read the matching `sprint_listing/SPRINT_XX_*.md` and the corresponding `docs/SPRINT_XX_*.md`. Sprints 01–10 are delivered; the current branch is `backend-develop`.

## Commands

Everything is driven from the repo root; the PowerShell scripts auto-detect Docker or Podman.

```powershell
./scripts/start.ps1              # compose up --build --detach (requires .env)
./scripts/stop.ps1
./scripts/logs.ps1 api           # follow logs, optionally per service
./scripts/seed.ps1               # prisma db seed inside the api container → lea@studio-vega.fr / ChangeMe123!
./scripts/verify-readiness.ps1   # asserts /health and /ready on 3000, 3001, 8000, 8080
./scripts/test.ps1               # pytest + api tests + mobile typecheck + mobile lint
```

Per package:

```bash
npm --prefix services/api test                 # node test/run.js → imports every *.test.js
npm --prefix services/worker test              # delivery + media-cleanup, against an in-memory DB double
npm --prefix social-media start                # expo start
npm --prefix social-media run typecheck        # tsc --noEmit
npm --prefix social-media run lint             # expo lint
```

Single test — the API tests are plain `node:test` files, so run one directly (from `services/api/`):

```bash
node --test test/brands.test.js
node --test --test-name-pattern "brand roles" test/brands.test.js
```

`graph-api` and `services/ai-service` tests each need their own virtualenv (`python -m venv venv`, activate, `pip install -r requirements.txt`); the deps are not in the global interpreter here, so `scripts/test.ps1` fails at those pytest steps without them. Then `python -m pytest -q` or `python -m pytest tests/test_health.py::test_ready_reports_missing_meta_configuration`.

The AI models are **not** committed: run `python -m training.train` then `python -m training.evaluate` from `services/ai-service/` to produce `artifacts/` (a few seconds, fixed seed so the result is identical every time). The Docker image does this at build time. Without artifacts, `/ready` answers 503 `model_artifacts_missing` — the test suite trains its own copy in a temp directory, so it does not depend on them.

Prisma migrations are applied by the API container at startup (`npx prisma migrate deploy` in [services/api/Dockerfile](services/api/Dockerfile)); after editing [schema.prisma](services/api/prisma/schema.prisma), add a migration under `prisma/migrations/` and restart the stack.

Node ≥ 20.19.4 is required by React Native 0.83; this machine runs 20.19.0, so `EBADENGINE` on `npm install` is expected noise. pg-boss is pinned to `^10.4.2` on purpose: 11+ requires Node 22, which the `node:20-alpine` images do not provide.

Both service images build from the **repo root** (`context: .` in compose) so they can copy `services/shared` while keeping relative paths; a Dockerfile path is therefore always `services/<name>/…`.

## Architecture and invariants

Trust boundaries (see [docs/DECISIONS_ARCHITECTURE.md](docs/DECISIONS_ARCHITECTURE.md)):

- The mobile app talks **only** to the Express API. It never reaches PostgreSQL, MinIO, Meta or the AI service. Media are served as short-lived signed URLs (`S3_PUBLIC_ENDPOINT` is the host the phone can reach), never as storage keys.
- User JWTs are accepted by Express only. Express and the worker mint short-lived service JWTs for `/internal/v1`, signed with the shared `SERVICE_JWT_SECRET` but **scoped by audience**: `social-service` for graph-api, `ai-service` for the AI service. A token minted to publish on Meta is rejected by the AI service and vice-versa; scopes split further (`social:read`/`social:write`, `ai:analyze`/`ai:generate`).
- Meta tokens stay server-side and are never returned to the client.

HTTP contract ([docs/CONTRATS_API.md](docs/CONTRATS_API.md)), enforced by [services/api/src/lib/http.js](services/api/src/lib/http.js):

- Success: `{ data, meta: { requestId } }` via `sendSuccess`; lists add a `page` object. Errors: `{ error: { code, message, details?, requestId } }` — always thrown as `HttpError` with a stable code from the documented table (`validation_failed`, `authentication_required`, `token_expired`, `forbidden`, `not_found`, `conflict`, `rate_limited`, …).
- `/health`, `/ready` and `/openapi.json` are deliberately outside the envelope and outside `/api/v1`. Every service implements the same pair: `/health` never depends on external configuration, `/ready` returns 503 with a `reason` when local config is missing (`graph-api` is 503 until Meta credentials exist — that is normal locally).

Express service layout — one folder per domain (`auth/`, `profile/`, `brands/`) with the same four files: `routes.js` (thin, parses with Zod through the local `parse()` helper), `schemas.js` (Zod), `service.js` (Prisma + business rules), `middleware.js`. Cross-cutting helpers live in `lib/` and `db/prisma.js`.

Authorization: [auth/middleware.js](services/api/src/auth/middleware.js) `requireAuthentication` validates the access token *and* re-checks the session row (revocation, expiry, user status) on every request. [brands/middleware.js](services/api/src/brands/middleware.js) `requireBrandAccess(minimumRole)` ranks `VIEWER < COMMUNITY_MANAGER < ADMIN < OWNER`; a brand the user is not a member of returns **404, not 403**, so brand existence is never disclosed. Never trust a `brandId` from the client without it.

Data rules worth knowing before touching [schema.prisma](services/api/prisma/schema.prisma): refresh tokens are rotated and stored hashed in `user_sessions`; brand deletion is an archive (`deletedAt` + `ARCHIVED`), never a physical delete; `brand_ai_settings` rows are immutable versions — an update requires `expectedVersion` and creates a new version, returning `409 version_conflict` on a stale write; sensitive actions write to `audit_logs` via `lib/audit.js`.

`graph-api` layers as routes → services → `clients/facebook_client.py`. The client refuses to call Meta unless `settings.meta_configured` (raises 503), which is what keeps health checks and local work possible without credentials. Add new Meta capabilities by extending that chain, not by calling httpx from a route. (The `Servlet*.java` files under `api/routes/` are legacy reference material, not part of the app.)

Publishing is asynchronous and that shape is deliberate: `POST /publications/{id}/publish` (and `/retry`) claims the publication with a **conditional status update**, enqueues a pg-boss job, and answers `202` — the worker performs the delivery. Four independent guards stop a target being sent twice: the pg-boss `singletonKey` per publication, that conditional claim, a per-target claim (`PENDING|FAILED → SENDING`), and a unique idempotency key per delivery attempt. If the queue is unreachable the API releases the claim and returns `503`, so a publication never stays stuck in `publishing`. The publication's global status is always recomputed from the targets by `computePublicationStatus` in [services/shared/publication-status.js](services/shared/publication-status.js) — never set by hand.

Posts already on a linked Facebook page are **imported**, not only the ones Hootly published ([docs/SYNCHRO_PUBLICATIONS.md](docs/SYNCHRO_PUBLICATIONS.md)). graph-api `POST /internal/v1/posts/sync` reads `/{page}/posts` and writes a `publications` row (`origin = IMPORTED`, `PUBLISHED`) plus a `publication_targets` row (`SENT`), so comments, metrics and analytics work on the history unchanged; being `PUBLISHED`, an imported post can never be edited, scheduled or republished. The worker (`posts-sync.js`, queue `sync-social-posts`) only picks accounts and loops on the cursor graph-api returns; a job is queued when a page is linked, by the admin/mobile "Synchroniser" actions, and by a 30-minute sweep that is also the safety net for the initial import. **Initial vs incremental is decided by graph-api alone** from `social_accounts.last_posts_sync_at` (empty = full history; otherwise `since` = that date − 7 days), written only once the last page has been read, so an interrupted import restarts cleanly. The dedupe key is the unique `(social_account_id, external_publication_id)` on `publication_targets`; a re-read fills a Hootly post's `external_url` but never rewrites its text. `comment-sync` re-reads only the 50 most recent posts per account (an imported history has hundreds). Imported historical *comments* are deliberately not backfilled (they would land as `NEW` in the inbox and hit AI analysis) — see the doc's limits before changing that.

Until Sprint 06 there are no social accounts: targets are keyed by `provider`, `publication_targets.social_account_id` is nullable and has no foreign key, and deliveries go through the deterministic `MockSocialProvider`. Content markers (`[[TIMEOUT]]`, `[[FAIL_PERM]]`, `[[FAIL_INSTAGRAM]]`, …) drive its outcomes in demos and tests.

## Mobile app

expo-router file-based routing in [social-media/app/](social-media/app/); all shared code is in `src/` behind the `@/*` path alias. Typed routes are on, so route changes require a `typecheck` run.

[src/data/api.ts](social-media/src/data/api.ts) is the single network façade and is being migrated domain by domain. `auth`, `profile`, `brandsApi`, `publicationsApi` and `mediaApi` call the real Express API through `fetchApi` (which attaches the bearer token, refreshes once on 401 via `refreshAccessToken`, then clears the session); `accountsApi`, `commentsApi`, `notificationsApi`, `dashboardApi`, `analyticsApi` and the hashtag helpers are still in-memory fixtures with simulated latency and failures. When wiring a screen to the backend, replace the body but keep the exported signature — screens depend on it. Media upload is the one call that does not use `fetch`: it goes through `XMLHttpRequest` so the picker can show real upload progress.

Conventions the codebase already enforces (see [social-media/README.md](social-media/README.md)): every read goes through `useAsync`/`usePaginatedList` and every write through `useMutation` (single in-flight call); all text renders through `components/ui/Text`; technical errors never reach the screen — `toUserMessage()` maps `ApiErrorCode` to copy; missing metrics show "Non disponible", never `0`; tokens live in `expo-secure-store` only.

User-facing strings, comments in the newer backend code, and the docs are in French — match the surrounding language when editing. Some source files contain mojibake from earlier encoding accidents (`Ã©`); don't propagate it, and fix it only in lines you are already touching.
