# DEPLOYMENT, ENV & BUILD RUNBOOK
## dvflow

Versi: 1.0

## 1. Environments
Minimum:
- local
- production

Optional staging boleh dibuat jika workflow tim membutuhkan, tetapi bukan fitur aplikasi.
Jangan berbagi production secrets ke local.

## 2. Repository structure recommended
```text
/
  apps/
    web/          React + Tailwind + Cloudflare Pages
    worker/       Cloudflare Worker
  supabase/
    migrations/
    seed.sql
  docs/
    PRD.txt
    UI-UX-Design-Guideline-OrderOnline-App.md
    agent-contracts/
  README.md
  .env.example
```

Jika existing repo punya struktur lain, jangan refactor hanya demi mengikuti contoh ini selama boundaries tetap jelas.

## 3. Frontend environment
Public only:
- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY
- VITE_API_BASE_URL

Never:
- service/secret key
- JWT private key
- webhook secret

## 4. Worker secrets
Required:
- SUPABASE_URL
- SUPABASE_SECRET_KEY
- APP_JWT_PRIVATE_KEY
- APP_JWT_KEY_ID
- ORDERONLINE_WEBHOOK_SECRET

Optional:
- ALLOW_MASTER_ADMIN_CREATE_MASTER=false

## 5. Local seed
Seed only stable config:
- Event Type: Seminar Offline / SO / seminar
- Event Type: Webinar Online / WO / webinar
- Session: Sesi 1 / S1
- Session: Sesi 2 / S2
- Session: Sesi Tunggal / ST

Do not seed fake business products/advertisers into production migration.
Development-only fixture data must be separated.

## 6. First Master Admin
Provide a developer CLI/script that:
1. prompts username, display name, initial password;
2. computes same PBKDF2 format used Worker;
3. inserts role master_admin;
4. never prints raw password after confirmation;
5. must not ship a default password.

No public bootstrap endpoint.

## 7. Migration discipline
- every schema change -> new migration;
- migrations reviewed before production apply;
- backup/check before destructive migration;
- no hard delete migration of operational data without explicit approval.

## 8. Cron
Attendance retention daily:
```sql
DELETE FROM attendance_events
WHERE clicked_at < NOW() - INTERVAL '30 days';
```

Webhook logs if table enabled:
```sql
DELETE FROM webhook_logs
WHERE created_at < NOW() - INTERVAL '7 days';
```

Run daily off-peak.

## 9. Pre-deploy checks
- npm install lockfile deterministic;
- typecheck;
- lint;
- tests;
- production build;
- migration dry review;
- secret scan;
- verify no service key in frontend output;
- verify API base URL production;
- verify webhook secret path configured;
- verify RLS enabled.

## 10. Post-deploy smoke test
1. login Master Admin;
2. Dashboard loads;
3. Product Generator produces known example;
4. create/deactivate one test config where safe;
5. send sanitized/test webhook;
6. verify one Master Order;
7. verify repeated webhook still one row;
8. verify Paid seminar ticket;
9. verify scanner check-in;
10. verify duplicate scan result;
11. verify Paid webinar redirect in a test event;
12. logout.

## 11. Rollback principle
Frontend/Worker code may rollback to prior deployment.
Database rollback is not automatic for migrations that have received live data.
Prefer forward-fix migration rather than destructive down migration.

## 12. Dependency policy
Keep dependencies minimal.
Before adding package, coding agent must check:
- can platform/native API handle it?
- is package needed by a requirement?
- does it meaningfully reduce complexity?

Do not install UI kit that fights the existing UI guideline.
Suggested categories only when needed:
- React router
- Supabase JS client
- QR scanner/generator library
- Lucide icon library
- schema validator

Exact library choice is engineering implementation detail, not business requirement; pin versions via lockfile.

## 13. OrderOnline webhook adapter onboarding
Before production:
1. capture raw sample payloads from OrderOnline test/live-safe transaction;
2. redact personal data for documentation copy;
3. document external key -> canonical key mapping;
4. build fixtures;
5. test all source statuses;
6. test at least two payment identifiers;
7. freeze adapter fixture tests.

Do not infer provider keys from screenshots or memory.

## 14. Webinar destination operations
For each active Webinar product_raw:
- insert app_settings key `webinar_destination::<product_raw>`;
- value must be verified destination URL;
- perform one test access before ads/event begin.

## 15. Tax config operations
Before a payment method goes live:
- capture exact canonical payment identifier;
- add fee rule;
- run calculation fixture;
- ensure identifier uniqueness;
- do not edit historical order manually to "sync" fee changes.
