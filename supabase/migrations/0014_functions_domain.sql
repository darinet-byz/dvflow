-- ============================================================================
-- 0014_functions_domain — helper peran + aritmetika tax
-- ============================================================================
-- Rujukan: docs/AMENDMENTS.md A4 (objek fungsi tambahan) dan STATE.md K10.

-- ---------------------------------------------------------------------------
-- app_role() — peran aplikasi dari access JWT (01 §2, 04 §4).
--
-- Hanya nilai dari daftar tertutup yang dikembalikan. JWT anon tidak memuat
-- app_role, sehingga hasilnya NULL dan seluruh policy RLS gagal-tertutup.
-- ---------------------------------------------------------------------------
create or replace function public.app_role()
returns text
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role'
         in ('master_admin', 'admin', 'staff')
      then nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- is_app_user() — apakah pemanggil adalah user aplikasi yang AKTIF.
--
-- SECURITY DEFINER dengan body minimal (hanya mengembalikan boolean tentang
-- baris pemanggil sendiri) supaya tidak bergantung pada — dan tidak bisa
-- ditumpangi oleh — policy RLS di public.users.
-- ---------------------------------------------------------------------------
create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active
  )
$$;

-- ---------------------------------------------------------------------------
-- calc_tax_amount() — SATU-SATUNYA sumber aritmetika tax yang dipersist (K10).
--
-- Cermin TypeScript: packages/shared/src/domain/tax.ts -> calcTaxAmount()
-- Keduanya diuji terhadap angka yang sama (05 §E01, E02):
--   flat 4000 pada gross 300000      -> 4000
--   percentage 0.7 pada gross 300000 -> 2100
--
-- fee_value persentase adalah angka persen (0.7 = 0,7%), jadi dibagi 100.
-- ---------------------------------------------------------------------------
create or replace function public.calc_tax_amount(
  p_gross_amount numeric,
  p_fee_type text,
  p_fee_value numeric
)
returns numeric
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select round(
    case
      when p_fee_type = 'flat' then p_fee_value
      when p_fee_type = 'percentage' then p_gross_amount * (p_fee_value / 100)
      else null
    end,
    2
  )
$$;
