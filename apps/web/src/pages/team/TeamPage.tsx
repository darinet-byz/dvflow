import { useState } from 'react'
import type { AppRole } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { ROLE_LABELS } from '../../lib/roles'
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
}

const columns = [
  { key: 'username', header: 'Username' },
  { key: 'display_name', header: 'Nama' },
  { key: 'role', header: 'Role' },
  { key: 'active', header: 'Status' },
  { key: 'actions', header: 'Aksi' },
]

export function TeamPage() {
  const session = useSession()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('staff')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const [editing, setEditing] = useState<Member | null>(null)
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editRole, setEditRole] = useState<AppRole>('staff')
  const [editActive, setEditActive] = useState(true)
  const [editPassword, setEditPassword] = useState('')

  const [deleting, setDeleting] = useState<Member | null>(null)

  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(
    () => authorizedRequest<{ users: Member[] }>('/api/internal/users'),
    [],
  )

  const term = search.trim().toLowerCase()
  const rows = (data?.users ?? []).filter((row) =>
    [row.username, row.display_name, ROLE_LABELS[row.role]].some((value) =>
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
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/internal/users', {
        method: 'POST',
        body: {
          username: username.trim(),
          display_name: username.trim(),
          initial_password: password,
          role,
        },
      })
      setUsername('')
      setPassword('')
      setRole('staff')
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
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        display_name: editDisplayName.trim(),
        role: editRole,
        active: editActive,
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
        description="Tambahkan akun, ubah akses, atau hapus member. Hanya Admin Master yang dapat mengakses menu ini."
      />
      <Card>
        <form
          className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
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
                    role: ROLE_LABELS[row.role],
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
                    <TableCell>{ROLE_LABELS[row.role]}</TableCell>
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
