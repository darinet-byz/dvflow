# EDGE CASES & ACCEPTANCE TESTS
## dvflow

Versi: 1.0
Purpose: executable checklist untuk coding agent dan QA.

## A. Authentication
A01 valid username/password -> login success, access token + secure refresh session.
A02 wrong password -> 401 INVALID_CREDENTIALS.
A03 unknown username -> response identical dengan wrong password.
A04 inactive user -> login denied.
A05 logout -> session revoked + redirect login.
A06 revoked session -> refresh denied.
A07 access JWT expired -> refresh can issue new JWT if refresh session valid.
A08 password change wrong current password -> rejected.
A09 password change success -> all previous sessions revoked.
A10 no signup/register/create account controls visible.

## B. RBAC
B01 staff can open Dashboard/Order/Presensi/Scanner/Generator/Profile.
B02 staff cannot mutate Product config.
B03 staff cannot mutate Tax config.
B04 staff cannot access Report Tax.
B05 admin can config Product/Tax and Report Tax.
B06 Master Admin internal user provisioning succeeds.
B07 Admin cannot call internal user provisioning.

## C. Webhook / Master Order
C01 first webhook order X -> exactly one order row.
C02 same webhook repeated 10x -> still exactly one order row.
C03 pending -> Pending.
C04 processing -> Paid.
C05 complete -> Paid.
C06 cancelled -> Cancelled.
C07 unsupported status -> explicit error; no invented mapping.
C08 missing order ID -> reject invalid payload.
C09 gross amount non-numeric/NaN -> reject.
C10 product parser invalid -> order still saved, parse_status invalid.
C11 product parser valid -> normalized fields match config.
C12 product_raw retained exactly enough for audit/search.
C13 Paid first transition populates paid_at.
C14 repeated Paid does not create new order.

## D. Product Generator
D01 configured product+advertiser+type+batch+session+city -> expected exact string.
D02 inactive product not offered in selector.
D03 missing required input -> no invalid generated code.
D04 city whitespace trimmed.
D05 batch `001` remains `001`.
D06 Copy button copies exact generated value.
D07 code conflict in configuration rejected.

## E. Tax
E01 flat 4000 on gross 300000 -> tax 4000, net 296000.
E02 percentage 0.7 on gross 300000 -> tax 2100, net 297900.
E03 inactive fee rule ignored.
E04 exact normalized identifier match works across case/extra spaces.
E05 no identifier match -> tax 0, net gross, status unmapped.
E06 no fuzzy fallback.
E07 historical order keeps tax snapshot after fee config edit.
E08 historical order keeps snapshot after fee rule deactivate.
E09 repeated webhook with unchanged gross/payment does not unexpectedly rewrite history.
E10 fee rule active identifier duplicate rejected.

## F. Participant Access — Webinar
F01 valid Paid webinar order + destination mapping -> attendance inserted + HTTP 302.
F02 second click -> second attendance event inserted.
F03 pending webinar -> denied, no attendance.
F04 cancelled webinar -> denied.
F05 unknown order -> denied.
F06 invalid product parse -> denied.
F07 destination missing -> no attendance + explicit configuration error.
F08 destination must be HTTPS unless development environment explicitly allows localhost.

## G. Participant Access — Seminar
G01 valid Paid seminar -> ticket page renders.
G02 QR generated client-side.
G03 QR payload contains only checkin URL/order identity needed by contract.
G04 pending seminar -> access denied.
G05 cancelled -> access denied.
G06 unknown -> access denied.

## H. Scanner
H01 Paid Seminar first scan -> attendance inserted success.
H02 same Order repeated scan -> no new attendance, ALREADY_CHECKED_IN.
H03 Paid Webinar scanned on seminar scanner -> rejected NOT_SEMINAR_ORDER.
H04 Pending Seminar -> rejected ORDER_NOT_PAID.
H05 unknown -> ORDER_NOT_FOUND.
H06 camera unavailable -> Manual Search remains usable.
H07 Manual Search exact Order ID -> candidate returned.
H08 Manual Search phone/name -> server-side result max 20.
H09 manual check-in runs same validation and cannot bypass Paid.
H10 successful check-in records scanner_user_id.

## I. Presensi
I01 Seminar + Webinar appear in same master presensi when unfiltered.
I02 Paid + zero attendance -> Belum Hadir.
I03 Paid + one or more attendance -> Hadir.
I04 Pending is not Belum Hadir.
I05 17 webinar events -> Total Activity 17.
I06 table shows only latest 10 timestamps.
I07 attendance >30 days removed by cron.
I08 Master Order remains after attendance deletion.
I09 seminar duplicate prevention remains enforced after UI refresh/concurrent scan.

## J. Search / Filter / Pagination
J01 default order page 50 rows.
J02 change to 100 works.
J03 no full-database preload.
J04 combined Product+Batch+Advertiser+Paid filter uses AND semantics.
J05 active filter chips visible.
J06 remove individual filter leaves others active.
J07 Clear All removes structured filters but preserves search text.
J08 search debounce approximately 300ms.
J09 server-side sort works for allowed columns.
J10 Order default sort created_at DESC.

## K. UI/UX
K01 desktop app shell follows guideline.
K02 sidebar exact menu/order.
K03 one primary action per area.
K04 data table sticky header.
K05 horizontal scroll on narrow screens.
K06 scanner usable on mobile.
K07 skeleton used for page data loading.
K08 small action spinner only.
K09 empty state clear.
K10 error state human-readable.
K11 drawer used for read-only Order detail.
K12 status colors consistent.

## L. Security
L01 Supabase secret/service key absent from frontend source/build.
L02 JWT private key absent from frontend.
L03 anonymous read to orders blocked.
L04 raw password never stored/logged.
L05 webhook wrong secret returns 404.
L06 SQL injection-like search text treated as data.
L07 XSS payload in name/product displays as text.
L08 staff write config denied server-side, not just hidden button.

## M. Concurrency
M01 two identical Order webhooks arriving simultaneously -> one Master Order row.
M02 two scanners scan same seminar QR near-simultaneously -> one seminar attendance row.
M03 tax rule edit while webhook processed -> each transaction has internally consistent snapshot.

## N. Production-readiness blockers
System must NOT be called production-ready until:
- actual OrderOnline webhook payload samples mapped and tested;
- Supabase custom JWT signing/trust configured;
- RLS tests pass;
- first Master Admin provisioned securely;
- webinar destination mapping populated for active webinars;
- cron retention verified;
- Cloudflare/Worker secrets configured.
