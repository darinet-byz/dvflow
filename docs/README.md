# dvflow — AI Agent Pack

Paket ini adalah pelengkap PRD/Blueprint/UI-UX, bukan pengganti.

Urutan baca coding agent:
1. PRD.md
2. Blueprint.md
3. UI-UX-Design-Guideline-OrderOnline-App.md
3b. Reference-Webhook-Order-From-Checkout-Form + Reference-Webhook-Order-Form-Storefront
4. `00-AI-AGENT-BUILD-CONSTITUTION.md`
5. `01-IMPLEMENTATION-DECISIONS.md`
6. `02-DATABASE-SCHEMA-AND-DATA-DICTIONARY.md`
7. `03-WORKER-API-CONTRACT.md`
8. `04-RBAC-AUTH-AND-SECURITY.md`
9. `05-EDGE-CASES-AND-ACCEPTANCE-TESTS.md`
10. `06-DEPLOYMENT-ENV-AND-BUILD-RUNBOOK.md`

## Kenapa dokumen ini dibutuhkan
Dokumen sumber sudah sangat lengkap untuk product scope dan UI, tetapi sengaja menyisakan area engineering sebagai "belum ditentukan". Paket ini mengunci area tersebut agar vibe coding agent tidak menebak sendiri.

## Satu dependency eksternal yang masih wajib diambil
**Sample payload webhook OrderOnline nyata.**

Dua sample sudah tersedia di folder ini (`Reference-Webhook-Order-From-Checkout-Form` dan
`Reference-Webhook-Order-Form-Storefront`), tetapi keduanya hanya berstatus `pending` dengan
`payment.method = bank_transfer`. Adapter OrderOnline belum boleh dianggap final sebelum sample
payload processing/complete/cancelled dan minimal satu payment method kedua tersedia — lihat
`VA-1` di `AMENDMENTS.md` untuk daftar yang masih kurang.

## Yang sengaja TIDAK ditambahkan
- menu baru
- user management page
- export
- notification center
- audit log UI
- custom report baru
- chart dashboard
- edit/delete Master Order
- public password reset
- OAuth
- public signup

## Prinsip
Kalau detail sudah ada di dokumen source/contract, agent ikuti.
Kalau tidak ada, agent stop dan tandai BLOCKED_BY_REQUIREMENT.
