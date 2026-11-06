/**
 * Gate deploy: tolak deploy bila database target belum menjalankan migrasi terbaru.
 *
 * Kejadian 14 Okt 2026: push ke main men-deploy kode yang memanggil RPC dari 0027/0028,
 * sementara database produksi masih di 0023 — tombol seperti Hapus menjadi 500.
 * Versi yang dibutuhkan = nomor migrasi tertinggi di supabase/migrations; versi
 * database dibaca dari RPC publik `schema_version()` (0029, hanya mengembalikan angka).
 *
 * Env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (nilai publik yang sama dengan build web).
 */
import { readdirSync, readFileSync } from 'node:fs'

// Read the declared schema version, including CLI-generated timestamp migrations.
const required = Math.max(...readdirSync('supabase/migrations')
  .filter(name => name.endsWith('.sql'))
  .flatMap(name => [...readFileSync(`supabase/migrations/${name}`, 'utf8')
    .matchAll(/function public\.schema_version\(\)[\s\S]*?select (\d+)\s*\$\$/gi)]
    .map(match => Number(match[1]))))

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY belum diset.')
  process.exit(1)
}

const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/schema_version`, {
  method: 'POST',
  headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: '{}',
})
const actual = response.ok ? Number(await response.json()) : null

if (actual === null || !Number.isFinite(actual) || actual < required) {
  console.error(`Database belum siap: schema_version=${actual ?? 'tidak ada'}, dibutuhkan ${required}.`)
  console.error('Jalankan runbook docs/Fitur-2.0/09-RUNBOOK-MIGRASI-PRODUKSI.md sebelum deploy.')
  process.exit(1)
}
console.log(`schema_version=${actual} (dibutuhkan ${required}) — OK`)
