import { supabaseRpc } from './supabase-rest'
import { useAsyncData, useDebouncedValue } from './useAsyncData'

export type RecentBatch = {
  batch: string
  product_code: string | null
  product_name: string | null
  advertiser_code: string | null
  advertiser_name: string | null
  last_activity: string
  orders: number
  tickets: number
}

/**
 * Saran 3 batch terbaru dari data order untuk produk (dan pengiklan) terpilih.
 *
 * Ini hanya saran: nilai batch tetap bebas diketik. Fungsi database sudah
 * menerapkan scope produk user, jadi akun dengan produk terbatas tidak melihat
 * batch produk lain.
 */
export function useRecentBatches(productCode: string, advertiserCode: string): {
  batches: RecentBatch[]
  loading: boolean
} {
  const product = useDebouncedValue(productCode.trim())
  const advertiser = useDebouncedValue(advertiserCode.trim())
  const { data, loading } = useAsyncData(
    async () => {
      if (product === '') return { batches: [] as RecentBatch[] }
      return supabaseRpc<{ batches: RecentBatch[] }>('recent_batches', {
        p_product_code: product,
        p_advertiser_code: advertiser === '' ? null : advertiser,
        p_limit: 3,
      })
    },
    [product, advertiser],
  )
  return { batches: data?.batches ?? [], loading }
}

/** Format saran: konteks pengiklan + aktivitas terakhir + tiket. */
export function describeRecentBatch(batch: RecentBatch): { label: string; hint: string } {
  const advertiser = batch.advertiser_name
    ? `${batch.advertiser_name}${batch.advertiser_code ? ` (${batch.advertiser_code})` : ''}`
    : 'Tanpa pengiklan'
  const date = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(batch.last_activity))
  return {
    label: `${advertiser} · aktivitas terakhir ${date}`,
    hint: `${batch.orders} order · ${batch.tickets} tiket`,
  }
}
