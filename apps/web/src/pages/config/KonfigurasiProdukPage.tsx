import { useState } from 'react'
import { hasPermission } from '../../lib/roles'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { ConfigSection } from './ConfigSection'
import { ProductAliasSection } from './ProductAliasSection'
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
  const { profile } = useSession()
  // Pilihan kode di bagian alias ikut diperbarui setelah master berubah di bagian atas.
  const [configVersion, setConfigVersion] = useState(0)
  const bump = () => setConfigVersion((v) => v + 1)
  return (
    <>
      <PageHeader
        title="Konfigurasi Produk"
      />

      <div className="flex flex-col gap-4">
        {hasPermission(profile, 'config.produk') ? <ConfigSection spec={PRODUCT_SPEC} onChanged={bump} /> : null}
        {hasPermission(profile, 'config.produk') ? <ConfigSection spec={ADVERTISER_SPEC} onChanged={bump} /> : null}
        {hasPermission(profile, 'config.produk') ? <ConfigSection spec={EVENT_TYPE_SPEC} onChanged={bump} /> : null}
        {hasPermission(profile, 'config.produk') ? <ConfigSection spec={SESSION_SPEC} onChanged={bump} /> : null}
        {hasPermission(profile, 'config.alias_produk') ? <ProductAliasSection configVersion={configVersion} /> : null}
      </div>
    </>
  )
}
