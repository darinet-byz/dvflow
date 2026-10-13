import { PageHeader } from '../../layout/PageHeader'
import { Card } from '../../ui/Card'
import { ConfigSection } from './ConfigSection'
import { FEE_RULE_SPEC } from './specs'

/**
 * Konfigurasi Tax (PRD §74–§80, §164).
 *
 * Identifier di sini adalah kunci pencocokan tax: nilainya harus sama persis
 * dengan identifier yang diterima dari webhook, karena pencocokannya exact dan
 * tanpa fuzzy (01 §11). Karena itu formnya memberi contoh nyata (`bank_transfer`)
 * alih-alih label yang lebih rapi tetapi tidak akan pernah cocok.
 *
 * Mengubah atau menonaktifkan rule TIDAK mengubah order historis: order menyimpan
 * snapshotnya sendiri (01 §12).
 */
export function KonfigurasiTaxPage() {
  return (
    <>
      <PageHeader
        title="Konfigurasi Tax"
        description="Aturan fee per metode pembayaran. Berlaku untuk perhitungan berikutnya, bukan untuk order lama."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-ink-soft">
            Pencocokan identifier bersifat <strong className="text-ink">exact</strong> — tidak ada
            pencocokan mendekati. Bila identifier tidak cocok, order tetap tersimpan dengan tax 0 dan
            status mapping <em>unmapped</em>, dan itu terlihat di drawer Order.
          </p>
        </Card>

        <ConfigSection spec={FEE_RULE_SPEC} />
      </div>
    </>
  )
}
