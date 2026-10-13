import { useState } from 'react'
import type { AppRole } from '@dvflow/shared'
import { authorizedRequest } from '../../lib/session'
import { ROLE_LABELS } from '../../lib/roles'
import { useAsyncData } from '../../lib/useAsyncData'
import { PageHeader } from '../../layout/PageHeader'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { TextInput, Select, SearchInput } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { DataTable, TableRow, TableCell } from '../../ui/Table'
import { useToast } from '../../ui/Toast'

type Member = { id: string; username: string; display_name: string; role: AppRole; active: boolean }
const columns = [{ key: 'username', header: 'Username' }, { key: 'display_name', header: 'Nama' },
  { key: 'role', header: 'Role' }, { key: 'active', header: 'Status' }]

export function TeamPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AppRole>('staff')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const toast = useToast()
  const { data, loading, error, reload } = useAsyncData(() => authorizedRequest<{ users: Member[] }>('/api/internal/users'), [])
  const term = search.trim().toLowerCase()
  const rows = (data?.users ?? []).filter(row => [row.username, row.display_name, ROLE_LABELS[row.role]].some(value => value.toLowerCase().includes(term)))
  async function submit() {
    if (busy) return
    if (!username.trim() || /\s/.test(username.trim()) || password.length < 8) {
      setFailure('Username wajib diisi tanpa spasi. Password minimal 8 karakter.')
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await authorizedRequest('/api/internal/users', { method: 'POST', body: {
        username: username.trim(), display_name: username.trim(), initial_password: password, role,
      } })
      setUsername(''); setPassword(''); setRole('staff'); reload()
      toast.show('Member berhasil ditambahkan.', 'success')
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Member gagal ditambahkan.') }
    finally { setBusy(false) }
  }
  return <>
    <PageHeader title="Add Team" description="Tambahkan akun dan lihat daftar member. Hanya Admin Master yang dapat mengakses menu ini." />
    <Card>
      <form className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={e => { e.preventDefault(); void submit() }}>
        <TextInput id="team-username" label="Username" value={username} onChange={setUsername} disabled={busy} autoComplete="off" />
        <TextInput id="team-password" label="Password awal" type="password" value={password} onChange={setPassword} disabled={busy} autoComplete="new-password" placeholder="Minimal 8 karakter" />
        <Select id="team-role" label="Role" value={role} onChange={value => setRole(value as AppRole)} disabled={busy}
          options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
        <div className="flex items-end"><Button type="submit" variant="primary" loading={busy}>Tambah member</Button></div>
      </form>
      {failure ? <p role="alert" className="mt-3 text-danger">{failure}</p> : null}
    </Card>
    <div className="mt-4"><Card>
      <SearchInput id="team-search" value={search} onChange={setSearch} placeholder="Cari username, nama, atau role" />
      {error ? <ErrorState message={error} action={<Button onClick={reload}>Coba lagi</Button>} /> : null}
      {loading && !data ? <SkeletonRows rows={3} /> : <DataTable columns={columns}
        exportConfig={{ filename: 'team', disabled: loading || error !== null, loadRows: () => rows.map(row => ({ username: row.username, display_name: row.display_name, role: ROLE_LABELS[row.role], active: row.active ? 'Aktif' : 'Nonaktif' })) }}>
        {rows.map(row => <TableRow key={row.id}><TableCell>{row.username}</TableCell><TableCell>{row.display_name}</TableCell><TableCell>{ROLE_LABELS[row.role]}</TableCell><TableCell>{row.active ? 'Aktif' : 'Nonaktif'}</TableCell></TableRow>)}
      </DataTable>}
      {!loading && !error && rows.length === 0 ? <p className="py-4 text-ink-soft">Tidak ada member yang cocok.</p> : null}
    </Card></div>
  </>
}
