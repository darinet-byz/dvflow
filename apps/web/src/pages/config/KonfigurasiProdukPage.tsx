import { PageHeader } from '../../layout/PageHeader'
import { ConfigSection } from './ConfigSection'
import { ADVERTISER_SPEC, EVENT_TYPE_SPEC, PRODUCT_SPEC, SESSION_SPEC } from './specs'

/**
 * Konfigurasi Produk (PRD §57–§63, §162).
 *
 * Empat sumber daya dalam satu halaman, masing-masing dengan CRUD-nya sendiri
 * (Produk, Pengiklan, Type, Sesi). Dipisah per bagian, bukan digabung dalam satu
 * form panjang — itu yang diminta PRD §62 — dan bukan tab, karena guideline
 * tidak mendefinisikan pola tab; bagian bertumpuk hanya memakai komponen yang
 * sudah ada.
 *
 * Konfigurasi inilah satu-satunya sumber kode yang dikenali parser: menambah
 * produk di sini berarti parser langsung mengenali kodenya (CLAUDE.md §4).
 */
export function KonfigurasiProdukPage() {
  return (
    <>
      <PageHeader
        title="Konfigurasi Produk"
        description="Pusat mapping kode: produk, pengiklan, type, dan sesi yang dikenali sistem."
      />

      <div className="flex flex-col gap-4">
        <ConfigSection spec={PRODUCT_SPEC} />
        <ConfigSection spec={ADVERTISER_SPEC} />
        <ConfigSection spec={EVENT_TYPE_SPEC} />
        <ConfigSection spec={SESSION_SPEC} />
      </div>
    </>
  )
}
