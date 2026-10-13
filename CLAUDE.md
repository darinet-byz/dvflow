# CLAUDE.md
# dvflow
# AI Coding Agent Operating Instructions

> This file is the operating guide for Claude Code / vibe-coding agents working in this repository.
> It does NOT replace the PRD, Blueprint, UI/UX guideline, or engineering contracts.
> When this file conflicts with an authoritative project document, follow the source-of-truth hierarchy below.

---

## 1. PROJECT MISSION

Build and maintain **dvflow**, an internal operational dashboard for:

- receiving OrderOnline webhooks;
- maintaining one Master Order per Order ID;
- normalizing payment/order status;
- calculating configurable payment tax/fees;
- generating canonical product names/codes;
- managing webinar attendance;
- managing offline seminar attendance through QR/manual check-in;
- reporting order, payment, tax, and attendance data;
- searching/filtering operational data efficiently.

This is an **operational application**, not a marketing website.

Primary qualities:

- correct business rules;
- reliable operational workflows;
- clear data;
- safe access control;
- responsive UI;
- predictable behavior;
- maintainable implementation.

---

## 2. SOURCE OF TRUTH — READ IN THIS ORDER

Before making implementation decisions, use this hierarchy:

1. `docs/PRD.md`
2. `docs/Blueprint.md`
3. `docs/UI-UX-Design-Guideline-OrderOnline-App.md`
4. `docs/Reference-Webhook-Order-From-Checkout-Form` — sample payload webhook (checkout form)
5. `docs/Reference-Webhook-Order-Form-Storefront` — sample payload webhook (storefront)
6. `docs/00-AI-AGENT-BUILD-CONSTITUTION.md`
7. `docs/01-IMPLEMENTATION-DECISIONS.md`
8. `docs/02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md`
9. `docs/03-WORKER-API-CONTRACT.md`
10. `docs/04-RBAC-AUTH-AND-SECURITY.md`
11. `docs/05-EDGE-CASES-AND-ACCEPTANCE-TESTS.md`
12. `docs/06-DEPLOYMENT-ENV-AND-BUILD-RUNBOOK.md`
13. `docs/AMENDMENTS.md`
14. Existing code

If the repository stores these documents under `docs/` or another folder, locate the existing copy instead of creating duplicates.

The two `Reference-Webhook-*` files are **observed payload samples, not contracts**. They show
the real external key names, so the adapter may map them; they are still incomplete (see §12),
so webhook integration MUST NOT be called production-ready.

### Conflict rule

- Product/business scope comes from PRD + Blueprint.
- Visual behavior comes from UI/UX Guideline.
- Engineering gaps already resolved in `01-IMPLEMENTATION-DECISIONS.md` MUST use those decisions.
- Database implementation MUST follow the Data Dictionary.
- Worker endpoints, status codes, request/response behavior MUST follow the API Contract.
- Permissions/security MUST follow RBAC/Auth/Security.
- Done criteria MUST be checked against Acceptance Tests and Runbook.
- If existing code conflicts with authoritative documentation, **change the code**, not the requirement.

---

## 3. CORE RULE: NEVER INVENT PRODUCT REQUIREMENTS

Do not silently add product behavior.

If a requirement is unclear:

1. inspect PRD;
2. inspect Blueprint;
3. inspect UI/UX guideline;
4. inspect Implementation Decisions;
5. inspect Schema/API/RBAC contracts;
6. inspect Acceptance Tests;
7. inspect existing implementation only for context.

If the answer still does not exist:

`BLOCKED_BY_REQUIREMENT`

Do not invent a feature to make the task feel complete.

Engineering choices that are implementation-only may be made when they do not change product behavior, security boundaries, API contracts, schema contracts, or UX requirements.

---

## 4. NON-NEGOTIABLE BUSINESS RULES

Never violate these rules.

### Orders

- `1 Order ID = 1 Master Order row`.
- Repeated webhooks MUST update/upsert the same order.
- Never create a new Master Order row per webhook retry.
- No Master Order edit/delete feature in MVP.
- Order detail drawer is read-only.

### Status mapping

Canonical mapping:

```text
pending     -> Pending
processing  -> Paid
complete    -> Paid
cancelled   -> Cancelled
```

Unknown provider status:

- do NOT guess;
- do NOT map to Pending/Paid/Cancelled silently;
- follow API Contract error behavior.

### Leads

One new unique Order ID equals one lead.

Do not count webhook requests as leads.

### Product configuration

Do NOT hardcode:

- Product;
- Advertiser;
- Event Type;
- Session;
- Tax/Fee rule.

Configuration must come from database-backed configuration.

Canonical product pattern:

```text
[PRODUCT_CODE][ADVERTISER_CODE][TYPE_CODE][BATCH] - [SESSION_CODE] - [CITY]
```

Example:

```text
KM01SO392 - S1 - Solo
```

Batch MUST remain a string so values such as `001` do not lose leading zeroes.

Parser MUST NOT fuzzy guess.

### Invalid product parsing

If `product_raw` is invalid or a code cannot be resolved:

- preserve the Order;
- preserve `product_raw`;
- unresolved normalized fields become `NULL`;
- set `product_parse_status = invalid`;
- do not auto-create configuration;
- deny participant event access when event type cannot be determined.

### Tax

Tax is configuration-driven.

Supported fee types:

```text
flat
percentage
```

Percentage values are stored as percentage numbers:

```text
0.7 = 0.7%
```

Formula:

```text
tax = gross * (fee_value / 100)
```

Tax rule matching:

- use canonical normalized payment identifier;
- exact normalized match only;
- active rule only;
- no fuzzy fallback.

If no mapping exists:

```text
tax_amount = 0
net_amount = gross_amount
tax_mapping_status = unmapped
```

Historical tax MUST be a snapshot.

Editing/deactivating current fee rules MUST NOT rewrite historical orders.

### Attendance

Database attendance is row-based.

Never create database columns such as:

```text
timestamp_1
timestamp_2
...
timestamp_10
```

UI may display latest timestamps as T1...T10, but storage remains row-based in `attendance_events`.

Attendance raw-event retention:

```text
30 days
```

Deleting old attendance MUST NOT delete Master Orders.

### Webinar

For a valid Paid webinar access:

1. validate Order;
2. validate Paid;
3. validate parsed event;
4. resolve exact webinar destination;
5. insert attendance event;
6. HTTP 302 redirect.

Every successful webinar access/click creates a new attendance event.

If webinar destination is missing:

- do not record attendance;
- do not redirect to a guessed URL;
- return the defined configuration error.

### Seminar

Seminar check-in is idempotent.

One Order ID should have only one successful seminar attendance row.

Repeated seminar scan:

```text
ALREADY_CHECKED_IN
```

and should return the original successful timestamp.

QR is generated client-side.

A QR code is only an identifier/check-in URL — it is NOT authorization.

Server MUST always revalidate:

- authenticated operator;
- Order exists;
- `app_status = Paid`;
- event is Seminar Offline;
- duplicate state.

### Participant access

Access is allowed only when:

```text
known Order ID
+
Paid
+
valid parsed event
```

Pending, Cancelled, unknown orders, or invalid event products are denied.

Do not add additional participant tokens unless the requirements are explicitly changed.

---

## 5. SIDEBAR IS FIXED

Do not add, remove, rename, or reorder MVP navigation without a requirement change.

### OPERASIONAL

1. Scan QR
2. Dashboard Resume
3. Order
4. Presensi Acara

### KONFIGURASI

5. Konfigurasi Produk
6. Konfigurasi Tax
7. Report Tax
8. Product Name Generator

### ACCOUNT

9. Profil
10. Logout

MVP deliberately does NOT include:

- User Management page;
- Notification Center;
- Export menu;
- Audit Log UI;
- custom report menu;
- dashboard chart;
- OAuth;
- public signup;
- public forgot-password flow;
- Master Order edit/delete.

Do not introduce these as "helpful improvements."

---

## 6. TECH STACK BOUNDARIES

Expected architecture:

```text
OrderOnline
    ↓ webhook
Cloudflare Worker
    ↓
Supabase PostgreSQL
    ↓
Cloudflare Pages
    ↓
React Admin App
```

Frontend:

- React
- Tailwind CSS
- Cloudflare Pages
- browser/client-side QR generation

Backend:

- Cloudflare Workers

Database:

- Supabase PostgreSQL

Scheduled jobs:

- Supabase Cron / PostgreSQL cron

Do not refactor the repository only to match a preferred folder structure if the current repository already has clear frontend/backend/database boundaries.

Keep dependencies minimal.

Before adding a package, ask:

1. Can the platform/native API already do this?
2. Is the package required by a real project requirement?
3. Does it meaningfully reduce implementation complexity?
4. Does it conflict with the design system or runtime constraints?

Never install a UI kit that overrides or fights the project UI guideline.

---

## 7. AUTHENTICATION MODEL

There is NO public signup and NO Supabase Auth UI.

Login:

```text
username
password
```

Authentication is handled through Cloudflare Worker.

Password storage:

- PBKDF2-SHA256;
- Web Crypto;
- minimum 600,000 iterations;
- random salt >= 16 bytes;
- derived hash/salt never sent to browser.

Password policy:

- minimum 8 characters;
- username case-insensitive + unique;
- password remains case-sensitive;
- password change requires current password;
- new password and confirmation must match.

Do not add arbitrary complexity requirements for uppercase/numbers/symbols.

---

## 8. SESSION MODEL

Two credential layers:

### Refresh session

- opaque random token;
- only token hash stored in database;
- Secure cookie;
- HttpOnly;
- SameSite=Lax;
- server-side revocable;
- 7-day lifetime.

### Access JWT

- Supabase-compatible;
- 30-minute lifetime;
- held only in application memory;
- may be restored using refresh endpoint;
- NEVER store in `localStorage`.

Required claims include:

```text
role = authenticated
app_role = master_admin | admin | staff
app_user_id = users.id
sub = users.id
```

Never bypass incomplete custom JWT configuration by:

- disabling RLS;
- placing service key in frontend;
- opening anonymous table access.

---

## 9. RBAC

### Master Admin

Can:

- read all operational data;
- scanner/check-in;
- Product Name Generator;
- CRUD Product/Advertiser/Event Type/Session;
- CRUD Tax;
- Report Tax;
- update own profile;
- provision admin/staff via protected internal endpoint/tooling.

### Admin

Can:

- read all operational data;
- scanner/check-in;
- Product Name Generator;
- CRUD Product/Advertiser/Event Type/Session;
- CRUD Tax;
- Report Tax;
- update own profile.

Cannot provision Master Admin through normal behavior.

### Staff

Can:

- Dashboard read;
- Order read/search/filter;
- Presensi read/search/filter;
- scanner/check-in;
- Product Name Generator;
- update own profile.

Cannot:

- mutate Product configuration;
- mutate Tax configuration;
- access admin write endpoints;
- access Report Tax.

Permissions MUST be enforced server-side/RLS, not only by hiding buttons.

---

## 10. DATABASE CONTRACT

Do not create tables/columns casually.

Authoritative schema is:

`02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md`

Core tables include:

```text
users
app_sessions
products
advertisers
event_types
sessions_config
payment_fee_rules
orders
attendance_events
app_settings
webhook_logs (optional)
```

Do not add a new table unless allowed by the Data Dictionary or requirement update.

Do NOT create:

- separate `leads` table;
- separate `paid` table;
- separate report source table;
- duplicate order rows;
- Timestamp1...Timestamp10 attendance columns.

All schema changes:

- use a new versioned migration;
- do not edit already-applied shared migrations;
- preserve operational data;
- prefer forward-fix migrations after live data exists.

---

## 11. API CONTRACT

Worker routes MUST follow:

`03-WORKER-API-CONTRACT.md`

Do not casually change:

- route names;
- HTTP methods;
- success/error response shape;
- error codes;
- authorization requirements;
- endpoint semantics.

General JSON response pattern:

```json
{ "ok": true, "data": {} }
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable Indonesian message"
  }
}
```

Never expose:

- stack traces;
- raw SQL;
- database errors;
- secrets;
- internal credentials.

---

## 12. ORDERONLINE WEBHOOK — IMPORTANT BLOCKER

External OrderOnline JSON field names MUST NOT be guessed.

External payload must first be adapted to the canonical internal webhook object defined in the API Contract.

Business logic after the adapter must operate on canonical fields, not raw provider field names.

Before the adapter can be considered production-ready, real payload samples are required for at least:

- pending;
- processing/paid;
- complete if structurally different;
- cancelled;
- at least two payment methods.

**Current status: mostly mapped.** Two real samples are in the repository
(`docs/Reference-Webhook-Order-From-Checkout-Form`, `docs/Reference-Webhook-Order-Form-Storefront`),
and `packages/api/src/webhooks/adapter.ts` maps them. The **CO Form** envelope is the one that will
be used (one product per seminar/webinar session); `product_raw` is the product name in OrderOnline
(`payload.product_data.name`); `app_status` comes from the ORDER status
(`pending`/`processing`/`complete`/`cancelled`, PRD §52) and **never** from `payment.status`.

Still missing — and therefore still blocking a production-ready claim:

- samples for processing/complete/cancelled (both available samples are `pending`); the mapping is
  already settled by PRD §52, but the real payload shape of those transitions has not been seen;
- a second payment method (both are `bank_transfer`);
- whether `paymentIdentifier` is granular enough for per-bank fee rules — `payment.data` and
  `payment.channels` are empty in every sample, so the bank/channel field is unknown.

See `docs/AMENDMENTS.md` `VA-1` for the full canonical-to-payload mapping table, the resolved
questions, and the exact remaining list.

If those samples do not exist yet:

- build the canonical business layer;
- create a clearly isolated adapter boundary;
- use documented fixtures only when explicitly available;
- mark real provider mapping as blocked;
- NEVER claim webhook integration is production-ready.

Use:

`BLOCKED_BY_EXTERNAL_ORDERONLINE_PAYLOAD`

when this is the only missing dependency, or `BLOCKED_BY_REQUIREMENT` when the gap is a product
decision rather than a missing observation.

Webhook endpoint protection:

```text
/api/webhooks/orderonline/:webhookSecret
```

Wrong secret returns 404 according to contract.

Webhook processing must be safe under retries/concurrency.

---

## 13. UI / UX RULES

Authoritative visual guide:

`UI-UX-Design-Guideline-OrderOnline-App.md`

Style:

```text
Modern Soft SaaS Dashboard
```

Characteristics:

- clean;
- light;
- premium;
- data-first;
- low visual noise;
- comfortable for long operational sessions;
- strong hierarchy through spacing and typography rather than heavy borders.

Primary color family:

- indigo / blue-violet.

Status colors:

- Paid/Hadir/success -> green;
- Pending/attention -> yellow/orange soft;
- Cancelled/error -> red;
- Webinar -> blue soft;
- Seminar -> purple soft.

Use shared components for:

- Button;
- Input;
- Select;
- Badge;
- Card;
- KPI Card;
- Filter Bar;
- Filter Chip;
- Table;
- Drawer;
- Modal;
- Toast;
- Skeleton;
- Empty State;
- Error State.

Do not independently redesign each page.

### One primary action

Each functional area should have one visually dominant primary action.

Examples:

- Configuration -> `+ Tambah`
- Product Name Generator -> `Generate`
- Scanner -> scanner itself

### Modal vs Drawer

Use modal for:

- confirmation;
- simple edit;
- delete/deactivate confirmation;
- quick small detail.

Use drawer for:

- Order detail;
- Attendance detail;
- inspection where user should keep table context.

Do not put long forms into modals.

### Loading

Use skeleton for page/data loading.

Use small spinner only for actions such as:

- Save;
- Update;
- Generate;
- Check-in.

### Responsive behavior

Desktop-first operational dashboard, but must remain usable on tablet/mobile.

Scanner MUST be usable on mobile.

Tables may horizontally scroll on narrow screens.

---

## 14. DATA TABLE / QUERY RULES

Never load the entire database into the browser.

Use server-side:

- pagination;
- filter;
- search;
- sort.

Default page size:

```text
50
```

Optional:

```text
100
```

Search debounce:

```text
300 ms
```

Search:

- minimum 2 characters;
- numeric Order ID may search from 1 character;
- Enter triggers immediate search.

`Clear All`:

- clears structured filters;
- DOES NOT clear global search text.

Search text is cleared only using the search input clear action.

Active filter chips must remain visible.

Combined structured filters use AND semantics.

---

## 15. SORTING

### Order

Default:

```text
created_at DESC
```

Allowed sortable fields:

- order_id
- name
- app_status
- gross_amount
- tax_amount
- net_amount
- created_at
- paid_at
- updated_at

### Presensi

Default:

- latest attendance activity DESC;
- if no attendance, fallback to order `created_at DESC`.

Allowed sortable fields:

- order_id
- name
- total_activity
- latest_activity
- product_name
- batch
- session
- city

Do not expose arbitrary DB-column sorting.

---

## 16. DESIGN SYSTEM — IMPORTANT DEFAULTS

Do not invent a new global visual language.

Important baseline:

```text
Primary:        #4f46f5
Primary Hover:  #4338e8
Primary Soft:   #eef0ff
Text Primary:   #171821
Text Secondary: #737786
Border:         #eceef4
Success:        #35c96c
Danger:         #ef5b5b
Warning:        #f5b94c
```

Typography stack:

```css
Inter,
-apple-system,
BlinkMacSystemFont,
"Segoe UI",
Roboto,
Arial,
sans-serif
```

General:

- page title ~22–24px / 700;
- body ~13–14px;
- consistent radius system;
- spacing based on 4px scale;
- main card radius ~18px;
- inputs/buttons ~10px radius;
- avoid heavy shadows;
- avoid strong borders;
- avoid excessive gradients;
- preserve negative space.

When implementing exact components, consult the UI/UX guideline rather than approximating from this summary.

---

## 17. SECURITY RULES

Never expose to frontend:

- Supabase secret/service key;
- password hash/salt;
- refresh token hash;
- JWT private signing key;
- webhook secret;
- Worker secrets.

Frontend public env is limited to public values such as:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_API_BASE_URL
```

Backend-only secrets include:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
APP_JWT_PRIVATE_KEY
APP_JWT_KEY_ID
ORDERONLINE_WEBHOOK_SECRET
```

Security expectations:

- RLS stays enabled;
- no anonymous reads of Orders/Attendance;
- backend/service secret only server-side;
- state-changing cookie-authenticated endpoints validate same-origin Origin/Host;
- React escaping must not be bypassed for user/webhook-controlled values;
- avoid `dangerouslySetInnerHTML`;
- never interpolate raw webhook input into SQL;
- logs must not contain credentials/tokens/passwords/secrets.

---

## 18. WORKFLOW FOR EVERY CODING TASK

When asked to implement or modify something, follow this order.

### Step 1 — Understand the task

Identify:

- requested behavior;
- affected layer(s);
- business rule involved;
- relevant page/API/table;
- security/RBAC implication;
- acceptance tests likely affected.

Do not start editing immediately if the existing implementation has not been inspected.

### Step 2 — Inspect the repository

Find:

- current files;
- existing component patterns;
- existing utilities;
- routes;
- migrations;
- tests;
- environment setup.

Reuse existing architecture where it already satisfies the contracts.

Avoid unnecessary refactors.

### Step 3 — Read relevant documentation

At minimum read the specific authoritative sections relevant to the task.

Examples:

Authentication task:

- Implementation Decisions;
- API Contract;
- RBAC/Auth/Security;
- Data Dictionary;
- Acceptance Tests.

UI task:

- PRD/Blueprint feature requirement;
- UI/UX guideline;
- Acceptance Tests.

Database task:

- Data Dictionary;
- Implementation Decisions;
- Acceptance Tests;
- Runbook migration rules.

Webhook task:

- PRD;
- Implementation Decisions;
- API Contract;
- Data Dictionary;
- Acceptance Tests.

### Step 4 — State constraints internally

Before coding, confirm:

- scope is known;
- no forbidden feature is being introduced;
- schema/API contract remains valid;
- permission boundary is known;
- test expectations are known.

### Step 5 — Implement the smallest correct change

Prefer:

- focused modifications;
- shared components/utilities;
- reusable domain helpers;
- explicit validation;
- deterministic behavior.

Avoid:

- speculative abstraction;
- broad rewrites;
- unrelated formatting churn;
- moving files solely for aesthetic reasons;
- new dependencies without need.

### Step 6 — Validate

Run the relevant available checks:

- unit/integration tests;
- acceptance-test-aligned checks;
- typecheck;
- lint;
- production build;
- migration review;
- secret scan where relevant.

If the repo does not yet contain a testing framework, do not fabricate a claim that tests passed.

### Step 7 — Report precisely

State:

- what changed;
- files changed;
- relevant behavior;
- tests/checks run;
- result;
- blockers;
- any requirement gap.

Do not say `DONE` when a required validation is failing or skipped without reason.

---

## 19. DEFINITION OF DONE

A task may be called DONE only when all relevant conditions are satisfied:

- implementation matches source of truth;
- no new product scope was silently introduced;
- schema conforms to Data Dictionary;
- migration discipline is respected;
- API conforms to Worker API Contract;
- RBAC/security rules are enforced;
- UI follows the shared design system;
- relevant acceptance cases pass;
- lint passes;
- typecheck passes;
- build passes;
- no backend secret appears in frontend/repository output;
- no business-critical TODO remains;
- retry/duplicate behavior is correct where relevant;
- empty/error/loading states exist where relevant;
- mobile behavior is checked where relevant.

If not, report the exact incomplete item.

---

## 20. TESTING EXPECTATIONS

Use `05-EDGE-CASES-AND-ACCEPTANCE-TESTS.md` as executable behavior guidance.

For every changed feature, test relevant combinations of:

- happy path;
- unauthorized/forbidden path;
- invalid input;
- empty state;
- loading state;
- error state;
- duplicate/retry;
- concurrent request behavior when relevant;
- narrow/mobile screen behavior;
- security boundary.

Especially protect:

- repeated webhook idempotency;
- repeated seminar scan uniqueness;
- historical tax snapshots;
- RLS;
- Staff write denial;
- participant access denial for non-Paid orders;
- no secret leakage.

---

## 21. PRODUCTION-READINESS RULE

Do NOT describe the entire system as production-ready until the blockers in the Acceptance Tests/Runbook are satisfied.

At minimum:

- real OrderOnline payload mapping tested;
- Supabase custom JWT trust/signing configured;
- RLS tests pass;
- first Master Admin securely provisioned;
- webinar destinations configured for active webinars;
- retention cron verified;
- Cloudflare/Worker secrets configured.

A feature may be locally complete while the system is still not production-ready.

Use precise wording.

---

## 22. GIT / CHANGE HYGIENE

When working in an existing repository:

- do not overwrite unrelated user changes;
- inspect before editing;
- keep diffs focused;
- do not rewrite working files merely for style;
- never commit `.env` secrets;
- keep generated artifacts/build output out of source unless repo intentionally tracks them;
- preserve lockfile consistency;
- do not change package manager unless explicitly required.

Do not delete code because it appears unused until references are checked.

---

## 23. COMMENTS AND CODE QUALITY

Prefer code that explains itself.

Use comments for:

- non-obvious business rules;
- security boundaries;
- idempotency/concurrency logic;
- historical snapshot behavior;
- contract-driven limitations.

Avoid comments that simply narrate syntax.

Prefer domain names matching the project terminology:

```text
order_id
product_raw
product_parse_status
app_status
attendance_events
payment_identifier
tax_mapping_status
```

Do not rename canonical concepts casually.

---

## 24. WHEN CLAUDE SHOULD STOP INSTEAD OF GUESSING

Stop and surface a blocker if implementation requires information not present in authoritative sources, especially:

- actual OrderOnline external JSON keys;
- undocumented third-party behavior;
- new business workflow;
- new menu;
- new role capability;
- new table/entity;
- new tax semantics;
- new participant authorization model;
- undocumented destructive data operation.

Use one of:

```text
BLOCKED_BY_REQUIREMENT
BLOCKED_BY_EXTERNAL_ORDERONLINE_PAYLOAD
BLOCKED_BY_ENVIRONMENT
```

and explain exactly what input is missing.

Do not hide the blocker by shipping a fake placeholder as production logic.

---

## 25. DEFAULT RESPONSE STYLE DURING VIBE CODING

When reporting coding work to the user:

- use Indonesian unless the user asks otherwise;
- be concise but concrete;
- explain decisions in practical terms;
- list blockers clearly;
- avoid dumping huge code unless requested;
- if a command failed, say what failed and why;
- never claim success without verification.

Suggested completion format:

```text
Selesai:
- ...
- ...

Validasi:
- typecheck: PASS
- lint: PASS
- tests: PASS
- build: PASS

Catatan:
- ...
```

If blocked:

```text
Status: BLOCKED_BY_REQUIREMENT

Yang sudah selesai:
- ...

Yang belum bisa diputuskan:
- ...

Data/keputusan yang dibutuhkan:
- ...
```

---

## 26. FINAL REMINDER

This repository is intentionally contract-driven.

The safest implementation is NOT the one with the most features.
The correct implementation is the one that:

- matches the written requirements;
- preserves business rules;
- respects security boundaries;
- remains operationally simple;
- passes the project acceptance tests.

When uncertain:

**read the project documents first, then code.**
