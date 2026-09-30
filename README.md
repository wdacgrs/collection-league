# FRA Collection League

A friendly, login-free registry for tracking Reality Fracture card collections and building decks against each player's owned pool. The card catalog and all player data live in Cloudflare D1. `data/catalog.json` is the bundled **seed** for the catalog — the catalog itself is now stored in the database and editable through the password-guarded admin panel.

## Stack

- **Framework**: Next.js (App Router) via [vinext](https://vinext.dev) on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Deployment**: Cloudflare Workers + CI/CD via GitHub Actions
- **Tests**: Vitest + fast-check (property-based)

## Deck builder: commander color identity

The deck builder enforces the Commander subset rule. Each card in `data/catalog.json` carries a `colorIdentity` string (canonical WUBRG, empty string for colorless). When a deck has a commander selected (up to two, for partners), the "Your collection" / "Add cards" list only shows cards whose color identity is a subset of the commander(s) identity. Colorless cards and basic lands stay available under any commander. Cards already in the deck that fall outside the commander's colors remain visible but are flagged and cannot have their quantity increased.

The comparison rules live in two pure, unit-tested modules:

- `src/lib/color-identity.ts` — parse / serialize / subset / union over WUBRG sets.
- `src/lib/deck-identity.ts` — commander resolution, legality, out-of-identity, and selection-list membership.

### Refreshing catalog color identity

`colorIdentity` is authored at build time from [Scryfall](https://scryfall.com/sets/fra), never fetched at request time (the Workers runtime has no request-time network/fs for this). To regenerate after catalog changes:

```bash
node scripts/enrich-catalog.mjs
```

The script fetches the Reality Fracture block from Scryfall, writes a canonical `colorIdentity` into every `data/catalog.json` entry, cross-checks each value, and aborts without writing if any card has no Scryfall match. This edits the bundled **seed** only; reseed the database afterward (admin panel → "Reseed from bundled catalog", or `POST /api/admin/catalog/seed`). `validateCatalog()` rejects any card whose `colorIdentity` is missing or non-canonical on every write path.

## Card catalog (database)

The catalog is stored in the D1 `Catalog` table and read at request time via `getCatalog()` in `src/lib/catalog.ts`. The pure, DB-free primitives (the `CatalogCard` type, `validateCatalog`, `parseCatalogCard`, and the bundled seed accessor) live in `src/lib/catalog-data.ts` so they can be unit-tested without the Workers runtime.

A fresh database starts with an **empty** catalog. Seed it from the bundled `data/catalog.json` via the admin panel, or:

```bash
curl -X POST https://<your-host>/api/admin/catalog/seed --cookie "fra_admin=<session>"
```

### Admin panel

Visit `/admin`. It is guarded by a single password read from the `ADMIN_PASSWORD` environment variable (see below). From there you can:

- **Card catalog** — full CRUD: add a single card, edit any field inline and save per row, delete a card, reseed from the bundled dataset, or bulk-replace the whole catalog via JSON.
- **Site settings** — a generic key/value store (`SiteSetting` table) for future site-wide options.

The catalog admin API (all guarded by the admin session cookie):

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/admin/catalog` | List all cards |
| `POST` | `/api/admin/catalog` | Create one card |
| `PUT` | `/api/admin/catalog` | Replace the entire catalog (`{ catalog: [...] }`) |
| `GET` | `/api/admin/catalog/:name` | Fetch one card |
| `PUT` | `/api/admin/catalog/:name` | Update / rename one card |
| `DELETE` | `/api/admin/catalog/:name` | Delete one card |
| `POST` | `/api/admin/catalog/seed` | Reseed from the bundled JSON |
| `GET` / `PUT` | `/api/admin/settings` | Read / upsert site settings |
| `POST` | `/api/admin/login` · `logout` · `session` | Auth |

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Apply migrations to the local D1 database
npm run db:migrate:local

# 3. Start the dev server (vinext / Vite)
npm run dev
```

Open the local URL printed by Vite (by default `http://localhost:5173`).

## Tests

```bash
npm test        # vitest --run (single pass, no watch)
```

Pure logic (color identity, commander resolution, filtering) is covered by Vitest unit tests plus fast-check property tests (100 iterations each). `tsc --noEmit` type-checks the project but does not catch the Workers/D1 runtime constraints — see `.kiro/steering` for those.

## Environment variables

### GitHub Actions secrets

Set these in **Settings → Secrets and variables → Actions** on your GitHub repo:

| Secret | Description |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Edit + D1 Edit** permissions. Create at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens). |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID. Found in the dashboard URL: `dash.cloudflare.com/<account-id>`. |
| `D1_DATABASE_ID` | UUID of the D1 database. Found in `wrangler.toml` → `database_id`, or via `cf d1 list`. |

### GitHub Actions variables (optional — for forks / staging)

Deploy targets are read from repository **variables** by `cloudflare.config.ts`; when unset, the upstream production values are used.

| Variable | Description |
|---|---|
| `CF_WORKER_NAME` | Production Worker name. The preview Worker is `<name>-preview`. |
| `CF_D1_NAME` / `CF_D1_ID` | Production D1 database name / UUID. |
| `CF_D1_PREVIEW_NAME` / `CF_D1_PREVIEW_ID` | Preview D1 database. Setting `CF_D1_PREVIEW_ID` enables develop → preview deploys. |

### Admin password

The admin panel at `/admin` is guarded by `ADMIN_PASSWORD`.

- **Production**: set it as a Worker secret — it takes precedence over any plaintext value in `wrangler.toml`:

  ```bash
  cf secret put ADMIN_PASSWORD
  ```

- The empty string and the placeholder `change-me` (the default committed in `wrangler.toml`) are **rejected** — either one leaves the panel disabled and all `/api/admin/*` routes locked. Set a real password before relying on the panel.
- The password is never stored in the session cookie; the cookie holds a SHA-256 token derived from it (`src/lib/admin-auth.ts`).

### Local development

No `.env` file is needed for local dev — the D1 binding is provided by the Vite dev server (workerd). To exercise the admin panel locally, set the password in `.dev.vars` (gitignored):

```ini
# .dev.vars — local secrets, never commit this file
ADMIN_PASSWORD = "a-real-local-password"
```

## Database

Migrations live in `drizzle/`. Schema is in `src/db/schema.ts`.

```bash
# Generate a new migration after editing the schema
npm run db:generate

# Apply migrations to local D1
npm run db:migrate:local

# Apply migrations to remote (production) D1
npm run db:migrate:remote
```

## Deployment

Pushes to `main` deploy to production via GitHub Actions (`.github/workflows/deploy.yml`). When `CF_D1_PREVIEW_ID` is set, pushes to `develop` deploy a separate preview Worker (`<name>-preview`) bound to its own D1 database, so preview migrations never touch production data.

To deploy manually:

```bash
# Make sure you're logged in
npx cf auth login

npm run deploy:vinext

# Preview Worker (needs CF_D1_PREVIEW_NAME or CF_D1_PREVIEW_ID in the environment)
npm run deploy:vinext -- --preview
```

## First-time setup

```bash
# 1. Create the D1 database
npx cf d1 create fra-db

# 2. Copy the returned database_id into wrangler.toml and package.json db scripts

# 3. Apply initial migrations
npm run db:migrate:remote

# 4. Deploy
npm run deploy:vinext
```
