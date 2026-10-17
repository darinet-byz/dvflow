import { FIELD_APP_PERMISSION, FIELD_APP_ROLES, isMasterAdminRole, type AppPermissionItem, type AppPermissionModuleGroup, type AppRoleItem } from '@dvflow/shared'
import { ApiFailure } from '../http/errors'
import { ok, readJsonObject, readString } from '../http/response'
import type { RouteContext } from '../router'
import { requireActiveUser, type UserRow } from '../users'

const MODULE_NAMES: Record<string, string> = {
  operasional: 'Operasional',
  konfigurasi: 'Konfigurasi',
  team: 'Manajemen Tim',
  account: 'Akun & Profil',
  aksi: 'Aksi Khusus',
  tampilan: 'Tampilan',
}

/**
 * GET /api/roles
 * Daftar seluruh role, user_count, dan permission_count.
 */
export async function listRoles(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) {
    throw new ApiFailure('FORBIDDEN', 'Akses ditolak: Master Admin diperlukan')
  }

  const roles = await context.db.selectRows<AppRoleItem>(
    'app_roles',
    { order: 'created_at.asc' },
    'id,name,description,is_system,created_at,updated_at',
  )

  const users = await context.db.selectRows<{ role: string }>('users', {}, 'role')
  const userCounts: Record<string, number> = {}
  for (const u of users) {
    userCounts[u.role] = (userCounts[u.role] ?? 0) + 1
  }

  const rolePerms = await context.db.selectRows<{ role_id: string }>(
    'app_role_permissions',
    {},
    'role_id',
  )
  const permCounts: Record<string, number> = {}
  for (const rp of rolePerms) {
    permCounts[rp.role_id] = (permCounts[rp.role_id] ?? 0) + 1
  }

  const catalog = await context.db.selectRows<{ key: string }>('app_permissions', {}, 'key')
  const items = roles.map((r) => ({
    ...r,
    user_count: userCounts[r.id] ?? 0,
    permission_count: isMasterAdminRole(r.id) ? catalog.length : (permCounts[r.id] ?? 0),
  }))

  return ok({ roles: items })
}

/**
 * POST /api/roles
 * Buat role kustom baru.
 */
export async function createRole(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) {
    throw new ApiFailure('FORBIDDEN', 'Akses ditolak: Master Admin diperlukan')
  }

  const body = await readJsonObject(context.request)
  const id = readString(body, 'id')?.toLowerCase().trim()
  const name = readString(body, 'name')?.trim()
  const description = readString(body, 'description')?.trim() ?? null

  if (!id || !name) {
    throw new ApiFailure('INVALID_PAYLOAD', undefined, 'ID dan Nama role wajib diisi')
  }

  if (!/^[a-z0-9_]{3,32}$/.test(id)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'ID role harus berupa huruf kecil, angka, garis bawah (3-32 karakter)')
  }

  if (name.length < 2 || name.length > 64) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Nama role harus antara 2-64 karakter')
  }

  const existing = await context.db.selectRows<AppRoleItem>('app_roles', { id: `eq.${id}` }, 'id')
  if (existing.length > 0) {
    throw new ApiFailure('CODE_TAKEN', undefined, 'Role ID sudah terdaftar')
  }

  const permissions = await validatedPermissions(context, body['permissions'] ?? [], id)
  const createdRole = await context.db.rpc<AppRoleItem>('save_role_permissions', {
    p_actor: actor.id, p_role: id, p_permissions: permissions, p_create: true,
    p_name: name, p_description: description,
  })
  const permissionsCount = permissions.length

  return ok(
    {
      id: createdRole.id,
      name: createdRole.name,
      description: createdRole.description,
      is_system: false,
      permission_count: permissionsCount,
    },
    { status: 201 },
  )
}

/**
 * GET /api/roles/:id
 * Detail role beserta daftar permission keys aktifnya.
 */
export async function getRole(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) {
    throw new ApiFailure('FORBIDDEN', 'Akses ditolak: Master Admin diperlukan')
  }

  const roleId = (context.params['id'] ?? '').trim()
  if (!roleId) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Role ID tidak valid')

  const roles = await context.db.selectRows<AppRoleItem>('app_roles', { id: `eq.${roleId}` }, 'id,name,description,is_system')
  const role = roles[0]
  if (!role) throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'Role tidak ditemukan')

  const rolePerms = await context.db.selectRows<{ permission_key: string }>(
    'app_role_permissions',
    { role_id: `eq.${roleId}` },
    'permission_key',
  )

  return ok({
    id: role.id,
    name: role.name,
    description: role.description,
    is_system: role.is_system,
    permissions: isMasterAdminRole(roleId) ? (await context.db.selectRows<{ key: string }>('app_permissions', {}, 'key')).map(p => p.key) : rolePerms.map((rp) => rp.permission_key),
  })
}

/**
 * PUT /api/roles/:id/permissions
 * Perbarui checklist hak akses suatu role.
 */
export async function updateRolePermissions(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) {
    throw new ApiFailure('FORBIDDEN', 'Akses ditolak: Master Admin diperlukan')
  }

  const roleId = (context.params['id'] ?? '').trim()
  if (!roleId) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Role ID tidak valid')

  const roles = await context.db.selectRows<AppRoleItem>('app_roles', { id: `eq.${roleId}` }, 'id')
  const role = roles[0]
  if (!role) throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'Role tidak ditemukan')

  const body = await readJsonObject(context.request)
  if (!Array.isArray(body['permissions'])) {
    throw new ApiFailure('INVALID_PAYLOAD', 'permissions harus berupa array')
  }

  const permissions = await validatedPermissions(context, body['permissions'], roleId)
  await context.db.rpc('save_role_permissions', {
    p_actor: actor.id, p_role: roleId, p_permissions: permissions, p_create: false,
  })
  const count = isMasterAdminRole(roleId) ? (await context.db.selectRows<{ key: string }>('app_permissions', {}, 'key')).length : permissions.length

  return ok({
    success: true,
    id: roleId,
    permission_count: count,
  })
}

/**
 * DELETE /api/roles/:id
 * Hapus role kustom (tolak jika role sistem atau ada user terikat).
 */
export async function deleteRole(context: RouteContext): Promise<Response> {
  const actor = await requireActiveUser(context)
  if (!isMasterAdminRole(actor.role)) {
    throw new ApiFailure('FORBIDDEN', 'Akses ditolak: Master Admin diperlukan')
  }

  const roleId = (context.params['id'] ?? '').trim()
  if (!roleId) throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Role ID tidak valid')

  const roles = await context.db.selectRows<AppRoleItem>('app_roles', { id: `eq.${roleId}` }, 'id,is_system')
  const role = roles[0]
  if (!role) throw new ApiFailure('RESOURCE_NOT_FOUND', undefined, 'Role tidak ditemukan')

  if (role.is_system) {
    throw new ApiFailure('SYSTEM_ROLE_CANNOT_BE_DELETED')
  }

  const users = await context.db.selectRows<UserRow>('users', { role: `eq.${roleId}` }, 'id')
  if (users.length > 0) {
    throw new ApiFailure(
      'ROLE_IN_USE',
      undefined,
      `Role masih digunakan oleh ${users.length} pengguna. Pindahkan pengguna ke role lain sebelum menghapus.`,
    )
  }

  await context.db.deleteRows('app_roles', { id: `eq.${roleId}` })

  return ok({ success: true, deleted_id: roleId })
}

/**
 * GET /api/permissions
 * Mengambil seluruh permissions dikelompokkan per modul.
 */
export async function listPermissions(context: RouteContext): Promise<Response> {
  await requireActiveUser(context)

  const rows = await context.db.selectRows<AppPermissionItem>(
    'app_permissions',
    { order: 'sort_order.asc' },
    'key,name,module,description,sort_order',
  )

  const moduleMap: Map<string, AppPermissionItem[]> = new Map()
  for (const row of rows) {
    const list = moduleMap.get(row.module) ?? []
    list.push(row)
    moduleMap.set(row.module, list)
  }

  const modules: AppPermissionModuleGroup[] = []
  for (const [mod, perms] of moduleMap.entries()) {
    modules.push({
      module: mod,
      module_name: MODULE_NAMES[mod] ?? mod,
      permissions: perms,
    })
  }

  return ok({ modules })
}

async function validatedPermissions(context: RouteContext, value: unknown, roleId: string): Promise<string[]> {
  if (!Array.isArray(value) || value.some((p) => typeof p !== 'string')) throw new ApiFailure('INVALID_PAYLOAD')
  const keys = [...new Set((value as string[]).map((p) => p.trim()))]
  if (keys.includes(FIELD_APP_PERMISSION) && !FIELD_APP_ROLES.includes(roleId)) {
    throw new ApiFailure('INVALID_ARGUMENT', undefined, 'Tampilan Apps Lapangan hanya untuk role Pimpro, Staff, dan Member.')
  }
  const catalog = await context.db.selectRows<{ key: string }>('app_permissions', {}, 'key')
  if (keys.some((key) => !catalog.some((p) => p.key === key))) throw new ApiFailure('INVALID_ARGUMENT')
  return keys
}
