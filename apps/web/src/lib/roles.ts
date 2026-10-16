import { isMasterAdminRole, type AppRole } from '@dvflow/shared'

export const ROLE_LABELS: Record<string, string> = {
  developer: 'Developer',
  owner: 'Owner',
  manajer: 'Manajer',
  admin: 'Admin',
  pimpro: 'Pimpro',
  advertiser: 'Advertiser',
  member: 'Member',
  master_admin: 'Admin Master',
  staff: 'Team',
}

export const PATH_PERMISSION_MAP: Record<string, string> = {
  '/scan-qr': 'operasional.scan_qr',
  '/': 'operasional.dashboard',
  '/order': 'operasional.order',
  '/order-unmapped': 'operasional.order_unmapped',
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

export type ProfileOrRole = AppRole | { role: AppRole; permissions?: string[]; has_all_product_access?: boolean } | null | undefined

export function hasAllProductAccess(profile: { role: AppRole; has_all_product_access?: boolean } | null | undefined): boolean {
  return !!profile && (isMasterAdminRole(profile.role) || profile.has_all_product_access === true)
}

export function canAccessPath(user: ProfileOrRole, path: string): boolean {
  if (!user) return false
  const role = typeof user === 'string' ? user : user.role
  const permissions = typeof user === 'object' && user.permissions ? user.permissions : null

  // Fitur Reset Data terkunci mutlak HANYA untuk role developer
  if (path === '/reset-data') {
    return role === 'developer'
  }

  // Master Admin tier always has full access
  if (isMasterAdminRole(role)) return true

  if (path === '/logout') return true
  if (path === '/add-team' || path === '/konfigurasi-role') return false
  if (path === '/order-unmapped' && (typeof user === 'string' || !hasAllProductAccess(user))) return false
  if (path === '/konfigurasi-produk') return !!permissions?.some((p) => p === 'config.produk' || p === 'config.alias_produk')
  const required = PATH_PERMISSION_MAP[path]
  return !!required && !!permissions?.includes(required)
}

export function hasPermission(user: ProfileOrRole, permission: string): boolean {
  if (!user) return false
  const role = typeof user === 'string' ? user : user.role
  if (isMasterAdminRole(role)) return true
  if (permission === 'config.roles' || permission === 'team.manage') return false
  return typeof user === 'object' && !!user.permissions?.includes(permission)
}
