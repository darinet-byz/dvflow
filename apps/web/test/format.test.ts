import { describe, expect, it } from 'vitest'
import { formatCount, formatDate, formatDateTime, formatMoney, formatRate, formatText, formatTime } from '../src/lib/format'

/**
 * Pemformat tampilan.
 *
 * Yang paling penting di sini: rasio `null` berarti "penyebutnya nol", dan itu
 * harus tampil sebagai "-", bukan "0%" (STATE.md K4) — membedakan "belum ada
 * data" dari "nol persen" adalah keputusan yang sudah dikunci.
 */
describe('uang', () => {
  it('memformat rupiah tanpa desimal', () => {
    expect(formatMoney(300000)).toMatch(/300\.000/)
    expect(formatMoney('296000.00')).toMatch(/296\.000/)
    expect(formatMoney(0)).toMatch(/0/)
  })

  it('nilai kosong atau tidak masuk akal menjadi tanda hubung', () => {
    expect(formatMoney(null)).toMatch(/0/)
    expect(formatMoney('bukan angka')).toBe('-')
  })
})

describe('rasio', () => {
  it('null berarti penyebut nol -> tanda hubung, bukan 0%', () => {
    expect(formatRate(null)).toBe('-')
    expect(formatRate(undefined)).toBe('-')
  })

  it('rasio ditampilkan sebagai persen', () => {
    expect(formatRate(0.5)).toBe('50%')
    expect(formatRate(1)).toBe('100%')
    expect(formatRate(0)).toBe('0%')
    expect(formatRate(0.0675)).toBe('6.8%')
  })
})

describe('jumlah', () => {
  it('memakai pemisah ribuan Indonesia', () => {
    expect(formatCount(1234)).toBe('1.234')
    expect(formatCount(0)).toBe('0')
    expect(formatCount('bukan angka')).toBe('-')
  })
})

describe('waktu', () => {
  it('nilai kosong menjadi tanda hubung, bukan Invalid Date', () => {
    expect(formatDateTime(null)).toBe('-')
    expect(formatDateTime('')).toBe('-')
    expect(formatDateTime('bukan tanggal')).toBe('-')
    expect(formatTime(null)).toBe('-')
    expect(formatDate(null)).toBe('-')
  })

  it('waktu ditampilkan dalam bentuk yang dapat dibaca', () => {
    // Format bergantung zona waktu perangkat, jadi yang diperiksa isinya.
    const formatted = formatDateTime('2026-10-13T08:00:00.000Z')
    expect(formatted).toMatch(/2026/)
    expect(formatted).not.toBe('-')
  })
})

describe('teks', () => {
  it('nilai kosong menjadi tanda hubung supaya sel tidak terlihat rusak', () => {
    expect(formatText(null)).toBe('-')
    expect(formatText('')).toBe('-')
    expect(formatText('   ')).toBe('-')
    expect(formatText(' Solo ')).toBe('Solo')
  })
})
