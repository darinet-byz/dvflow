import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

/**
 * Kerangka aplikasi (guideline §7).
 *
 * Desktop-first: sidebar tetap 230px, konten maksimum 1440px dengan radius 24px
 * dan latar `bg-app` di atas `bg-page`. Di layar sempit sidebar berubah menjadi
 * panel yang dapat dibuka — aplikasi harus tetap terpakai di tablet/HP
 * (CLAUDE.md §13), terutama karena panitia memakai scanner dari ponsel.
 */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-page p-4 md:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-32px)] w-full max-w-[1440px] overflow-hidden rounded-xl bg-app shadow-app md:min-h-[calc(100vh-64px)]">
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
          <header className="flex items-center gap-3 border-b border-line px-4 py-3 md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Buka menu"
              className="grid h-9 w-9 place-items-center rounded-sm border border-line bg-card text-ink-soft"
            >
              ☰
            </button>
            <p className="text-[14px] font-bold text-ink">dvflow</p>
          </header>

          <main className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
