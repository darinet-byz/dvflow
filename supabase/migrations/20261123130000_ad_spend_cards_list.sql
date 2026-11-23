-- 20261123130000_ad_spend_cards_list — A95 (permintaan pengguna 23 Nov 2026).
--
-- Popup "Laporan Iklan" punya filter produk sendiri. Daftar kartu untuk popup
-- tidak boleh mengikuti filter halaman Report Spend Iklan (tanggal, produk,
-- pengiklan, batch, jenis acara): cukup scope produk aktor (A44) dan privasi
-- card per pengiklan (A89). RPC ini ringan karena tidak menghitung order/spend.
create or replace function public.schema_version() returns integer
language sql immutable set search_path = pg_catalog as $$ select 94 $$;

create or replace function public.ad_spend_cards_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_own_advertiser uuid;
  v_can_manage boolean;
begin
  if not public.has_permission('operasional.report_spend') then
    raise exception using errcode = 'DF006', message = 'FORBIDDEN';
  end if;
  select advertiser_id into v_own_advertiser from public.users where id = v_actor;
  v_can_manage := public.has_permission('action.manage_spend');

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'status', c.status,
      'product_code', p.code,
      'product_name', p.name,
      'advertiser_code', a.code,
      'advertiser_name', a.name,
      'batch', c.batch,
      'event_type', c.event_type,
      'own', v_own_advertiser is not null and c.advertiser_id = v_own_advertiser,
      'can_edit', v_can_manage or (v_own_advertiser is not null and c.advertiser_id = v_own_advertiser)
    ) order by c.name, p.name, c.batch)
      from public.ad_spend_cards c
      join public.products p on p.id = c.product_id
      join public.advertisers a on a.id = c.advertiser_id
     where c.status = 'berjalan'
       and public.actor_can_product(v_actor, p.code)
       and (v_own_advertiser is null or c.advertiser_id = v_own_advertiser)
  ), '[]'::jsonb);
end $$;

revoke all on function public.ad_spend_cards_list() from public, anon, authenticated;
grant execute on function public.ad_spend_cards_list() to authenticated;

notify pgrst, 'reload schema';
