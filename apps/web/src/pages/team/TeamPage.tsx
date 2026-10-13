import { useState } from 'react'
import type { AppRole } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { ROLE_LABELS } from '../../lib/roles'
import { fetchConfigLists } from '../../lib/queries'
import { useAsyncData } from '../../lib/useAsyncData'
import { useSession } from '../../lib/useSession'
import { PageHeader } from '../../layout/PageHeader'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Select, SearchInput, TextInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { Modal } from '../../ui/Overlay'
import { DataTable, TableCell, TableRow } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

type Member = {
  id: string
  username: string
  display_name: string
  role: AppRole
  active: boolean
  has_all_product_access?: boolean
  allowed_product_codes?: string[]
}

const columns = [
  { key: 'username', header: 'Username' },
  { key: 'display_name', header: 'Nama' },
  { key: 'role', header: 'Role' },
  { key: 'product_access', header: 'Akses Produk' },
  { key: 'active', header: 'Status' },
  { key: 'actions', header: 'Aksi' },
]

export function TeamPage() {
  const session = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('staff')
  const [hasAllProducts, setHasAllProducts] = useState(true)
  const [selectedProductCodes, setSelectedProductCodes] = useState<string[]>([])

  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const [editing, setEditing] = useState<Member | null>(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editRole, setEditRole] = useState<AppRole>('staff')
  const [editActive, setEditActive] = useState(true)
  const [editPassword, setEditPassword] = useState('')
  const [editHasAllProducts, setEditHasAllProducts] = useState(true)
  const [editSelectedProductCodes, setEditSelectedProductCodes] = useState<string[]>([])

  const [deleting, setDeleting] = useState<Member | null>(null)

  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<{ users: Member[] }>('/api/internal/users'),
    [],
  )

  const { data: configLists } = useAsyncData(fetchConfigLists, [])
  const productOptions = configLists?.products ?? []

  const term = search.trim().toLowerCase()
  const rows = (data?.users ?? []).filter((row) =>
    [row.username, row.display_name, ROLE_LABELS[row.role] ?? row.role].some((value) =>
      value.toLowerCase().includes(term),
    ),
  )

  const currentUserId = session.profile && 'user_id' in session.profile ? session.profile.user_id : null
  const currentUsername = session.profile && 'username' in session.profile ? session.profile.username : null

  function isSelf(row: Member): boolean {
    if (currentUserId && row.id === currentUserId) return true
    if (currentUsername && row.username.toLowerCase() === currentUsername.toLowerCase()) return true
    return false
  }

  async function submit() {
    if (busy) return
    if (!username.trim() || /\s/.test(username.trim()) || password.length < 8) {
      setFailure('Username wajib diisi tanpa spasi. Password minimal 8 karakter.')
      return
    }
    if (!hasAllProducts && selectedProductCodes.length === 0) {
      setFailure('Pilih minimal satu produk jika akses produk dibatasi.')
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const body: Record<string, unknown> = {
        username: username.trim(),
        display_name: username.trim(),
        initial_password: password,
        role,
      }
      if (!hasAllProducts) {
        body.has_all_product_access = false
        body.product_codes = selectedProductCodes
      }
      await authorizedRequest('/api/internal/users', {
        method: 'POST',
        body,
      })
      setUsername('')
      setPassword('')
      setRole('staff')
      setHasAllProducts(true)
      setSelectedProductCodes([])
      reload()
      toast.show('Member berhasil ditambahkan.', 'success')
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Member gagal ditambahkan.')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(row: Member) {
    setEditing(row)
    setEditDisplayName(row.display_name)
    setEditRole(row.role)
    setEditActive(row.active)
    setEditPassword('')
    setEditHasAllProducts(row.has_all_product_access !== false)
    setEditSelectedProductCodes(row.allowed_product_codes ?? [])
  }

  async function saveEdit() {
    if (!editing || busy) return
    if (!editDisplayName.trim()) {
      toast.show('Nama tampilan wajib diisi.', 'danger')
      return
    }
    if (editPassword !== '' && editPassword.length < 8) {
      toast.show('Password baru minimal 8 karakter.', 'danger')
      return
    }
    if (!editHasAllProducts && editSelectedProductCodes.length === 0) {
      toast.show('Pilih minimal satu produk jika akses produk dibatasi.', 'danger')
      return
    }
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        display_name: editDisplayName.trim(),
        role: editRole,
        active: editActive,
        has_all_product_access: editHasAllProducts,
        product_codes: editHasAllProducts ? [] : editSelectedProductCodes,
      }
      if (editPassword !== '') body['new_password'] = editPassword
      await authorizedRequest(`/api/internal/users/${editing.id}`, {
        method: 'PATCH',
        body,
      })
      setEditing(null)
      reload()
      toast.show('Member berhasil diperbarui.', 'success')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Member gagal diperbarui.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(row: Member) {
    if (busy) return
    setBusy(true)
    try {
      await authorizedRequest(`/api/internal/users/${row.id}`, { method: 'DELETE' })
      setDeleting(null)
      reload()
      toast.show('Member berhasil dihapus.', 'success')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Member gagal dihapus.', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))

  return (
    <>
      <PageHeader
        title="Add Team"
        description="Tambahkan akun, ubah akses, atau hapus member. Hanya Master Admin yang dapat mengakses menu ini."
      />
      <Card>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextInput
              id="team-username"
              label="Username"
              value={username}
              onChange={setUsername}
              disabled={busy}
              autoComplete="off"
            />
            <TextInput
              id="team-password"
              label="Password awal"
              type="password"
              value={password}
              onChange={setPassword}
              disabled={busy}
              autoComplete="new-password"
              placeholder="Minimal 8 karakter"
            />
            <Select
              id="team-role"
              label="Role"
              value={role}
              onChange={(value) => setRole(value as AppRole)}
              disabled={busy}
              options={roleOptions}
            />
            <div className="flex items-end">
              <Button type="submit" variant="primary" loading={busy}>
                Tambah member
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-page p-3 flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-ink">Akses Produk:</span>
            <div className="flex flex-wrap gap-4 text-[13px]">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-ink">
                <input
                  type="radio"
                  name="team-create-scope"
                  checked={hasAllProducts}
                  onChange={() => setHasAllProducts(true)}
                  className="text-primary focus:ring-primary"
                />
                Semua Produk (All Products)
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-ink">
                <input
                  type="radio"
                  name="team-create-scope"
                  checked={!hasAllProducts}
                  onChange={() => setHasAllProducts(false)}
                  className="text-primary focus:ring-primary"
                />
                Produk Tertentu (Specific Products)
              </label>
            </div>

            {!hasAllProducts && (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 max-h-48 overflow-y-auto p-1">
                {productOptions.length === 0 ? (
                  <p className="text-[12px] text-ink-muted">Memuat daftar produk...</p>
                ) : (
                  productOptions.map((p) => {
                    const checked = selectedProductCodes.includes(p.value)
                    return (
                      <label key={p.value} className="flex items-center gap-2 rounded p-1 hover:bg-soft cursor-pointer text-[12px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedProductCodes([...selectedProductCodes, p.value])
                            else setSelectedProductCodes(selectedProductCodes.filter((c) => c !== p.value))
                          }}
                          className="h-3.5 w-3.5 rounded border-line text-primary focus:ring-primary"
                        />
                        <span className="truncate text-ink">{p.label}</span>
                      </label>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </form>
        {failure ? (
          <p role="alert" className="mt-3 text-danger">
            {failure}
          </p>
        ) : null}
      </Card>

      <div className="mt-4">
        <Card>
          <SearchInput
            id="team-search"
            value={search}
            onChange={setSearch}
            placeholder="Cari username, nama, atau role"
          />
          {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : (
            <DataTable
              columns={columns}
              exportConfig={{
                filename: 'team',
                disabled: loading || error !== null,
                columns: columns.filter((c) => c.key !== 'actions'),
                loadRows: () =>
                  rows.map((row) => ({
                    username: row.username,
                    display_name: row.display_name,
                    role: ROLE_LABELS[row.role] ?? row.role,
                    product_access: row.has_all_product_access !== false ? 'Semua Produk' : (row.allowed_product_codes ?? []).join(', '),
                    active: row.active ? 'Aktif' : 'Nonaktif',
                  })),
              }}
            >
              {rows.map((row) => {
                const self = isSelf(row)
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.username}</TableCell>
                    <TableCell>{row.display_name}</TableCell>
                    <TableCell>{ROLE_LABELS[row.role] ?? row.role}</TableCell>
                    <TableCell>
                      {row.has_all_product_access !== false ? (
                        <Badge tone="neutral">Semua Produk</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {row.allowed_product_codes && row.allowed_product_codes.length > 0 ? (
                            row.allowed_product_codes.map((code) => (
                              <Badge key={code} tone="primary">
                                {code}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[12px] text-ink-muted">-</span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={row.active ? 'success' : 'danger'}>
                        {row.active ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" disabled={busy} onClick={() => startEdit(row)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy || self}
                          title={self ? 'Tidak dapat menghapus akun sendiri' : undefined}
                          onClick={() => setDeleting(row)}
                        >
                          Hapus
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </DataTable>
          )}
          {!loading && !error && rows.length === 0 ? (
            <p className="py-4 text-ink-soft">Tidak ada member yang cocok.</p>
          ) : null}
        </Card>
      </div>

      {/* Modal Edit Member */}
      <Modal
        open={editing !== null}
        title={editing ? `Edit Member: ${editing.username}` : 'Edit Member'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Batal</Button>
            <Button variant="primary" loading={busy} onClick={() => void saveEdit()}>
              Simpan
            </Button>
          </>
        }
      >
        {editing === null ? null : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void saveEdit()
            }}
          >
            <TextInput
              id="team-edit-display-name"
              label="Nama tampilan"
              value={editDisplayName}
              onChange={setEditDisplayName}
              disabled={busy}
            />
            <Select
              id="team-edit-role"
              label="Role"
              value={editRole}
              options={roleOptions}
              disabled={busy || isSelf(editing)}
              onChange={(val) => setEditRole(val as AppRole)}
            />
            <TextInput
              id="team-edit-password"
              label="Reset password baru (opsional)"
              type="password"
              value={editPassword}
              onChange={setEditPassword}
              disabled={busy}
              autoComplete="new-password"
              placeholder="Kosongkan jika tidak ingin mengubah password"
            />
            <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <input
                type="checkbox"
                checked={editActive}
                disabled={busy || isSelf(editing)}
                onChange={(e) => setEditActive(e.target.checked)}
              />
              Akun aktif (dapat login)
            </label>

            <div className="rounded-lg border border-line bg-page p-3 flex flex-col gap-2">
              <span className="text-[12px] font-semibold text-ink">Akses Produk:</span>
              <div className="flex flex-wrap gap-4 text-[13px]">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-ink">
                  <input
                    type="radio"
                    name="team-edit-scope"
                    checked={editHasAllProducts}
                    onChange={() => setEditHasAllProducts(true)}
                    className="text-primary focus:ring-primary"
                  />
                  Semua Produk
                </label>
                <label className="flex items-center gap-2 cursor-pointer font-medium text-ink">
                  <input
                    type="radio"
                    name="team-edit-scope"
                    checked={!editHasAllProducts}
                    onChange={() => setEditHasAllProducts(false)}
                    className="text-primary focus:ring-primary"
                  />
                  Produk Tertentu
                </label>
              </div>

              {!editHasAllProducts && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 max-h-40 overflow-y-auto p-1">
                  {productOptions.map((p) => {
                    const checked = editSelectedProductCodes.includes(p.value)
                    return (
                      <label key={p.value} className="flex items-center gap-2 rounded p-1 hover:bg-soft cursor-pointer text-[12px]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) setEditSelectedProductCodes([...editSelectedProductCodes, p.value])
                            else setEditSelectedProductCodes(editSelectedProductCodes.filter((c) => c !== p.value))
                          }}
                          className="h-3.5 w-3.5 rounded border-line text-primary focus:ring-primary"
                        />
                        <span className="truncate text-ink">{p.label}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={deleting !== null}
        title="Hapus Member"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Batal</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => deleting !== null && void confirmDelete(deleting)}
            >
              Hapus Member
            </Button>
          </>
        }
      >
        <p>
          Apakah Anda yakin ingin menghapus member{' '}
          <strong>{deleting ? `${deleting.display_name} (${deleting.username})` : ''}</strong> secara permanen? Seluruh
          sesi aktif pengguna ini juga akan dihentikan.
        </p>
      </Modal>
    </>
  )
}
