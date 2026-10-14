import { useState } from 'react'
import { isMasterAdminRole, type AppPermissionModuleGroup, type AppRoleItem } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { SearchInput, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

const columns = [
  { key: 'role', header: 'Role' },
  { key: 'type', header: 'Tipe' },
  { key: 'description', header: 'Deskripsi' },
  { key: 'users', header: 'Pengguna' },
  { key: 'permissions', header: 'Hak Akses' },
  { key: 'actions', header: 'Aksi' },
]

export function RoleConfigPage() {
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // State Modal Tambah Role
  const [isCreating, setIsCreating] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPermissions, setNewPermissions] = useState<Set<string>>(new Set())

  // State Modal Atur Hak Akses
  const [editingRole, setEditingRole] = useState<AppRoleItem | null>(null)
  const [editPermissions, setEditPermissions] = useState<Set<string>>(new Set())
  const [loadingDetail, setLoadingDetail] = useState(false)

  // State Modal Hapus Role
  const [deletingRole, setDeletingRole] = useState<AppRoleItem | null>(null)

  // Load Roles & Permissions Dictionary
  const { data: rolesData, loading: loadingRoles, error: rolesError, reload: reloadRoles } = useAsyncData(
    () => authorizedRequest<{ roles: AppRoleItem[] }>('/api/roles'),
    [],
  )

  const { data: permsData, loading: loadingPerms } = useAsyncData(
    () => authorizedRequest<{ modules: AppPermissionModuleGroup[] }>('/api/permissions'),
    [],
  )

  const modules = permsData?.modules ?? []
  const allRoles = rolesData?.roles ?? []

  const term = search.trim().toLowerCase()
  const filteredRoles = allRoles.filter((r) =>
    [r.id, r.name, r.description ?? ''].some((val) => val.toLowerCase().includes(term)),
  )

  // Handler Open Modal Atur Hak Akses
  async function openEditPermissions(role: AppRoleItem) {
    setEditingRole(role)
    setLoadingDetail(true)
    setFailure(null)
    try {
      const res = await authorizedRequest<{ permissions: string[] }>(`/api/roles/${role.id}`)
      setEditPermissions(new Set(res.permissions))
    } catch {
      toast.show('Gagal memuat detail hak akses role', 'danger')
      setEditingRole(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  // Handler Save Atur Hak Akses
  async function saveRolePermissions() {
    if (!editingRole || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(`/api/roles/${editingRole.id}/permissions`, {
        method: 'PUT',
        body: { permissions: Array.from(editPermissions) },
      })
      toast.show(`Hak akses untuk role ${editingRole.name} berhasil diperbarui.`, 'success')
      setEditingRole(null)
      reloadRoles()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Gagal menyimpan perubahan hak akses.')
    } finally {
      setBusy(false)
    }
  }

  // Handler Submit Tambah Role Baru
  async function submitCreateRole() {
    if (busy) return
    const id = newId.trim().toLowerCase()
    const name = newName.trim()

    if (!id || !name) {
      setFailure('ID dan Nama role wajib diisi.')
      return
    }

    if (!/^[a-z0-9_]{3,32}$/.test(id)) {
      setFailure('ID role hanya boleh huruf kecil, angka, dan garis bawah (3-32 karakter).')
      return
    }

    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/roles', {
        method: 'POST',
        body: {
          id,
          name,
          description: newDescription.trim() || null,
          permissions: Array.from(newPermissions),
        },
      })
      toast.show(`Role ${name} berhasil dibuat.`, 'success')
      setIsCreating(false)
      setNewId('')
      setNewName('')
      setNewDescription('')
      setNewPermissions(new Set())
      reloadRoles()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Gagal membuat role baru.')
    } finally {
      setBusy(false)
    }
  }

  // Handler Delete Role
  async function confirmDeleteRole() {
    if (!deletingRole || busy) return
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest(`/api/roles/${deletingRole.id}`, { method: 'DELETE' })
      toast.show(`Role ${deletingRole.name} berhasil dihapus.`, 'success')
      setDeletingRole(null)
      reloadRoles()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Gagal menghapus role.')
    } finally {
      setBusy(false)
    }
  }

  // Helper Toggle Permission
  function togglePerm(setObj: Set<string>, key: string, updater: (s: Set<string>) => void) {
    const next = new Set(setObj)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    updater(next)
  }

  // Helper Toggle Entire Module
  function toggleModule(
    moduleGroup: AppPermissionModuleGroup,
    setObj: Set<string>,
    updater: (s: Set<string>) => void,
  ) {
    const keys = moduleGroup.permissions.map((p) => p.key)
    const allChecked = keys.every((k) => setObj.has(k))
    const next = new Set(setObj)
    if (allChecked) {
      keys.forEach((k) => next.delete(k))
    } else {
      keys.forEach((k) => next.add(k))
    }
    updater(next)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Konfigurasi Role & Hak Akses"
        description="Kelola peran pengguna dan atur checklist perizinan akses secara granular per modul."
        action={
          <Button variant="primary" onClick={() => { setIsCreating(true); setFailure(null) }}>
            + Tambah Role Baru
          </Button>
        }
      />

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:w-72">
            <SearchInput
              id="search-roles"
              value={search}
              onChange={setSearch}
              placeholder="Cari nama atau kode role..."
            />
          </div>
          <p className="text-[12px] text-ink-muted">
            Total {allRoles.length} role terdaftar
          </p>
        </div>

        {loadingRoles ? (
          <SkeletonRows rows={5} />
        ) : rolesError ? (
          <ErrorState
            title="Gagal memuat role"
            message={rolesError}
            action={<Button onClick={reloadRoles}>Coba Lagi</Button>}
          />
        ) : (
          <DataTable columns={columns}>
            {filteredRoles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-semibold text-ink">{role.name}</span>
                    <span className="text-[11px] font-mono text-ink-muted">{role.id}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {role.is_system ? (
                    <Badge tone="neutral">Bawaan Sistem</Badge>
                  ) : (
                    <Badge tone="success">Kustom</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="text-[13px] text-ink-soft">
                    {role.description || '-'}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-[13px] font-medium text-ink">
                    {role.user_count ?? 0} pengguna
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-[13px] font-medium text-ink">
                    {role.permission_count ?? 0} izin
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isMasterAdminRole(role.id)}
                      title={isMasterAdminRole(role.id) ? 'Role ini selalu memiliki akses penuh.' : undefined}
                      onClick={() => openEditPermissions(role)}
                    >
                      Atur Hak Akses
                    </Button>
                    {!role.is_system && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => { setDeletingRole(role); setFailure(null) }}
                      >
                        Hapus
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Card>

      {/* Modal Tambah Role Baru */}
      <Modal
        open={isCreating}
        onClose={() => { if (!busy) setIsCreating(false) }}
        title="Tambah Role Baru"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setIsCreating(false)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" onClick={submitCreateRole} disabled={busy}>
              {busy ? 'Menyimpan...' : 'Simpan Role'}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-[12px] text-ink-muted">
          Buat role kustom baru dan pilih hak akses modul yang diperbolehkan.
        </p>
        <div className="flex flex-col gap-4">
          {failure && (
            <div className="rounded-lg bg-danger-soft p-3 text-[13px] text-danger">
              {failure}
            </div>
          )}
          <div>
            <TextInput
              id="new-role-id"
              label="ID / Kode Role"
              value={newId}
              onChange={setNewId}
              placeholder="contoh: koordinator_lapangan"
            />
            <p className="mt-1 text-[11px] text-ink-muted">
              Huruf kecil, angka, garis bawah (3-32 karakter). Tidak dapat diubah setelah dibuat.
            </p>
          </div>
          <TextInput
            id="new-role-name"
            label="Nama Role"
            value={newName}
            onChange={setNewName}
            placeholder="contoh: Koordinator Lapangan"
          />
          <TextInput
            id="new-role-description"
            label="Deskripsi (Opsional)"
            value={newDescription}
            onChange={setNewDescription}
            placeholder="contoh: Petugas gerbang scan tiket seminar"
          />

          <div className="mt-2">
            <p className="mb-2 text-[13px] font-semibold text-ink">
              Centang Hak Akses Modul:
            </p>
            {loadingPerms ? (
              <SkeletonRows rows={3} />
            ) : (
              <div className="flex max-h-72 flex-col gap-4 overflow-y-auto rounded-lg border border-line p-3">
                {modules.map((m) => {
                  const mKeys = m.permissions.map((p) => p.key)
                  const isAllChecked = mKeys.every((k) => newPermissions.has(k))
                  return (
                    <div key={m.module} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between border-b border-line pb-1">
                        <span className="text-[12px] font-bold text-ink uppercase tracking-wider">
                          {m.module_name}
                        </span>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-primary hover:underline"
                          onClick={() => toggleModule(m, newPermissions, setNewPermissions)}
                        >
                          {isAllChecked ? 'Hapus Semua' : 'Pilih Semua'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {m.permissions.map((p) => {
                          const checked = newPermissions.has(p.key)
                          return (
                            <label
                              key={p.key}
                              className="flex items-start gap-2.5 rounded-md p-1.5 hover:bg-soft cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePerm(newPermissions, p.key, setNewPermissions)}
                                className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary"
                              />
                              <div className="flex flex-col">
                                <span className="text-[12px] font-medium text-ink">{p.name}</span>
                                {p.description && (
                                  <span className="text-[11px] text-ink-muted">{p.description}</span>
                                )}
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Modal Atur Hak Akses */}
      <Modal
        open={editingRole !== null}
        onClose={() => { if (!busy) setEditingRole(null) }}
        title={`Atur Hak Akses: ${editingRole?.name ?? ''}`}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditingRole(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="primary" onClick={saveRolePermissions} disabled={busy || loadingDetail}>
              {busy ? 'Menyimpan...' : 'Simpan Perubahan'}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-[12px] text-ink-muted">
          Ubah centang checklist perizinan modul untuk role ini.
        </p>
        <div className="flex flex-col gap-4">
          {failure && (
            <div className="rounded-lg bg-danger-soft p-3 text-[13px] text-danger">
              {failure}
            </div>
          )}
          {loadingDetail || loadingPerms ? (
            <SkeletonRows rows={4} />
          ) : (
            <div className="flex max-h-80 flex-col gap-4 overflow-y-auto rounded-lg border border-line p-3">
              {modules.map((m) => {
                const mKeys = m.permissions.map((p) => p.key)
                const isAllChecked = mKeys.every((k) => editPermissions.has(k))
                return (
                  <div key={m.module} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between border-b border-line pb-1">
                      <span className="text-[12px] font-bold text-ink uppercase tracking-wider">
                        {m.module_name}
                      </span>
                      <button
                        type="button"
                        className="text-[11px] font-medium text-primary hover:underline"
                        onClick={() => toggleModule(m, editPermissions, setEditPermissions)}
                      >
                        {isAllChecked ? 'Hapus Semua' : 'Pilih Semua'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {m.permissions.map((p) => {
                        const checked = editPermissions.has(p.key)
                        return (
                          <label
                            key={p.key}
                            className="flex items-start gap-2.5 rounded-md p-1.5 hover:bg-soft cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePerm(editPermissions, p.key, setEditPermissions)}
                              className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary"
                            />
                            <div className="flex flex-col">
                              <span className="text-[12px] font-medium text-ink">{p.name}</span>
                              {p.description && (
                                <span className="text-[11px] text-ink-muted">{p.description}</span>
                              )}
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Konfirmasi Hapus Role */}
      <Modal
        open={deletingRole !== null}
        onClose={() => { if (!busy) setDeletingRole(null) }}
        title="Konfirmasi Hapus Role"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDeletingRole(null)} disabled={busy}>
              Batal
            </Button>
            <Button variant="danger" onClick={confirmDeleteRole} disabled={busy}>
              {busy ? 'Menghapus...' : 'Hapus Role'}
            </Button>
          </div>
        }
      >
        <p className="mb-2 text-[13px] text-ink">
          {`Apakah Anda yakin ingin menghapus role "${deletingRole?.name}"? Tindakan ini tidak dapat dibatalkan.`}
        </p>
        <div className="flex flex-col gap-2">
          {failure && (
            <div className="rounded-lg bg-danger-soft p-3 text-[13px] text-danger">
              {failure}
            </div>
          )}
          {deletingRole && (deletingRole.user_count ?? 0) > 0 ? (
            <p className="text-[13px] text-danger font-medium">
              Perhatian: Masih ada {deletingRole.user_count} pengguna yang terikat pada role ini.
              Pindahkan pengguna ke role lain terlebih dahulu sebelum menghapus.
            </p>
          ) : (
            <p className="text-[13px] text-ink-muted">
              Role ini tidak memiliki pengguna terikat dan aman untuk dihapus.
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
