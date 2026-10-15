import { useState } from 'react'
import type { DataSummaryResult, ResetDataResult, ResetDataScope } from '@dvflow/shared'
import { PageHeader } from '../../layout/PageHeader'
import { Card } from '../../ui/Card'
import { Button } from '../../ui/Button'
import { TextInput } from '../../ui/Field'
import { Modal } from '../../ui/Overlay'
import { SkeletonRows, ErrorState } from '../../ui/Feedback'
import { useToast } from '../../ui/Toast'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'

const SCOPE_OPTIONS: Array<{ key: ResetDataScope; label: string; description: string }> = [
  {
    key: 'orders_all',
    label: 'Semua Pesanan & Kehadiran',
    description: 'Menghapus seluruh orders, catatan presensi/check-in scan tiket, dan relasi sumber order.',
  },
  {
    key: 'orders_unmapped',
    label: 'Order Unmapped Saja',
    description: 'Hanya menghapus pesanan dengan format nama produk invalid yang belum dipetakan.',
  },
  {
    key: 'webhook_logs',
    label: 'Webhook Logs',
    description: 'Menghapus riwayat audit payload request webhook mentah dari OrderOnline.',
  },
  {
    key: 'product_aliases',
    label: 'Kamus Alias Produk',
    description: 'Menghapus seluruh mapping alias nama produk OrderOnline ke DVFLOW.',
  },
  {
    key: 'connections',
    label: 'Koneksi Toko OrderOnline',
    description: 'Menghapus konfigurasi webhook toko dan PAT (Personal Access Token).',
  },
  {
    key: 'products_master',
    label: 'Master Produk & Event Type Testing',
    description: 'Menghapus konfigurasi produk, pengiklan, tipe, alias, dan mapping acara; mengisi kembali tipe SO/WO dan sesi ST/S1–S8. Ditolak jika masih ada transaksi. Tax tetap tersimpan.',
  },
]

export function ResetDataPage() {
  const toast = useToast()
  const [selectedScopes, setSelectedScopes] = useState<Set<ResetDataScope>>(new Set())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [confirmationText, setConfirmationText] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)

  const { data: summary, loading, error: summaryError, reload } = useAsyncData<DataSummaryResult>(
    () => authorizedRequest<DataSummaryResult>('/api/developer/data-summary'),
    [],
  )

  function toggleScope(scope: ResetDataScope) {
    setSelectedScopes((prev) => {
      const next = new Set(prev)
      if (scope === 'products_master') return new Set(prev.has(scope) ? [] : [scope])
      next.delete('products_master')
      if (next.has(scope)) {
        next.delete(scope)
      } else {
        next.add(scope)
      }
      return next
    })
  }

  function selectAllTestData() {
    setSelectedScopes(new Set<ResetDataScope>(['orders_all', 'webhook_logs', 'product_aliases', 'connections']))
  }

  function clearSelection() {
    setSelectedScopes(new Set())
  }

  function openResetModal() {
    if (selectedScopes.size === 0) return
    setStep(1)
    setConfirmationText('')
    setPassword('')
    setModalError(null)
    setIsModalOpen(true)
  }

  async function handleExecuteReset() {
    if (!password) {
      setModalError('Password developer wajib diisi.')
      return
    }

    setIsSubmitting(true)
    setModalError(null)

    try {
      const result = await authorizedRequest<ResetDataResult>('/api/developer/reset-data', {
        method: 'POST',
        body: {
          scopes: Array.from(selectedScopes),
          confirmationText: confirmationText.trim(),
          password,
        },
      })

      const totalDeleted = Object.values(result.deleted).reduce((acc, count) => acc + count, 0)
      toast.show(`Pembersihan data berhasil! Total ${totalDeleted} baris data terhapus.`, 'success')
      setIsModalOpen(false)
      setSelectedScopes(new Set())
      reload()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Terjadi kesalahan saat memproses reset data.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Reset Data (Developer Only)"
      />

      <div className="flex flex-col gap-4">
        {/* Warning Banner */}
        <div className="flex flex-col gap-1 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-[14px]">
            <span>⚠️ PERHATIAN: FITUR DESTRUKTIF KHUSUS DEVELOPER</span>
          </div>
          <p className="text-[12px] leading-relaxed text-red-800">
            Tindakan di halaman ini menghapus data secara permanen dari Supabase live dan <strong>tidak dapat dipulihkan</strong>.
            Gunakan fitur ini hanya untuk membersihkan data testing / simulasi webhook selama masa persiapan sistem.
            Akun Developer, data login pengguna sistem, hak akses (RBAC), dan konfigurasi pengaturan inti <strong>tetap aman dan tidak pernah terhapus</strong>.
          </p>
        </div>

        {/* Live Data Summary Card */}
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[14px] font-bold text-ink">Ringkasan Data Aktif di Database</h3>
                <p className="text-[11px] text-ink-muted">Data aktual yang tersimpan di Supabase saat ini</p>
              </div>
              <Button onClick={reload} disabled={loading} className="text-[11px]">
                🔄 Muat Ulang Statistik
              </Button>
            </div>

            {summaryError ? <ErrorState message={summaryError} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
            {loading && !summary ? (
              <SkeletonRows rows={2} />
            ) : summary ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Total Orders</p>
                  <p className="text-[18px] font-bold text-ink">{summary.orders_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Order Unmapped</p>
                  <p className="text-[18px] font-bold text-amber-600">{summary.unmapped_orders_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Presensi & Scan QR</p>
                  <p className="text-[18px] font-bold text-ink">{summary.attendance_events_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Webhook Logs</p>
                  <p className="text-[18px] font-bold text-ink">{summary.webhook_logs_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Kamus Alias Produk</p>
                  <p className="text-[18px] font-bold text-ink">{summary.product_aliases_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Koneksi Toko</p>
                  <p className="text-[18px] font-bold text-ink">{summary.connections_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Master Produk Testing</p>
                  <p className="text-[18px] font-bold text-ink">{summary.products_count.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-line bg-card p-3">
                  <p className="text-[11px] text-ink-muted">Mapping Sumber Order</p>
                  <p className="text-[18px] font-bold text-ink">{summary.order_sources_count.toLocaleString()}</p>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        {/* Selection & Action Card */}
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[14px] font-bold text-ink">Pilih Cakupan Data yang Ingin Direset</h3>
                <p className="text-[11px] text-ink-muted">Centang bagian data yang ingin dibersihkan</p>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={selectAllTestData} className="text-[12px]">
                  ⚡ Pilih Semua Data Transaksi Uji Coba
                </Button>
                {selectedScopes.size > 0 ? (
                  <Button onClick={clearSelection} className="text-[12px]">
                    Kosongkan Pilihan
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {SCOPE_OPTIONS.map((opt) => {
                const isChecked = selectedScopes.has(opt.key)
                return (
                  <label
                    key={opt.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-all ${
                      isChecked
                        ? 'border-red-400 bg-red-50/50 shadow-sm'
                        : 'border-line bg-card hover:bg-soft'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleScope(opt.key)}
                      className="mt-0.5 h-4 w-4 rounded border-line text-red-600 focus:ring-red-500"
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-ink">{opt.label}</p>
                      <p className="text-[11px] text-ink-muted">{opt.description}</p>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-line pt-4">
              <span className="text-[13px] text-ink-muted">
                {selectedScopes.size > 0 ? (
                  <strong className="text-red-600">{selectedScopes.size} cakupan dipilih</strong>
                ) : (
                  'Belum ada cakupan yang dipilih'
                )}
              </span>

              <Button
                variant="danger"
                disabled={selectedScopes.size === 0}
                onClick={openResetModal}
                className="px-6 font-bold"
              >
                🗑️ Reset Data Terpilih ({selectedScopes.size})
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* 2-Step Verification Modal */}
      {isModalOpen ? (
        <Modal
          open={isModalOpen}
          title={
            step === 1
              ? 'Verifikasi Tahap 1: Konfirmasi Teks'
              : 'Verifikasi Tahap 2: Autentikasi Password Developer'
          }
          onClose={() => !isSubmitting && setIsModalOpen(false)}
          footer={
            step === 1 ? (
              <>
                <Button onClick={() => setIsModalOpen(false)}>Batal</Button>
                <Button
                  variant="danger"
                  disabled={confirmationText.trim() !== 'Ya, Aku yakin'}
                  onClick={() => setStep(2)}
                >
                  Lanjut ke Verifikasi Password ➡️
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setStep(1)} disabled={isSubmitting}>
                  ⬅️ Kembali
                </Button>
                <Button
                  variant="danger"
                  loading={isSubmitting}
                  disabled={!password || isSubmitting}
                  onClick={handleExecuteReset}
                >
                  🔥 Hapus Permanen Sekarang
                </Button>
              </>
            )
          }
        >
          <div className="flex flex-col gap-4">
            {modalError ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-[12px] text-red-700">
                {modalError}
              </div>
            ) : null}

            {step === 1 ? (
              <>
                <p className="text-[13px] text-ink-soft">
                  Anda akan menghapus data pada cakupan berikut:{' '}
                  <strong className="text-red-600">
                    {Array.from(selectedScopes)
                      .map((k) => SCOPE_OPTIONS.find((o) => o.key === k)?.label)
                      .filter(Boolean)
                      .join(', ')}
                  </strong>
                  .
                </p>

                <div className="rounded-lg border border-red-200 bg-red-50/70 p-3 text-[12px] text-red-800">
                  <p className="font-semibold">Ketik kalimat konfirmasi persis di bawah ini untuk melanjutkan:</p>
                  <p className="my-1.5 select-all font-mono font-bold text-red-700 bg-white/80 p-1.5 rounded border border-red-200 inline-block">
                    Ya, Aku yakin
                  </p>
                </div>

                <TextInput
                  id="confirm-reset-text"
                  label="Kalimat Konfirmasi:"
                  placeholder="Ketik: Ya, Aku yakin"
                  value={confirmationText}
                  onChange={setConfirmationText}
                />
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-soft">
                  Sebagai lapisan proteksi terakhir untuk mencegah ketidaksengajaan, masukkan{' '}
                  <strong>password akun Developer</strong> Anda yang sedang login saat ini.
                </p>

                <div className="relative">
                  <TextInput
                    id="confirm-developer-password"
                    label="Password Akun Developer Anda:"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Masukkan password Anda..."
                    value={password}
                    onChange={setPassword}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2 top-8 text-[11px] font-medium text-ink-muted hover:text-ink"
                  >
                    {showPassword ? 'Sembunyikan' : 'Lihat'}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

