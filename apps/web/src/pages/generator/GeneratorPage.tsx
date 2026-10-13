import { useState } from 'react'
import { PRODUCT_SEGMENT_SEPARATOR, validateProductNameInput } from '@dvflow/shared'
import { useConfigLists } from '../../lib/useConfigLists'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card, CardHeader } from '../../ui/Card'
import { TextInput, Select } from '../../ui/Field'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

/**
 * Product Name Generator (PRD §70–§73, §163, 05 §D01–§D06).
 *
 * Seluruh logikanya ada di `packages/shared` dan sudah diuji (`buildProductName`
 * + `validateProductNameInput`) — halaman ini tidak menyusun ulang stringnya
 * sendiri. Itu penting: nama yang dihasilkan HARUS selalu dapat diparse kembali
 * oleh parser, dan satu-satunya cara menjaminnya adalah memakai fungsi yang sama.
 *
 * Yang dijaga di sini:
 *   * hanya konfigurasi AKTIF yang ditawarkan (D02);
 *   * hasil hanya muncul setelah Generate, dan tidak pernah muncul setengah jadi
 *     ketika ada input yang kurang (D03);
 *   * batch `001` tidak kehilangan angka nol — nilainya tidak pernah diubah
 *     menjadi angka (D05);
 *   * tombol Copy menyalin nilai persis seperti yang tampil (D06).
 */
const TYPE_LABEL = 'Seminar / Webinar'

export function GeneratorPage() {
  const { lists } = useConfigLists()
  const toast = useToast()

  const [productCode, setProductCode] = useState('')
  const [advertiserCode, setAdvertiserCode] = useState('')
  const [typeCode, setTypeCode] = useState('')
  const [sessionCode, setSessionCode] = useState('')
  const [batch, setBatch] = useState('')
  const [city, setCity] = useState('')

  const [errors, setErrors] = useState<Partial<Record<string, string>>>({})
  const [generated, setGenerated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function generate(): void {
    const result = validateProductNameInput({
      productCode,
      advertiserCode,
      typeCode,
      batch,
      sessionCode,
      city,
    })

    if (!result.ok) {
      // D03: input kurang -> TIDAK ada kode yang dihasilkan, hanya error.
      setErrors(result.errors)
      setGenerated(null)
      return
    }

    setErrors({})
    setGenerated(result.value)
    setCopied(false)
  }

  async function copy(): Promise<void> {
    if (generated === null) return

    try {
      await navigator.clipboard.writeText(generated)
      setCopied(true)
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
        description="Membantu tim membuat nama produk yang konsisten dan dapat dibaca sistem."
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Input" description="Semua field wajib diisi." />

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
              options={lists?.advertisers ?? []}
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
              placeholder="mis. 392 atau 001"
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
              label="Kota"
              value={city}
              placeholder="mis. Solo"
              onChange={setCity}
              error={errors['city'] ?? null}
            />

            <Button variant="primary" onClick={generate} className="mt-1">
              Generate
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Generated Product Name" description="Inilah yang disalin ke OrderOnline." />

          <div
            className={cn(
              'grid min-h-[132px] place-items-center rounded-md border p-4 text-center',
              generated === null ? 'border-dashed border-line bg-soft' : 'border-primary/20 bg-primary-soft',
            )}
          >
            {generated === null ? (
              <p className="text-ink-soft">
                {Object.keys(errors).length === 0
                  ? 'Hasil akan muncul di sini setelah Generate.'
                  : 'Periksa input yang ditandai, lalu tekan Generate lagi.'}
              </p>
            ) : (
              <p className="break-all font-mono text-[17px] font-semibold text-ink">{generated}</p>
            )}
          </div>

          {Object.keys(errors).length === 0 ? null : (
            <ul className="mt-3 flex flex-col gap-1 text-[12px] text-danger">
              {Object.entries(errors).map(([field, message]) => (
                <li key={field}>{message}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button variant="secondary" disabled={generated === null} onClick={() => void copy()}>
              {copied ? 'Tersalin' : 'Copy'}
            </Button>
            {generated === null ? null : (
              <span className="text-[12px] text-ink-soft">Pemisah segmen: "{PRODUCT_SEGMENT_SEPARATOR.trim()}"</span>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
