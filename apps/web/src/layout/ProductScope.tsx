import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { fetchProductOptions, type ConfigOption } from '../lib/queries'
import { useAsyncData } from '../lib/useAsyncData'
import { useSession } from '../lib/useSession'
import {
  ALL_PRODUCTS,
  PRODUCT_SCOPE_TTL_MS,
  markProductScopeExpired,
  persistProductScope,
  productScopeExpiresAt,
  productScopeStorageKey,
  readStoredProductScope,
  readStoredProductScopeState,
} from '../lib/product-scope'
import { canAccessPath } from '../lib/roles'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Skeleton } from '../ui/Feedback'
import { cn } from '../ui/cn'

/**
 * Product scope global (A97).
 *
 * Satu produk dipilih di bar atas dan dipakai seluruh halaman data. Pilihan
 * disimpan per user selama 24 jam, lalu pengguna harus memilih lagi. Logout
 * menghapus pilihan sepenuhnya.
 *
 * Provider ini hanya dipasang di shell web (bukan Tampilan Apps Lapangan).
 */

export type ProductScope = {
  /** `''` berarti "Semua Produk". */
  code: string
  /** `false` = belum pernah memilih atau pilihan sudah kedaluwarsa. */
  chosen: boolean
  chosenAt: number | null
  expiresAt: number | null
  options: ConfigOption[]
  loading: boolean
  error: string | null
  reload: () => void
  choose: (code: string) => void
  selectedLabel: string
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

type InitialSelection = {
  selection: Selection
  /** Pilihan lama ada tetapi sudah lewat 24 jam/rusak: jangan auto-select lagi. */
  expired: boolean
}

function initialSelection(userId: string | null, search: string): InitialSelection {
  // Deep link dianggap pilihan baru: timer 24 jam dimulai ulang.
  const urlCode = new URLSearchParams(search).get('productCode')
  if (urlCode !== null && urlCode !== '') {
    return { selection: { code: urlCode, chosenAt: Date.now() }, expired: false }
  }

  const stored = readStoredProductScopeState(userId)
  if (stored.status === 'valid') return { selection: stored.scope, expired: false }
  if (stored.status === 'expired') return { selection: { code: '', chosenAt: null }, expired: true }
  return { selection: { code: '', chosenAt: null }, expired: false }
}

export function ProductScopeProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession()
  const userId = profile?.user_id ?? null
  const location = useLocation()
  const [initial] = useState<InitialSelection>(() => initialSelection(userId, location.search))
  const [selection, setSelection] = useState<Selection>(initial.selection)
  const expiredOnMount = useRef(initial.expired)
  const { data, loading, error, reload } = useAsyncData(fetchProductOptions, [])
  const options = data ?? NO_OPTIONS

  const chosen = selection.chosenAt !== null
  const expiresAt = selection.chosenAt === null ? null : productScopeExpiresAt({ code: selection.code, chosenAt: selection.chosenAt })

  const expire = useCallback(() => {
    markProductScopeExpired(userId)
    setSelection({ code: '', chosenAt: null })
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('productCode')) {
        url.searchParams.delete('productCode')
        // Pertahankan state history React Router; jangan diganti dengan objek kosong.
        window.history.replaceState(window.history.state, '', url)
      }
    } catch {
      // URL tidak dapat diubah (mis. lingkungan tanpa history): state tetap aman.
    }
  }, [userId])

  const choose = useCallback((code: string) => {
    const stored = persistProductScope(userId, code)
    setSelection(stored)
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('productCode')) {
        if (code === '') url.searchParams.delete('productCode')
        else url.searchParams.set('productCode', code)
        // Sama seperti expire: state history milik router harus dipertahankan.
        window.history.replaceState(window.history.state, '', url)
      }
    } catch {
      // Sama seperti expire: kegagalan menulis URL tidak boleh menghalangi pilihan.
    }
  }, [userId])

  // Deep link / perubahan query string: hormati produk yang diminta dan mulai timer baru.
  const handledSearch = useRef<string | null>(null)
  useEffect(() => {
    if (handledSearch.current === location.search) return
    handledSearch.current = location.search
    const urlCode = new URLSearchParams(location.search).get('productCode')
    if (urlCode === null || urlCode === '') return
    choose(urlCode)
  }, [location.search, choose])

  // Auto-pilih hanya sekali saat inisialisasi, tidak setelah expiry.
  const autoSelectDone = useRef(false)
  useEffect(() => {
    if (autoSelectDone.current) return
    if (loading || error !== null) return
    autoSelectDone.current = true
    // Pilihan lama sudah kedaluwarsa: gate harus muncul walau produknya hanya satu.
    if (expiredOnMount.current) return
    if (selection.chosenAt !== null) return
    if (options.length !== 1) return
    const onlyOption = options[0]
    if (onlyOption === undefined) return
    choose(onlyOption.value)
  }, [loading, error, options, selection.chosenAt, choose])

  // Produk tersimpan yang nonaktif / aksesnya dicabut: buang dan tampilkan gate.
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
    const at = selection.chosenAt + PRODUCT_SCOPE_TTL_MS
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
  }, [selection.chosenAt, expire])

  // Sinkronisasi antar-tab: logout / ganti produk di tab lain ikut terlihat di sini.
  useEffect(() => {
    const key = productScopeStorageKey(userId)
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return
      const stored = readStoredProductScope(userId)
      setSelection(stored === null ? { code: '', chosenAt: null } : stored)
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
  }), [selection.code, selection.chosenAt, chosen, expiresAt, options, loading, error, reload, choose, selectedLabel])

  return <ProductScopeContext.Provider value={value}>{children}</ProductScopeContext.Provider>
}

/**
 * Bar produk di atas konten. Selalu tampil di shell web supaya produk dapat
 * diganti dari halaman mana pun.
 */
export function ProductScopeBar() {
  const scope = useRequiredScope()
  const value = !scope.chosen ? '' : scope.code === '' ? ALL_PRODUCTS : scope.code
  const missingOption = scope.chosen && scope.code !== '' && !scope.options.some((option) => option.value === scope.code)
  const emptyOptions = scope.loading && scope.options.length === 0

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
      <label htmlFor="global-product-scope" className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        Produk
      </label>
      <select
        id="global-product-scope"
        aria-label="Pilih produk aktif"
        value={value}
        disabled={emptyOptions}
        onChange={(event) => {
          const next = event.target.value
          if (next === '') return
          scope.choose(next === ALL_PRODUCTS ? '' : next)
        }}
        className={cn(
          'h-9 w-full min-w-0 rounded-sm border bg-card px-2 text-[13px] font-semibold text-ink focus:border-primary focus:outline-none sm:w-[240px]',
          scope.chosen ? 'border-line' : 'border-primary text-primary',
          emptyOptions && 'opacity-60',
        )}
      >
        <option value="" disabled>Pilih Produk…</option>
        <option value={ALL_PRODUCTS}>Semua Produk</option>
        {missingOption ? <option value={scope.code}>{scope.code}</option> : null}
        {scope.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {scope.error === null ? null : (
        <button
          type="button"
          onClick={scope.reload}
          className="shrink-0 text-[12px] font-semibold text-danger underline underline-offset-2"
        >
          Muat ulang
        </button>
      )}
    </div>
  )
}

/**
 * Gate halaman data: pengguna harus memilih produk (atau "Semua Produk")
 * sebelum konten halaman ditampilkan.
 */
export function ProductPickerGate() {
  const scope = useRequiredScope()
  const { profile } = useSession()
  const canManageProducts = canAccessPath(profile, '/konfigurasi-produk')

  return (
    <Card className="mx-auto mt-4 w-full max-w-2xl">
      <h2 className="text-[22px] font-bold tracking-tight text-ink">Pilih Produk Dulu</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        Pilih produk untuk membuka dashboard, order, laporan, dan data acara. Pilihan berlaku 24 jam dan bisa diganti kapan saja dari bar atas.
      </p>

      {scope.loading ? (
        <div className="mt-4" aria-busy="true"><Skeleton height={120} /></div>
      ) : scope.error !== null ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-[13px] text-danger">{scope.error}</p>
          <Button onClick={scope.reload}>Coba lagi</Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {scope.options.length === 0 ? (
            <div className="rounded-md border border-dashed border-line px-4 py-5 text-center">
              <p className="text-[13px] font-semibold text-ink">Belum ada produk aktif.</p>
              <p className="mt-1 text-[13px] text-ink-soft">
                {canManageProducts
                  ? <>Tambahkan produk terlebih dahulu di <Link to="/konfigurasi-produk" className="font-semibold text-primary underline">Konfigurasi Produk</Link>.</>
                  : 'Hubungi admin untuk menambahkan produk.'}
              </p>
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto rounded-md border border-line">
              {scope.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => scope.choose(option.value)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-soft"
                >
                  <span className="text-[13px] font-semibold text-ink">{option.value}</span>
                  <span className="text-[12px] text-ink-soft">{option.name ?? option.label}</span>
                </button>
              ))}
            </div>
          )}
          {scope.options.length === 0 ? null : (
            <button
              type="button"
              onClick={() => scope.choose('')}
              className="flex w-full flex-col items-start gap-0.5 rounded-md border border-line bg-soft px-4 py-3 text-left hover:border-primary/40"
            >
              <span className="text-[13px] font-semibold text-ink">Semua Produk</span>
              <span className="text-[12px] text-ink-soft">Data gabungan semua produk yang Anda akses.</span>
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * Isi `<main>`: gate untuk halaman ber-scope, dan remount halaman saat produk
 * berganti agar drawer/modal lama tidak menampilkan data produk sebelumnya.
 */
export function ProductScopeOutlet({ scoped }: { scoped: boolean }) {
  const scope = useRequiredScope()
  if (!scoped) return <Outlet />
  if (!scope.chosen) {
    if (scope.loading && scope.error === null) {
      return (
        <div aria-busy="true">
          <Card className="mx-auto mt-4 w-full max-w-2xl">
            <Skeleton height={28} className="max-w-[220px]" />
            <Skeleton height={120} className="mt-4" />
          </Card>
        </div>
      )
    }
    return <ProductPickerGate />
  }
  return <div key={scope.code} className="min-w-0"><Outlet /></div>
}
