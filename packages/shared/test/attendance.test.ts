import { describe, expect, it } from 'vitest'
import { attendanceStatusLabel, selectLatestTimestamps } from '../src/domain/attendance'
import { ATTENDANCE_RETENTION_DAYS, TIMESTAMP_DISPLAY_LIMIT } from '../src/domain/constants'

describe('status kehadiran (PRD §107)', () => {
  it('I02 Paid tanpa attendance -> Belum Hadir', () => {
    expect(attendanceStatusLabel('Paid', 0)).toBe('Belum Hadir')
  })

  it('I03 Paid dengan satu atau lebih attendance -> Hadir', () => {
    expect(attendanceStatusLabel('Paid', 1)).toBe('Hadir')
    expect(attendanceStatusLabel('Paid', 17)).toBe('Hadir')
  })

  it('I04 Pending BUKAN Belum Hadir', () => {
    expect(attendanceStatusLabel('Pending', 0)).toBe('Pending')
    expect(attendanceStatusLabel('Pending', 3)).toBe('Pending')
  })

  it('Cancelled tetap Cancelled walau ada attendance tercatat', () => {
    expect(attendanceStatusLabel('Cancelled', 0)).toBe('Cancelled')
    expect(attendanceStatusLabel('Cancelled', 2)).toBe('Cancelled')
  })
})

describe('rolling timestamp (PRD §105)', () => {
  const seventeenEvents = Array.from({ length: 17 }, (_, index) => {
    const minute = String(index).padStart(2, '0')
    return `2026-10-12T10:${minute}:00.000Z`
  })

  it('I05/I06 Total Activity 17 tetapi hanya 10 timestamp terbaru yang ditampilkan', () => {
    const shown = selectLatestTimestamps(seventeenEvents)

    expect(seventeenEvents).toHaveLength(17)
    expect(shown).toHaveLength(TIMESTAMP_DISPLAY_LIMIT)
    expect(shown[0]).toBe('2026-10-12T10:16:00.000Z')
    expect(shown[9]).toBe('2026-10-12T10:07:00.000Z')
  })

  it('hasil selalu terurut terbaru-dulu walau input tidak terurut', () => {
    const unsorted = [
      '2026-10-12T10:05:00.000Z',
      '2026-10-12T10:16:00.000Z',
      '2026-10-12T10:01:00.000Z',
    ]

    expect(selectLatestTimestamps(unsorted)).toEqual([
      '2026-10-12T10:16:00.000Z',
      '2026-10-12T10:05:00.000Z',
      '2026-10-12T10:01:00.000Z',
    ])
  })

  it('tidak mengubah array milik pemanggil', () => {
    const input = ['2026-10-12T10:01:00.000Z', '2026-10-12T10:02:00.000Z']
    const snapshot = [...input]

    selectLatestTimestamps(input)

    expect(input).toEqual(snapshot)
  })

  it('daftar kosong menghasilkan daftar kosong', () => {
    expect(selectLatestTimestamps([])).toEqual([])
  })

  it('I07 retensi raw attendance ditetapkan 30 hari', () => {
    expect(ATTENDANCE_RETENTION_DAYS).toBe(30)
  })
})
