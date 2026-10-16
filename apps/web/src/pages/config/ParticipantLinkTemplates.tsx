import { participantLinkTemplate } from '../../lib/access-link'
import { Button } from '../../ui/Button'
import { useToast } from '../../ui/Toast'

export type StoreCode = { name: string; slug: string }

/**
 * Link peserta untuk template followup / Redirect URL OrderOnline — SATU per toko (A27).
 * Kode toko wajib ada di link supaya Order ID dua toko tidak pernah tertukar (Fitur 2.0 dok 07).
 */
export function ParticipantLinkTemplates({ idPrefix, label, stores }: { idPrefix: string; label: string; stores: StoreCode[] }) {
  const toast = useToast()

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.show('Link peserta disalin.', 'success')
    } catch {
      toast.show('Salin link secara manual dari kotak link peserta.', 'danger')
    }
  }

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="font-semibold">{label}</p>
      {stores.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-soft">
          Belum ada koneksi OrderOnline aktif. Tambahkan koneksi di menu API &amp; Webhook untuk mendapatkan link berkode toko.
        </p>
      ) : (
        stores.map((store) => {
          const value = participantLinkTemplate(store.slug)
          const id = `${idPrefix}-${store.slug.toLowerCase()}`
          return (
            <div key={store.slug} className="mt-2">
              <label htmlFor={id} className="text-[12px] text-ink-soft">
                {store.name} (kode toko {store.slug})
              </label>
              <div className="mt-1 flex min-w-0 flex-wrap gap-2">
                <input id={id} readOnly value={value} className="min-w-0 w-full rounded-sm border border-line p-3 font-mono text-[12px]" />
                <Button onClick={() => void copy(value)}>Salin link {store.slug}</Button>
              </div>
            </div>
          )
        })
      )}
      <p className="mt-2 text-[11px] text-ink-soft">
        Tempel di template pesan OrderOnline atau kolom Redirect URL toko yang sesuai. <code>{'{{order_id}}'}</code> diisi otomatis oleh OrderOnline.
      </p>
    </div>
  )
}
