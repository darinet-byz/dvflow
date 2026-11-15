import { authorizedRequest } from './session'

/**
 * Chat Internal (A79).
 *
 * Pengirim memilih role, lalu "Semua [Role]" atau satu nama. Kiriman ke
 * "Semua" di-fan-out server menjadi satu thread per penerima, jadi daftar
 * percakapan selalu berisi orang, bukan nama role.
 */
export type ChatRecipientUser = {
  id: string
  /** Nama yang ditampilkan: nama pengiklan untuk akun Advertiser. */
  display_name: string
  account_name: string
  is_advertiser: boolean
  advertiser_name: string | null
}

export type ChatRoleGroup = {
  id: string
  name: string
  users: ChatRecipientUser[]
}

export type ChatRecipients = {
  roles: ChatRoleGroup[]
}

export type ChatThread = {
  id: string
  other_user_id: string
  other_name: string
  other_account_name: string
  other_role: string
  other_role_name: string
  other_advertiser_name: string | null
  last_message: string | null
  last_sender_id: string | null
  last_message_at: string
  unread: number
}

export type ChatThreadsPage = {
  threads: ChatThread[]
  unread_total: number
}

export type ChatMessage = {
  id: string
  sender_id: string
  body: string
  created_at: string
  mine: boolean
}

export type ChatThreadInfo = {
  id: string
  other_user_id: string
  other_name: string
  other_account_name: string
  other_role: string
  other_role_name: string
  other_advertiser_name: string | null
}

export type ChatMessagesPage = {
  thread: ChatThreadInfo
  messages: ChatMessage[]
}

export type SendChatMessageInput = {
  role_id: string
  recipient_id: string | null
  all: boolean
  body: string
}

export async function fetchChatRecipients(): Promise<ChatRecipients> {
  return authorizedRequest<ChatRecipients>('/api/chat/recipients')
}

export async function fetchChatThreads(): Promise<ChatThreadsPage> {
  return authorizedRequest<ChatThreadsPage>('/api/chat/threads')
}

export async function fetchChatMessages(threadId: string): Promise<ChatMessagesPage> {
  return authorizedRequest<ChatMessagesPage>(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`)
}

export async function sendChatMessage(input: SendChatMessageInput): Promise<{ sent: number; thread_ids: string[] }> {
  return authorizedRequest<{ sent: number; thread_ids: string[] }>('/api/chat/messages', {
    method: 'POST',
    body: input,
  })
}
