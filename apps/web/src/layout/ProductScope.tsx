import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { clearPersistedFilters } from '../lib/filter-storage'
import { fetchProductOptions, type ConfigOption } from '../lib/queries'
import {
  clearAllStoredProductScopes,
  clearStoredProductScope,
  persistProductScope,
  productScopeExpiresAt,
  productScopeStorageKey,
  readStoredProductScope,
} from '../lib/product-scope'
import { canAccessPath, hasAllProductAccess } from '../lib/roles'
import { logout } from '../lib/session'
import { useAsyncData } from '../lib/useAsyncData'
import { useSession } from '../lib/useSession'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Feedback'
import { cn } from '../ui/cn'
import { LOGIN_PATH } from './navigation'

/**
 * Product scope global (A97/A98).
 *
 * Produk dipilih di layar penuh sebelum shell dibuka. Selama belum dipilih,
 * sidebar/menu/header/chat tidak dirender sama sekali. Pilihan disimpan per
 * user selama 24 jam; expiry dan logout mengembalikan pengguna ke layar ini.
 *
 * Ini hanya kebijakan tampilan; RLS/RPC tetap batas keamanan.
 *
 * A100: mode ganti produk memakai overlay; shell di belakangnya tetap terpasang
 * dan inert agar state halaman/sidebar/chat tidak hilang saat Batal.
 */

export type ProductScope = {
  /** `''` berarti "Semua Produk" (gabungan produk yang ditugaskan). */
  code: string
  /** `false` = belum memilih atau pilihan sudah kedaluwarsa. */
  chosen: boolean
  chosenAt: number | null
  expiresAt: number | null
  options: ConfigOption[]
  loading: boolean
  error: string | null
  reload: () => void
  choose: (code: string) => void
  selectedLabel: string
  /** Layar pilih produk dibuka untuk mengganti produk yang sudah dipilih. */
  pickerOpen: boolean
  openPicker: () => void
  closePicker: () => void
  /** Pengecualian admin saat belum ada produk: buka Konfigurasi Produk. */
  configBypass: boolean
  openConfigBypass: () => void
}

type Selection = {
  code: string
  chosenAt: number | null
}

export const ProductScopeContext = createContext<ProductScope | null>(null)
const NO_OPTIONS: ConfigOption[] = []

/** Null di luar provider; halaman yang dirender langsung (tes) memakai perilaku lama. */
export function useProductScope(): ProductScope | null {
  return useContext(ProductScopeContext)
}

function useRequiredScope(): ProductScope {
  const scope = useContext(ProductScopeContext)
  if (scope === null) throw new Error('ProductScope harus dipakai di dalam ProductScopeProvider')
  return scope
}

function initialSelection(userId: string | null, search: string): Selection {
  // Deep link dianggap pilihan baru: timer 24 jam dimulai ulang.
  const urlCode = new URLSearchParams(search).get('productCode')
  if (urlCode !== null && urlCode !== '') {
    return { code: urlCode, chosenAt: Date.now() }
  }

  return readStoredProductScope(userId) ?? { code: '', chosenAt: null }
}

function productOptionName(option: ConfigOption): string {
  return option.name ?? option.label
}

export function ProductScopeProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession()
  const userId = profile?.user_id ?? null
  const location = useLocation()
  const [selection, setSelection] = useState<Selection>(() => initialSelection(userId, location.search))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [configBypass, setConfigBypass] = useState(false)
  const { data, loading, error, reload } = useAsyncData(fetchProductOptions, [])

  /*
   * Produk hanya yang ditugaskan: RLS sudah membatasi, tetapi daftar profil
   * (`allowed_product_codes`) dipakai sekali lagi supaya opsi yang tampil tidak
   * pernah melebar tanpa sengaja. Master admin / "Semua Produk" tetap melihat
   * semua produk aktif.
   */
  const allAccess = hasAllProductAccess(profile)
  const allowedCodes = !allAccess && Array.isArray(profile?.allowed_product_codes)
    ? profile.allowed_product_codes
    : null
  const allowedCodesKey = allowedCodes === null ? '' : allowedCodes.join('\u0000')
  const options = useMemo(() => {
    const list = data ?? NO_OPTIONS
    if (allowedCodesKey === '') return list
    const allowed = new Set(allowedCodesKey.split('\u0000'))
    return list.filter((option) => allowed.has(option.value))
  }, [data, allowedCodesKey])

  const chosen = selection.chosenAt !== null
  const expiresAt = selection.chosenAt === null ? null : productScopeExpiresAt({ code: selection.code, chosenAt: selection.chosenAt })

  const expire = useCallback(() => {
    clearStoredProductScope(userId)
    setSelection({ code: '', chosenAt: null })
    setPickerOpen(false)
    setConfigBypass(false)
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('productCode')) {
        url.searchParams.delete('productCode')
        // Pertahankan state history React Router; jangan diganti dengan objek kosong.
        window.history.replaceState(window.history.state, '', url)
      }
    } catch {
      // URL tidak dapat diubah: state tetap aman.
    }
  }, [userId])

  const choose = useCallback((code: string) => {
    const stored = persistProductScope(userId, code)
    setSelection(stored)
    setPickerOpen(false)
    setConfigBypass(false)
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('productCode')) {
        if (code === '') url.searchParams.delete('productCode')
        else url.searchParams.set('productCode', code)
        window.history.replaceState(window.history.state, '', url)
      }
    } catch {
      // Kegagalan menulis URL tidak boleh menghalangi pilihan.
    }
  }, [userId])

  const openPicker = useCallback(() => {
    // Muat ulang opsi; cache singkat dipakai bila konfigurasi belum berubah.
    // Setelah Konfigurasi disimpan, cache dibersihkan sehingga produk baru muncul.
    reload()
    setPickerOpen(true)
  }, [reload])

  const closePicker = useCallback(() => setPickerOpen(false), [])

  const openConfigBypass = useCallback(() => {
    setConfigBypass(true)
    setPickerOpen(false)
  }, [])

  // Deep link / perubahan query string: hormati produk yang diminta.
  const handledSearch = useRef<string | null>(null)
  useEffect(() => {
    if (handledSearch.current === location.search) return
    handledSearch.current = location.search
    const urlCode = new URLSearchParams(location.search).get('productCode')
    if (urlCode === null || urlCode === '') return
    choose(urlCode)
  }, [location.search, choose])

  // Produk tersimpan yang nonaktif / aksesnya dicabut: buang dan tampilkan layar pilih.
  useEffect(() => {
    if (loading || error !== null) return
    if (selection.chosenAt === null) return
    if (selection.code === '') return
    if (options.some((option) => option.value === selection.code)) return
    expire()
  }, [loading, error, options, selection, expire])

  // Timer 24 jam; browser menunda timer di tab background, jadi cek juga pada focus/visibility.
  useEffect(() => {
    if (selection.chosenAt === null) return
    const at = productScopeExpiresAt({ code: selection.code, chosenAt: selection.chosenAt })
    const check = () => {
      if (Date.now() >= at) expire()
    }
    check()
    const delay = at - Date.now()
    const timer = delay > 0 ? window.setTimeout(check, delay) : null
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [selection.chosenAt, selection.code, expire])

  // Sinkronisasi antar-tab: logout / ganti produk di tab lain ikut terlihat di sini.
  useEffect(() => {
    const key = productScopeStorageKey(userId)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return
      const stored = readStoredProductScope(userId)
      setSelection(stored === null ? { code: '', chosenAt: null } : stored)
      setPickerOpen(false)
      setConfigBypass(false)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [userId])

  const selectedLabel = !chosen
    ? ''
    : selection.code === ''
      ? 'Semua Produk'
      : options.find((option) => option.value === selection.code)?.label ?? selection.code

  const value = useMemo<ProductScope>(() => ({
    code: selection.code,
    chosen,
    chosenAt: selection.chosenAt,
    expiresAt,
    options,
    loading,
    error,
    reload,
    choose,
    selectedLabel,
    pickerOpen,
    openPicker,
    closePicker,
    configBypass,
    openConfigBypass,
  }), [
    selection.code, selection.chosenAt, chosen, expiresAt, options, loading, error, reload,
    choose, selectedLabel, pickerOpen, openPicker, closePicker, configBypass, openConfigBypass,
  ])

  return <ProductScopeContext.Provider value={value}>{children}</ProductScopeContext.Provider>
}

/**
 * Layar penuh untuk memilih / mengganti produk.
 *
 * Mode awal (belum ada produk) tidak punya tombol Batal. Mode ganti produk
 * (dibuka dari nama produk di sidebar/header) punya Batal agar pengguna dapat
 * kembali tanpa mengubah pilihan.
 */
export function ProductPickerScreen({ overlay = false }: { overlay?: boolean }) {
  const scope = useRequiredScope()
  const { profile } = useSession()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)
  const switching = scope.chosen && scope.pickerOpen
  // Admin yang membuka picker dari bypass konfigurasi juga harus bisa kembali.
  const canCancel = scope.pickerOpen && (scope.chosen || scope.configBypass)
  const canManageProducts = canAccessPath(profile, '/konfigurasi-produk')

  async function exit(): Promise<void> {
    if (leaving) return
    setLeaving(true)
    clearPersistedFilters()
    clearAllStoredProductScopes()
    await logout()
    navigate(LOGIN_PATH, { replace: true })
  }

  function manageProducts(): void {
    scope.openConfigBypass()
    navigate('/konfigurasi-produk')
  }

  return (
    <div className={cn(overlay ? 'fixed inset-0 z-[80] overflow-y-auto bg-page' : 'bg-page')}>
      <div className="flex min-h-screen items-start justify-center p-4 sm:items-center sm:p-6">
        <Card className="w-full max-w-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[18px] font-bold tracking-tight text-ink">DVFLOW</p>
              <p className="text-[11px] text-ink-muted">Operasional event</p>
            </div>
            {canCancel ? (
              <Button variant="ghost" size="sm" onClick={scope.closePicker}>Batal</Button>
            ) : null}
          </div>

          <h1 className="mt-4 text-[22px] font-bold tracking-tight text-ink">
            {switching ? 'Ganti Produk' : 'Pilih Produk Dulu'}
          </h1>
          {scope.loading && scope.options.length === 0 ? (
            <div className="mt-4" aria-busy="true"><Skeleton height={120} /></div>
          ) : scope.error !== null && scope.options.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-3">
              <p className="text-[13px] text-danger">{scope.error}</p>
              <Button variant="secondary" size="sm" onClick={scope.reload}>Coba lagi</Button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {scope.error === null ? null : (
                <p className="text-[12px] text-danger">
                  {scope.error}{' '}
                  <button type="button" onClick={scope.reload} className="font-semibold underline underline-offset-2">Coba lagi</button>
                </p>
              )}

              {scope.options.length === 0 ? (
                <div className="rounded-md border border-dashed border-line px-4 py-5 text-center">
                  <p className="text-[13px] font-semibold text-ink">Belum ada produk yang ditugaskan.</p>
                  <p className="mt-1 text-[13px] text-ink-soft">
                    {canManageProducts
                      ? 'Tambahkan produk terlebih dahulu melalui Konfigurasi Produk.'
                      : 'Hubungi admin untuk menambahkan produk.'}
                  </p>
                  {canManageProducts ? (
                    <Button variant="secondary" size="sm" className="mt-3" onClick={manageProducts}>Kelola Produk</Button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="max-h-[320px] overflow-y-auto rounded-md border border-line">
                    {scope.options.map((option) => {
                      const active = scope.chosen && option.value === scope.code
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-label={`${option.value} ${productOptionName(option)}`}
                          onClick={() => scope.choose(option.value)}
                          className={cn(
                            'flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0',
                            active ? 'bg-primary-soft' : 'hover:bg-soft',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-semibold text-ink">{option.value}</span>
                            <span className="block text-[12px] text-ink-soft">{productOptionName(option)}</span>
                          </span>
                          {active ? <span className="shrink-0 text-[11px] font-semibold text-primary">Aktif</span> : null}
                        </button>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    aria-label="Semua Produk"
                    onClick={() => scope.choose('')}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left',
                      scope.chosen && scope.code === ''
                        ? 'border-primary bg-primary-soft'
                        : 'border-line bg-soft hover:border-primary/40',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-ink">Semua Produk</span>
                      <span className="block text-[12px] text-ink-soft">Data gabungan semua produk yang ditugaskan kepada Anda.</span>
                    </span>
                    {scope.chosen && scope.code === '' ? <span className="shrink-0 text-[11px] font-semibold text-primary">Aktif</span> : null}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className="text-[11px] text-ink-soft">Hanya produk yang ditugaskan kepada Anda yang ditampilkan.</p>
            <Button variant="ghost" size="sm" onClick={exit} disabled={leaving}>
              {leaving ? 'Keluar…' : 'Keluar'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}

/**
 * Tombol nama produk + kode + panah. Dipakai di sidebar web dan header field app.
 * Klik membuka layar pilih produk penuh (mode ganti).
 */
export function ProductSwitcher({
  compact = false,
  className,
  onOpen,
}: {
  compact?: boolean
  className?: string
  /** Dipakai drawer HP: tutup panel sebelum layar pilih produk menggantikan shell. */
  onOpen?: () => void
}) {
  const scope = useProductScope()
  if (scope === null) return null

  const selected = scope.options.find((option) => option.value === scope.code)
  const name = !scope.chosen
    ? 'Pilih Produk'
    : scope.code === ''
      ? 'Semua Produk'
      : selected === undefined ? scope.code : productOptionName(selected)

  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.()
        scope.openPicker()
      }}
      aria-label={scope.chosen ? `Ganti produk (${name})` : 'Pilih produk'}
      className={cn(
        'group flex w-full min-w-0 items-center gap-2 text-left',
        compact
          ? 'text-[11px] text-ink-soft'
          : 'rounded-md bg-primary px-2.5 py-2 text-white shadow-card transition-colors hover:bg-primary-hover',
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-bold', compact ? 'text-primary' : 'text-white', compact ? 'text-[11px]' : 'text-[12px]')}>
          {name}
          {compact && scope.chosen && scope.code !== '' ? (
            <span className="ml-1 font-normal text-ink-soft">{scope.code}</span>
          ) : null}
        </span>
        {!compact && scope.chosen && scope.code !== '' ? (
          <span className="block text-[10px] text-white/75">{scope.code}</span>
        ) : null}
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className={cn('h-4 w-4 shrink-0', compact ? 'text-ink-soft' : 'text-white/80')}
      >
        <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

/**
 * Kunci shell (A100).
 *
 * Saat produk belum dipilih, shell tidak dirender sama sekali. Saat pengguna
 * membuka layar ganti produk, shell tetap terpasang di belakang overlay dan
 * dibuat `inert` — sidebar/menu terkunci, tetapi state halaman, sidebar, dan
 * chat tidak hilang saat pengguna menekan Batal.
 */
export function ProductScopeLock({ children }: { children: ReactNode }) {
  const scope = useRequiredScope()
  const location = useLocation()
  const configBypass = scope.configBypass && location.pathname === '/konfigurasi-produk'
  const keepShell = scope.chosen || configBypass
  const showPicker = scope.pickerOpen || (!scope.chosen && !configBypass)

  if (showPicker && !keepShell) return <ProductPickerScreen />

  return (
    <>
      <div inert={showPicker} aria-hidden={showPicker || undefined}>
        {children}
      </div>
      {showPicker ? <ProductPickerScreen overlay /> : null}
    </>
  )
}

/**
 * Isi `<main>`: remount halaman data saat produk berganti agar drawer/modal
 * lama tidak menampilkan data produk sebelumnya.
 */
export function ProductScopeOutlet({ scoped }: { scoped: boolean }) {
  const scope = useRequiredScope()
  if (!scoped) return <Outlet />
  return <div key={scope.code} className="min-w-0"><Outlet /></div>
}
