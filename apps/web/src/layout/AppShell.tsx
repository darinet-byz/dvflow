import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { FieldAppShell } from './FieldAppShell'
import { GlobalSearchButton, GlobalSearchDialog } from './GlobalSearch'
import { ProductScopeLock, ProductScopeOutlet, ProductScopeProvider } from './ProductScope'
import { ChatWorkspace } from '../pages/chat/ChatWorkspace'
import { useSession } from '../lib/useSession'
import { isProductScopedPath } from '../lib/product-scope'
import { canUseFieldApp, setPreferWebLayout, useIsPhone, usePreferWebLayout } from '../lib/field-app'

/**
 * Kerangka aplikasi (guideline §7).
 *
 * Desktop-first: sidebar tetap 230px, konten maksimum 1920px dengan radius 24px
 * dan latar `bg-app` di atas `bg-page`; panel Advertiser Notes dapat menjadi kolom
 * kedua di kanan pada layar lebar (A65). Di layar sempit sidebar berubah menjadi
 * panel yang dapat dibuka — aplikasi harus tetap terpakai di tablet/HP
 * (CLAUDE.md §13), terutama karena panitia memakai scanner dari ponsel.
 *
 * A97/A98: produk dipilih di layar penuh sebelum shell dibuka. Sidebar/field app
 * hanya dirender setelah produk dipilih.
 */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const { profile } = useSession()
  const location = useLocation()
  const isPhone = useIsPhone()
  const preferWeb = usePreferWebLayout()
  // A30: Pimpro/Staff/Member berizin "Tampilan Apps Lapangan" memakai kerangka aplikasi di HP.
  const fieldEligible = canUseFieldApp(profile) && isPhone

  const content = fieldEligible && !preferWeb ? (
    <FieldAppShell />
  ) : (
    <div className="min-h-screen bg-page p-2 sm:p-4 md:p-8">
      <GlobalSearchDialog />
      <div className="mx-auto flex w-full max-w-[1920px] items-stretch justify-center gap-3">
        <div className="flex min-h-[calc(100vh-32px)] min-w-0 max-w-[1440px] flex-1 overflow-hidden rounded-xl bg-app shadow-app md:min-h-[calc(100vh-64px)]">
          {/* Sidebar tetap untuk md ke atas. */}
          <div className="hidden md:flex">
            <Sidebar />
          </div>

          {/* Panel sidebar untuk layar sempit. */}
          {menuOpen ? (
            <div className="fixed inset-0 z-40 flex bg-ink/30 md:hidden" role="presentation" onClick={() => setMenuOpen(false)}>
              <div className="h-full bg-sidebar" onClick={(event) => event.stopPropagation()}>
                <Sidebar onNavigate={() => setMenuOpen(false)} />
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-card/95 px-4 py-2.5 backdrop-blur md:px-6">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label="Buka menu"
                className="grid h-9 w-9 place-items-center rounded-sm border border-line bg-card text-ink-soft md:hidden"
              >
                ☰
              </button>
              <p className="text-[14px] font-bold text-ink md:hidden">DVFLOW</p>
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden md:block md:w-[280px]">
                  <GlobalSearchButton />
                </div>
                <GlobalSearchButton compact className="md:hidden" />
                {fieldEligible ? (
                  <button
                    type="button"
                    onClick={() => setPreferWebLayout(false)}
                    className="rounded-sm border border-line bg-card px-2.5 py-1.5 text-[12px] font-semibold text-primary"
                  >
                    Tampilan aplikasi
                  </button>
                ) : null}
              </div>
            </header>

            <main className="min-w-0 flex-1 p-3 sm:p-4 md:p-6">
              <ProductScopeOutlet scoped={isProductScopedPath(location.pathname)} />
            </main>
          </div>
        </div>

        <ChatWorkspace />
      </div>
    </div>
  )

  return (
    <ProductScopeProvider>
      <ProductScopeLock>{content}</ProductScopeLock>
    </ProductScopeProvider>
  )
}
