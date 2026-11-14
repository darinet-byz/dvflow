import { useState } from 'react'
import { PRODUCT_SEGMENT_SEPARATOR, validateProductNameVariants } from '@dvflow/shared'
import type { ConfigOption } from '../../lib/queries'
import { useConfigLists } from '../../lib/useConfigLists'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { TextInput, Select } from '../../ui/Field'
import { ErrorState } from '../../ui/Feedback'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

/**
 * Product Name Generator (PRD §70–§73, §163, 05 §D01–§D06, A75).
 *
 * Seluruh logikanya ada di `packages/shared` dan sudah diuji
 * (`validateProductNameVariants`) — halaman ini tidak menyusun ulang stringnya
 * sendiri. Itu penting: nama yang dihasilkan HARUS selalu dapat diparse kembali
 * oleh parser, dan satu-satunya cara menjaminnya adalah memakai fungsi yang sama.
 *
 * Sejak A75 generator menghasilkan DUA nama sekaligus:
 *   * format lama (kode): `MTIX01SO60 - S1 - Tegal`
 *   * format baru (nama): `01 - SO60 - Master Tiktok Indonesia - S1 - Tegal`
 * Keduanya sah dan dapat diparse. Masing-masing punya tombol Copy sendiri.
 *
 * Yang dijaga di sini:
 *   * hanya konfigurasi AKTIF yang ditawarkan (D02);
 *   * hasil hanya muncul setelah Generate, dan tidak pernah muncul setengah jadi
 *     ketika ada input yang kurang (D03);
 *   * batch tetap teks; nol di DEPAN diabaikan (`058` -> `58`, A33), nol di
 *     tengah/belakang tetap (`508`, `100`); kode pengiklan `01` tidak tersentuh (D05);
 *   * tombol Copy menyalin nilai persis seperti yang tampil (D06).
 */
const TYPE_LABEL = 'Seminar / Webinar'

type GeneratedNames = { legacy: string; detailed: string }
type GeneratedKey = keyof GeneratedNames

/**
 * Nama produk tanpa kode. `ConfigOption.name` sudah diisi `toOptions`; fallback
 * dari label `KODE — Nama` hanya untuk data uji/lama yang belum membawa `name`.
 */
function productNameOf(option: ConfigOption | undefined): string {
  if (option === undefined) return ''
  if (option.name !== undefined) return option.name
  const marker = ' — '
  const index = option.label.indexOf(marker)
  return index === -1 ? '' : option.label.slice(index + marker.length)
}

export function GeneratorPage() {
  const { lists, error: listsError } = useConfigLists()
  const toast = useToast()
  // A44: daftar pengiklan kini terbaca semua akun, tetapi akun Advertiser tetap hanya membuat nama
  // produk untuk pengiklannya sendiri (perilaku A20).
  const ownAdvertiser = useSession().profile?.advertiser_code ?? null
  const advertiserOptions = (lists?.advertisers ?? []).filter((item) => ownAdvertiser === null || item.value === ownAdvertiser)

  const [productCode, setProductCode] = useState('')
  const [advertiserCode, setAdvertiserCode] = useState('')
  const [typeCode, setTypeCode] = useState('')
  const [sessionCode, setSessionCode] = useState('')
  const [batch, setBatch] = useState('')
  const [city, setCity] = useState('')

  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [generated, setGenerated] = useState<GeneratedNames | null>(null)
  const [copied, setCopied] = useState<GeneratedKey | null>(null)

  function generate(): void {
    const productName = productNameOf(lists?.products.find((item) => item.value === productCode))
    const result = validateProductNameVariants({
      productCode,
      advertiserCode,
      typeCode,
      batch,
      sessionCode,
      city,
      productName,
    }, { strictCodes: true })

    if (!result.ok) {
      // D03: input kurang -> TIDAK ada kode yang dihasilkan, hanya error.
      setErrors(result.errors)
      setGenerated(null)
      return
    }

    setErrors({})
    setGenerated(result.value)
    setCopied(null)
  }

  async function copy(key: GeneratedKey): Promise<void> {
    if (generated === null) return

    try {
      await navigator.clipboard.writeText(generated[key])
      setCopied(key)
      toast.show('Nama produk disalin.', 'success')
    } catch {
      // Clipboard bisa ditolak (izin browser / konteks tidak aman). Nilainya
      // tetap terlihat di layar, jadi operator masih bisa menyalin manual.
      toast.show('Tidak dapat menyalin otomatis. Salin manual dari kotak hasil.', 'danger')
    }
  }

  return (
    <>
      <PageHeader
        title="Product Name Generator"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Input" />
          {listsError ? <ErrorState title="Pilihan kode gagal dimuat" message={listsError} /> : null}

          <div className="flex flex-col gap-3">
            <Select
              id="generator-produk"
              label="Produk"
              value={productCode}
              placeholder="Pilih produk"
              options={lists?.products ?? []}
              onChange={setProductCode}
            />
            <Select
              id="generator-pengiklan"
              label="Pengiklan"
              value={advertiserCode}
              placeholder="Pilih pengiklan"
              options={advertiserOptions}
              onChange={setAdvertiserCode}
            />
            <Select
              id="generator-jenis"
              label={TYPE_LABEL}
              value={typeCode}
              placeholder="Pilih event type"
              options={lists?.eventTypes ?? []}
              onChange={setTypeCode}
            />
            <TextInput
              id="generator-batch"
              label="Batch"
              value={batch}
              placeholder="mis. 58 atau 392"
              onChange={setBatch}
              error={errors['batch'] ?? null}
            />
            <Select
              id="generator-sesi"
              label="Sesi"
              value={sessionCode}
              placeholder="Pilih sesi"
              options={lists?.sessions ?? []}
              onChange={setSessionCode}
            />
            <TextInput
              id="generator-kota"
              label="Kota / Live Zoom"
              value={city}
              placeholder="mis. Solo atau Live Zoom"
              onChange={setCity}
              error={errors['city'] ?? null}
            />

            <Button variant="primary" onClick={generate} className="mt-1">
              Generate
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Generated Product Name" />

          <div className="flex flex-col gap-3">
            <GeneratedNameRow
              label="Format 1 — kode"
              value={generated?.legacy ?? null}
              copied={copied === 'legacy'}
              onCopy={() => void copy('legacy')}
            />
            <GeneratedNameRow
              label="Format 2 — nama produk"
              value={generated?.detailed ?? null}
              copied={copied === 'detailed'}
              onCopy={() => void copy('detailed')}
            />
            {generated === null ? (
              <p className="text-[12px] text-ink-soft">
                {Object.keys(errors).length === 0
                  ? 'Hasil akan muncul di sini setelah Generate.'
                  : 'Periksa input yang ditandai, lalu tekan Generate lagi.'}
              </p>
            ) : null}
          </div>

          {Object.keys(errors).length === 0 ? null : (
            <ul className="mt-3 flex flex-col gap-1 text-[12px] text-danger">
              {Object.entries(errors).map(([field, message]) => (
                <li key={field}>{message}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            <span className="text-[12px] text-ink-soft">Pemisah segmen: "{PRODUCT_SEGMENT_SEPARATOR.trim()}"</span>
          </div>
        </Card>
      </div>
    </>
  )
}

function GeneratedNameRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string
  value: string | null
  copied: boolean
  onCopy: () => void
}) {
  const empty = value === null

  return (
    <div
      className={cn(
        'rounded-md border p-3',
        empty ? 'border-dashed border-line bg-soft' : 'border-primary/20 bg-primary-soft',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-soft">{label}</span>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Copy ${label}`}
          disabled={empty}
          onClick={onCopy}
        >
          {copied ? 'Tersalin' : 'Copy'}
        </Button>
      </div>
      <p className={cn('mt-2 break-all font-mono text-[17px] font-semibold', empty ? 'text-ink-muted' : 'text-ink')}>
        {value ?? '—'}
      </p>
    </div>
  )
}
