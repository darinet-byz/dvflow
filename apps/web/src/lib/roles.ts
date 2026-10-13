import { isMasterAdminRole, type AppRole } from '@dvflow/shared'

export const ROLE_LABELS: Record<string, string> = {
  developer: 'Developer',
  owner: 'Owner',
  manajer: 'Manajer',
  admin: 'Admin',
  pimpro: 'Pimpro',
  member: 'Member',
  master_admin: 'Admin Master',
  staff: 'Team',
}

export const PATH_PERMISSION_MAP: Record<string, string> = {
  '/scan-qr': 'operasional.scan_qr',
  '/': 'operasional.dashboard',
  '/order': 'operasional.order',
  '/presensi': 'operasional.presensi',
  '/generator': 'operasional.generator',
  '/konfigurasi-produk': 'config.produk',
  '/konfigurasi-tax': 'config.tax',
  '/report-tax': 'config.report_tax',
  '/konfigurasi-zoom': 'config.zoom',
  '/konfigurasi-tiket': 'config.tiket',
  '/integrasi': 'config.integrasi',
  '/konfigurasi-role': 'config.roles',
  '/add-team': 'team.manage',
  '/profil': 'account.profile',
}

export type ProfileOrRole = AppRole | { role: AppRole; permissions?: string[] } | null | undefined

export function canAccessPath(user: ProfileOrRole, path: string): boolean {
  if (!user) return false
  const role = typeof user === 'string' ? user : user.role
  const permissions = typeof user === 'object' && user.permissions ? user.permissions : null

  // Master Admin tier always has full access
  if (isMasterAdminRole(role)) return true

  // If dynamic permissions are present, check them directly
  if (permissions && permissions.length > 0) {
    if (path === '/logout') return true
    const required = PATH_PERMISSION_MAP[path]
    if (required) return permissions.includes(required)
  }

  // Fallback checks by role
  if (path === '/add-team' || path === '/konfigurasi-role') {
    return isMasterAdminRole(role)
  }
  if (
    path === '/konfigurasi-produk' ||
    path === '/konfigurasi-tax' ||
    path === '/report-tax' ||
    path === '/integrasi'
  ) {
    return role !== 'staff' && role !== 'member' && role !== 'pimpro'
  }
  return true
}
