export type ExportColumn = { key: string; header: string }

/** Quote every field, preserve Unicode, and neutralize spreadsheet formulas. */
export function toCsv(rows: Record<string, unknown>[], columns: readonly ExportColumn[]): string {
  const cell = (value: unknown): string => {
    let text = value == null ? '' : String(value)
    if (typeof value === 'string' && (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  return '\uFEFF' + [columns.map((c) => cell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => cell(row[c.key])).join(','))].join('\r\n')
}

export async function collectPages<T>(load: (page: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const first = await load(1)
  const rows = [...first.rows]
  let total = first.total
  for (let page = 2; rows.length < total; page++) {
    const next = await load(page)
    if (next.total !== total || next.rows.length === 0) {
      throw new Error('Data berubah saat export. Silakan ulangi export.')
    }
    rows.push(...next.rows)
    total = next.total
  }
  return rows
}

export type CsvSerializer = (rows: Record<string, unknown>[], columns: readonly ExportColumn[]) => string

export function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  columns: readonly ExportColumn[],
  serialize: CsvSerializer = toCsv,
): void {
  const url = URL.createObjectURL(new Blob([serialize(rows, columns)], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
