import { createHandler, type Api, type Env } from '@dvflow/api'

/**
 * Satu tempat penyiapan handler untuk SELURUH Pages Functions.
 *
 * Folder `_lib` sengaja diberi awalan garis bawah: Pages tidak merutekannya,
 * jadi berkas ini tidak pernah menjadi endpoint sendiri — hanya dipakai bersama.
 *
 * Handler di-cache per objek `env`: `env` stabil selama satu isolate hidup,
 * sehingga kunci JWT tidak diimpor ulang pada setiap permintaan.
 */
const handlers = new WeakMap<Env, Api>()

export function handlerFor(env: Env): Api {
  let handler = handlers.get(env)
  if (handler === undefined) {
    handler = createHandler(env)
    handlers.set(env, handler)
  }
  return handler
}

/** Bentuk konteks Pages Function yang kami pakai (tanpa @cloudflare/workers-types). */
export type PagesContext = {
  request: Request
  env: Env
}

export type PagesHandler = (context: PagesContext) => Promise<Response>

/**
 * Bungkus handler agar seluruh rute memakai jalur yang sama.
 *
 * Penting: rute peserta (`/access/*`, `/checkin/*`) TIDAK berada di bawah
 * `/api`, jadi tanpa berkas fungsi tersendiri ia akan jatuh ke fallback SPA dan
 * mengembalikan `index.html` — bukan halaman tiket. Itu pernah terjadi dan
 * tertangkap `scripts/verify-pages-local.mjs`.
 */
export function pagesFunction(): PagesHandler {
  return async (context) => handlerFor(context.env)(context.request)
}
