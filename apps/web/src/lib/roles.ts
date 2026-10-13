import type { AppRole } from '@dvflow/shared'

export const ROLE_LABELS: Record<AppRole, string> = { master_admin: 'Admin Master', admin: 'Admin', staff: 'Team' }
export function canAccessPath(role: AppRole, path: string): boolean {
  if (path === '/add-team') return role === 'master_admin'
  if (['/konfigurasi-produk', '/konfigurasi-tax', '/report-tax', '/integrasi'].includes(path)) return role !== 'staff'
  return true
}
