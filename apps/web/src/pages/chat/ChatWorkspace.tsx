import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  fetchChatMessages,
  fetchChatRecipients,
  fetchChatThreads,
  sendChatMessage,
  type ChatMessagesPage,
  type ChatThread,
} from '../../lib/chat'
import { hasPermission } from '../../lib/roles'
import { useAsyncData, useDebouncedValue } from '../../lib/useAsyncData'
import { useIsPhone } from '../../lib/field-app'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useSession } from '../../lib/useSession'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { SearchInput, Select, Textarea } from '../../ui/Field'
import { ErrorState, SkeletonRows } from '../../ui/Feedback'
import { useToast } from '../../ui/Toast'
import { cn } from '../../ui/cn'

const OPEN_KEY = 'dvflow.chat.open'
const WIDTH_KEY = 'dvflow.chat.width'
const MAX_BODY = 2000

function readOpen(): boolean {
  try { return window.localStorage.getItem(OPEN_KEY) === '1' } catch { return false }
}

function readWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) ? Math.min(480, Math.max(320, value)) : 380
  } catch { return 380 }
}

/** Jam WIB untuk hari ini, tanggal ringkas untuk hari lain. */
function chatTime(iso: string | null): string {
  if (iso === null || iso === '') return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(parsed)
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? ''
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
  const hour = value('hour') === '24' ? '00' : value('hour')
  return date === today ? `${hour}:${value('minute')}` : `${value('day')}/${value('month')}`
}

function initials(name: string): string {
  const trimmed = name.trim()
  return trimmed === '' ? '?' : trimmed.slice(0, 1).toUpperCase()
}

function roleTone(role: string): 'primary' | 'webinar' | 'neutral' {
  if (role === 'advertiser') return 'webinar'
  if (role === 'manajer' || role === 'admin') return 'primary'
  return 'neutral'
}

/**
 * Chat Internal (A79).
 *
 * Panel kanan yang hidup di luar `Outlet`, sehingga tidak remount saat halaman
 * berpindah. Ikon chat saja tanpa label teks; badge menunjukkan pesan belum
 * dibaca. Satu thread selalu 1:1 — kiriman ke "Semua [Role]" tampil sebagai
 * beberapa percakapan terpisah, satu per penerima.
 */
export function ChatWorkspace() {
  const { profile } = useSession()
  const toast = useToast()
  const allowed = hasPermission(profile, 'operasional.chat')
  const canSend = hasPermission(profile, 'action.send_chat')
  const docked = useMediaQuery('(min-width: 1440px)')
  const phone = useIsPhone()

  const [open, setOpen] = useState(readOpen)
  const [width, setWidth] = useState(readWidth)
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list')
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [threadData, setThreadData] = useState<ChatMessagesPage | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [composeRole, setComposeRole] = useState('')
  const [composeRecipient, setComposeRecipient] = useState('*')
  const [composeBody, setComposeBody] = useState('')
  const [composeError, setComposeError] = useState<string | null>(null)
  const resizing = useRef<{ x: number; width: number } | null>(null)
  const messagesEnd = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try { window.localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* penyimpanan diblokir */ }
  }, [open])
  useEffect(() => {
    try { window.localStorage.setItem(WIDTH_KEY, String(width)) } catch { /* penyimpanan diblokir */ }
  }, [width])
  useEffect(() => {
    if (view === 'thread') messagesEnd.current?.scrollIntoView?.({ block: 'end' })
  }, [view, threadData])

  const debouncedSearch = useDebouncedValue(search)
  const threadsState = useAsyncData(
    () => allowed ? fetchChatThreads() : Promise.resolve(null),
    [allowed, open, refresh],
  )
  const recipientsState = useAsyncData(
    () => allowed && open && view === 'compose' ? fetchChatRecipients() : Promise.resolve(null),
    [allowed, open, view],
  )

  const threads = threadsState.data?.threads ?? []
  const unread = threadsState.data?.unread_total ?? 0
  const filteredThreads = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase()
    if (term === '') return threads
    return threads.filter((thread) =>
      [thread.other_name, thread.other_account_name, thread.other_role_name, thread.last_message ?? '']
        .some((value) => value.toLowerCase().includes(term)),
    )
  }, [threads, debouncedSearch])

  const roleGroups = recipientsState.data?.roles ?? []
  const selectedGroup = roleGroups.find((group) => group.id === composeRole)
  const roleOptions = useMemo(
    () => roleGroups.map((group) => ({ value: group.id, label: `${group.name} (${group.users.length})` })),
    [roleGroups],
  )
  const recipientOptions = useMemo(() => {
    if (selectedGroup === undefined) return []
    return [
      { value: '*', label: `Semua ${selectedGroup.name}` },
      ...selectedGroup.users.map((user) => ({ value: user.id, label: user.display_name })),
    ]
  }, [selectedGroup])

  if (!allowed) return null

  function reload(): void {
    setRefresh((value) => value + 1)
  }

  function openPanel(): void {
    setOpen(true)
  }

  function minimize(): void {
    setOpen(false)
  }

  function startCompose(): void {
    setComposeRole('')
    setComposeRecipient('*')
    setComposeBody('')
    setComposeError(null)
    setView('compose')
    setOpen(true)
  }

  async function openThread(thread: ChatThread): Promise<void> {
    setView('thread')
    setThreadLoading(true)
    setThreadError(null)
    setReply('')
    try {
      setThreadData(await fetchChatMessages(thread.id))
      reload()
    } catch (failure) {
      setThreadError(failure instanceof Error ? failure.message : 'Percakapan gagal dimuat.')
    } finally {
      setThreadLoading(false)
    }
  }

  async function sendReply(): Promise<void> {
    if (sending || threadData === null) return
    const body = reply.trim()
    if (body === '') return
    setSending(true)
    try {
      await sendChatMessage({
        role_id: threadData.thread.other_role,
        recipient_id: threadData.thread.other_user_id,
        all: false,
        body,
      })
      setReply('')
      setThreadData(await fetchChatMessages(threadData.thread.id))
      reload()
    } catch (failure) {
      toast.show(failure instanceof Error ? failure.message : 'Pesan gagal dikirim.', 'danger')
    } finally {
      setSending(false)
    }
  }

  async function submitCompose(): Promise<void> {
    if (sending) return
    const body = composeBody.trim()
    if (composeRole === '') { setComposeError('Pilih role penerima.'); return }
    if (body === '') { setComposeError('Tulis pesan terlebih dahulu.'); return }
    setSending(true)
    setComposeError(null)
    try {
      const all = composeRecipient === '*'
      const result = await sendChatMessage({
        role_id: composeRole,
        recipient_id: all ? null : composeRecipient,
        all,
        body,
      })
      if (result.sent === 0) {
        toast.show('Tidak ada penerima aktif di role itu.', 'danger')
      } else {
        toast.show(result.sent === 1 ? 'Pesan terkirim.' : `Pesan terkirim ke ${result.sent} penerima.`, 'success')
      }
      setComposeBody('')
      setView('list')
      reload()
    } catch (failure) {
      setComposeError(failure instanceof Error ? failure.message : 'Pesan gagal dikirim.')
    } finally {
      setSending(false)
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!docked) return
    event.preventDefault()
    resizing.current = { x: event.clientX, width }
    const move = (moveEvent: PointerEvent) => {
      const start = resizing.current
      if (start === null) return
      setWidth(Math.min(480, Math.max(320, start.width - (moveEvent.clientX - start.x))))
    }
    const up = () => {
      resizing.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const panelClass = docked
    ? cn(
        'relative flex h-[calc(100vh-32px)] shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-card shadow-app sm:h-[calc(100vh-64px)]',
        open ? 'flex' : 'hidden',
      )
    : phone
      ? cn('fixed inset-0 z-[55] flex flex-col bg-card', open ? 'flex' : 'hidden')
      : cn('fixed bottom-3 right-3 top-3 z-[55] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-line bg-card shadow-app', open ? 'flex' : 'hidden')

  const threadList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <SearchInput id="chat-search" value={search} onChange={setSearch} placeholder="Cari nama atau pesan…" />
        {canSend ? <Button size="sm" variant="primary" onClick={startCompose} aria-label="Tulis pesan baru">+</Button> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threadsState.error !== null ? (
          <ErrorState message={threadsState.error} action={<Button onClick={threadsState.reload}>Coba lagi</Button>} />
        ) : threadsState.loading && threadsState.data === null ? <SkeletonRows rows={5} /> : filteredThreads.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-soft">
            {threads.length === 0 ? 'Belum ada percakapan. Mulai dengan tombol +.' : 'Tidak ada percakapan yang cocok.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filteredThreads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => void openThread(thread)}
                  className="flex w-full items-start gap-2.5 rounded-md p-2.5 text-left transition-colors hover:bg-soft"
                >
                  <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-[14px] font-semibold text-primary">
                    {initials(thread.other_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('min-w-0 flex-1 truncate text-[13px]', thread.unread > 0 ? 'font-bold text-ink' : 'font-semibold text-ink')}>{thread.other_name}</span>
                      <span className="shrink-0 text-[10px] text-ink-muted">{chatTime(thread.last_message_at)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <Badge tone={roleTone(thread.other_role)}>{thread.other_role_name}</Badge>
                      {thread.unread > 0 ? <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{thread.unread}</span> : null}
                    </span>
                    <span className={cn('mt-1 block truncate text-[12px]', thread.unread > 0 ? 'text-ink' : 'text-ink-soft')}>
                      {thread.last_sender_id === profile?.user_id ? 'Anda: ' : ''}
                      {thread.last_message ?? 'Belum ada pesan'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  const threadView = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => { setView('list'); setThreadData(null) }} aria-label="Kembali ke daftar chat">‹</Button>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-ink">{threadData?.thread.other_name ?? 'Percakapan'}</p>
          {threadData === null ? null : (
            <p className="truncate text-[11px] text-ink-soft">
              {threadData.thread.other_role_name}
              {threadData.thread.other_advertiser_name ? ` · ${threadData.thread.other_account_name}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-soft/40 p-3">
        {threadError !== null ? (
          <ErrorState message={threadError} action={<Button onClick={() => { setView('list'); setThreadData(null) }}>Kembali</Button>} />
        ) : threadLoading ? <SkeletonRows rows={4} /> : (
          <div className="flex flex-col gap-2">
            {(threadData?.messages ?? []).map((message) => (
              <div key={message.id} className={cn('flex flex-col', message.mine ? 'items-end' : 'items-start')}>
                <div className={cn(
                  'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[13px]',
                  message.mine ? 'bg-primary text-white' : 'border border-line bg-card text-ink',
                )}>
                  {message.body}
                </div>
                <span className="mt-0.5 px-1 text-[10px] text-ink-muted">{chatTime(message.created_at)}</span>
              </div>
            ))}
            <div ref={messagesEnd} />
          </div>
        )}
      </div>
      {canSend ? (
        <div className="border-t border-line p-2.5">
          <Textarea id="chat-reply" value={reply} onChange={setReply} rows={2} maxLength={MAX_BODY} placeholder="Tulis balasan…" disabled={sending || threadData === null} />
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="primary" loading={sending} disabled={reply.trim() === '' || threadData === null} onClick={() => void sendReply()}>
              Kirim
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )

  const composeView = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setView('list')} aria-label="Batal menulis pesan">‹</Button>
        <p className="text-[13px] font-semibold text-ink">Pesan Baru</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {recipientsState.error !== null ? (
          <ErrorState message={recipientsState.error} action={<Button onClick={recipientsState.reload}>Coba lagi</Button>} />
        ) : recipientsState.loading && recipientsState.data === null ? <SkeletonRows rows={3} /> : (
          <div className="flex flex-col gap-3">
            <Select
              id="chat-compose-role"
              label="Role penerima"
              value={composeRole}
              placeholder="Pilih role"
              options={roleOptions}
              onChange={(value) => { setComposeRole(value); setComposeRecipient('*') }}
              disabled={sending}
            />
            <Select
              id="chat-compose-recipient"
              label="Penerima"
              value={composeRecipient}
              options={recipientOptions}
              onChange={setComposeRecipient}
              disabled={sending || selectedGroup === undefined}
            />
            <p className="-mt-2 text-[11px] text-ink-soft">
              Pilih “Semua” untuk mengirim ke setiap anggota role. Tiap penerima mendapat percakapan sendiri.
            </p>
            <Textarea
              id="chat-compose-body"
              label="Pesan"
              value={composeBody}
              onChange={setComposeBody}
              rows={5}
              maxLength={MAX_BODY}
              placeholder="Tulis pesan…"
              disabled={sending}
            />
            {composeError === null ? null : <p className="text-[12px] text-danger">{composeError}</p>}
            <div className="flex gap-2">
              <Button variant="primary" loading={sending} onClick={() => void submitCompose()} disabled={composeRole === '' || composeBody.trim() === ''}>
                Kirim
              </Button>
              <Button variant="secondary" onClick={() => setView('list')} disabled={sending}>Batal</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {!docked && open && !phone ? (
        <div className="fixed inset-0 z-[54] bg-ink/30" role="presentation" onClick={minimize} />
      ) : null}
      <aside
        className={panelClass}
        style={docked ? { width, display: open ? undefined : 'none' } : { display: open ? undefined : 'none' }}
        aria-label="Chat Internal"
      >
        {docked ? <div role="separator" aria-orientation="vertical" onPointerDown={startResize} className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30" /> : null}
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
          </svg>
          {unread > 0 ? <span className="rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span> : null}
          <span className="sr-only">Chat Internal</span>
          <button type="button" onClick={minimize} aria-label="Perkecil Chat" className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-soft hover:text-ink">»</button>
        </header>
        {view === 'list' ? threadList : view === 'thread' ? threadView : composeView}
      </aside>
      {!open ? (
        <button
          type="button"
          onClick={openPanel}
          aria-label="Buka Chat"
          aria-expanded={false}
          title="Chat"
          className="fixed bottom-4 right-4 z-[56] grid h-12 w-12 place-items-center rounded-full bg-primary text-white shadow-app transition-colors hover:bg-primary-hover"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" />
          </svg>
          {unread > 0 ? <span className="absolute -right-1 -top-1 rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span> : null}
        </button>
      ) : null}
    </>
  )
}
