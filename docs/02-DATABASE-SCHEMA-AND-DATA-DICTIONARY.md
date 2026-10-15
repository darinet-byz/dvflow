# DATABASE SCHEMA & DATA DICTIONARY
## dvflow

Versi: 1.0
Database: Supabase PostgreSQL

## 1. Prinsip
- `orders` adalah Master Order.
- `attendance_events` menyimpan raw attendance row-based.
- config tidak di-hardcode.
- tax historical disimpan sebagai snapshot pada Order.
- soft deactivate untuk configuration.
- direct browser query hanya melalui RLS + valid access JWT.

## 2. users
Purpose: login custom dan profile.

Fields:
- id UUID PK default gen_random_uuid()
- username TEXT NOT NULL
- username_normalized TEXT NOT NULL UNIQUE
- display_name TEXT NOT NULL
- password_hash TEXT NOT NULL
- password_salt TEXT NOT NULL
- password_iterations INTEGER NOT NULL DEFAULT 600000
- role TEXT NOT NULL CHECK role IN ('master_admin','admin','staff')
- avatar_emoji TEXT NULL
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Rule:
- password_hash/salt tidak pernah selectable oleh frontend RLS.

## 3. app_sessions
Purpose: refresh session custom.

Fields:
- id UUID PK default gen_random_uuid()
- user_id UUID NOT NULL FK users(id)
- token_hash TEXT NOT NULL UNIQUE
- expires_at TIMESTAMPTZ NOT NULL
- revoked_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- last_used_at TIMESTAMPTZ NULL

Tidak ada UI menu khusus.

## 4. products
- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

## 5. advertisers
- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

## 6. event_types
Purpose: mapping Seminar Offline / Webinar Online.

- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- kind TEXT NOT NULL CHECK kind IN ('seminar','webinar','hybrid')  -- hybrid: A14 (0030)
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Seed canonical:
- Seminar Offline / SO / seminar
- Webinar Online / WO / webinar

## 7. sessions_config
Purpose: mapping S1/S2/ST. Nama tabel sengaja tidak `sessions` agar tidak bentrok dengan app_sessions.

- id UUID PK
- name TEXT NOT NULL
- code TEXT NOT NULL
- code_normalized TEXT NOT NULL UNIQUE
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

## 8. payment_fee_rules
- id UUID PK
- name TEXT NOT NULL
- identifier TEXT NOT NULL
- identifier_normalized TEXT NOT NULL
- fee_type TEXT NOT NULL CHECK fee_type IN ('flat','percentage')
- fee_value NUMERIC(18,4) NOT NULL CHECK fee_value >= 0  -- e-payment fee (persen untuk percentage / percentage_flat)
- fee_type: flat | percentage | percentage_flat  -- percentage_flat: A16 (0032)
- fee_flat_value NUMERIC(18,4) NOT NULL DEFAULT 0  -- A16: bagian flat untuk percentage_flat
- platform_fee_applies BOOLEAN NOT NULL DEFAULT FALSE  -- A15 (0031)
- epayment_tax_type TEXT NULL CHECK IN ('flat','percentage')  -- A15; berpasangan dengan nilai
- epayment_tax_value NUMERIC(18,4) NULL CHECK >= 0  -- A15; % dihitung dari e-payment fee
- active BOOLEAN NOT NULL DEFAULT TRUE
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Constraint:
- partial unique index pada identifier_normalized WHERE active=true.

Percentage disimpan sebagai angka persen, contoh 0.7 berarti 0,7%, bukan 0.007.
Formula: gross * (fee_value / 100).

## 9. orders
Core fields:
- id UUID PK default gen_random_uuid()
- order_id TEXT NOT NULL UNIQUE
- name TEXT NULL
- phone TEXT NULL
- email TEXT NULL

Product raw + normalized:
- product_raw TEXT NULL
- product_parse_status TEXT NOT NULL DEFAULT 'invalid' CHECK IN ('valid','invalid')
- product_code TEXT NULL
- product_name TEXT NULL
- advertiser_code TEXT NULL
- advertiser_name TEXT NULL
- event_type TEXT NULL CHECK event_type IN ('Seminar Offline','Webinar Online','Hybrid') OR event_type IS NULL  -- Hybrid: A14 (0030)
- batch TEXT NULL
- session TEXT NULL
- city TEXT NULL

Status:
- raw_status TEXT NULL
- app_status TEXT NOT NULL CHECK app_status IN ('Pending','Paid','Cancelled')

Payment:
- payment_method TEXT NULL
- payment_provider TEXT NULL
- payment_identifier TEXT NULL
- payment_identifier_normalized TEXT NULL

Money:
- gross_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK gross_amount >= 0
- tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK tax_amount >= 0
- net_amount NUMERIC(18,2) NOT NULL DEFAULT 0
- tax_mapping_status TEXT NOT NULL DEFAULT 'unmapped' CHECK IN ('mapped','unmapped')

Tax snapshot:
- fee_rule_id UUID NULL
- fee_rule_name_snapshot TEXT NULL
- fee_type_snapshot TEXT NULL CHECK fee_type_snapshot IN ('flat','percentage') OR fee_type_snapshot IS NULL
- fee_value_snapshot NUMERIC(18,4) NULL
- fee_flat_value_snapshot NUMERIC(18,4) NULL  -- A16 (0032)
- epayment_tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0  -- A15 (0031)
- epayment_tax_type_snapshot TEXT NULL; epayment_tax_value_snapshot NUMERIC(18,4) NULL  -- A15
- platform_fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0  -- A15: hanya order Paid
- platform_fee_percent_snapshot NUMERIC(9,4) NULL  -- A15
- net_amount = gross_amount - tax_amount - epayment_tax_amount - platform_fee_amount  -- A15

Timestamps:
- source_created_at TIMESTAMPTZ NULL
- source_updated_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- paid_at TIMESTAMPTZ NULL
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

Rules:
- first insert created_at = local receive timestamp jika source_created_at tidak tersedia;
- paid_at diisi saat order pertama kali menjadi Paid; jangan dihapus bila repeated Paid webhook;
- if explicit source timestamp tersedia, simpan juga, jangan menimpa app receive timestamps secara ambigu.

## 10. attendance_events
- id UUID PK default gen_random_uuid()
- order_id TEXT NOT NULL
- attendance_type TEXT NOT NULL CHECK IN ('webinar','seminar')
- source TEXT NOT NULL CHECK IN ('webinar_redirect','seminar_qr','seminar_manual')
- scanner_user_id UUID NULL FK users(id)
- clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()

FK recommendation:
- order_id references orders(order_id) ON DELETE RESTRICT.

Seminar uniqueness:
- partial unique index `UNIQUE(order_id) WHERE attendance_type='seminar'`.

Webinar:
- tidak unique; setiap redirect valid membuat row.

Retention:
- delete attendance_events WHERE clicked_at < now() - interval '30 days'.

## 11. app_settings
Generic internal setting yang memang sudah disebut blueprint.

Fields:
- key TEXT PK
- value_text TEXT NULL
- updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
- updated_by UUID NULL FK users(id)

Key MVP yang diizinkan:
- `webinar_destination::<product_raw>`
- `seminar_ticket::<scope>` (A12)
- `fee_setting::platform_fee_percent` — PLATFORM FEE global dalam persen (A15, 0031)

Jangan menambah key lain tanpa requirement.

## 12. webhook_logs (optional but recommended for troubleshooting)
- id UUID PK
- provider TEXT NOT NULL DEFAULT 'orderonline'
- request_id TEXT NULL
- order_id TEXT NULL
- outcome TEXT NOT NULL
- error_code TEXT NULL
- payload_sanitized JSONB NULL
- created_at TIMESTAMPTZ NOT NULL DEFAULT now()

Retention 7 hari.
Jangan simpan credential/secret header.

## 13. Minimum indexes
orders:
- unique(order_id)
- index(product_code)
- index(advertiser_code)
- index(event_type)
- index(batch)
- index(session)
- index(city)
- index(app_status)
- index(created_at DESC)
- index(paid_at DESC)
- index(payment_identifier_normalized)

attendance_events:
- index(order_id)
- index(clicked_at DESC)
- partial unique seminar index.

Config:
- unique normalized code fields.

## 14. RLS matrix summary
Browser-facing SELECT:
- authenticated app users may SELECT orders, attendance_events, active config needed for UI, tax report sources, and own user profile fields.

Browser-facing WRITE:
- config writes allowed only master_admin/admin by RLS OR through protected Worker endpoint; choose one consistent implementation.
- attendance INSERT from browser forbidden; check-in must go through Worker.
- orders INSERT/UPDATE from browser forbidden; only Worker/service backend.
- users credential fields forbidden from browser.

Recommended implementation:
- read direct Browser -> Supabase;
- sensitive write through Worker;
- config CRUD may also go through Worker to simplify RBAC and validation.

## 15. SQL migration ordering
1. extensions if needed
2. users
3. app_sessions
4. products
5. advertisers
6. event_types
7. sessions_config
8. payment_fee_rules
9. orders
10. attendance_events
11. app_settings
12. webhook_logs optional
13. indexes
14. RLS policies
15. seed canonical event/session config
16. cron retention jobs

## 16. Prohibited schema shortcuts
- no Timestamp1...Timestamp10 columns;
- no separate leads table;
- no separate paid table;
- no separate report source table;
- no duplicated Order per webhook;
- no plaintext password;
- no `role` free-text values outside allowed enum/check;
- no hard-delete config from UI.
