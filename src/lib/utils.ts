import type { Conversation, Message, Role } from '../types'

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export function createMessage(role: Role, content = '', extra: Partial<Message> = {}): Message {
  return { id: uid(), role, content, createdAt: Date.now(), ...extra }
}

export function createConversation(model: string): Conversation {
  const now = Date.now()
  return { id: uid(), title: 'گفتگوی جدید', messages: [], model, createdAt: now, updatedAt: now }
}

/** Derives a short, readable title from the first user message. */
export function deriveTitle(text: string): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`~\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return 'گفتگوی جدید'
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']

/** Converts Latin digits to Persian ones for display-only text. */
export function toFa(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)])
}

export function formatNumber(n: number): string {
  return toFa(n.toLocaleString('en-US'))
}

/** Persian relative time, e.g. «۳ دقیقه پیش». */
export function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'همین حالا'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${toFa(mins)} دقیقه پیش`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${toFa(hours)} ساعت پیش`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${toFa(days)} روز پیش`
  return new Date(ts).toLocaleDateString('fa-IR')
}

export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })
}

/** Buckets conversations into the sidebar's date groups, newest first. */
export function groupByDate(list: Conversation[]): Array<{ label: string; items: Conversation[] }> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000

  const buckets: Array<{ label: string; items: Conversation[] }> = [
    { label: 'امروز', items: [] },
    { label: 'دیروز', items: [] },
    { label: '۷ روز گذشته', items: [] },
    { label: '۳۰ روز گذشته', items: [] },
    { label: 'قدیمی‌تر', items: [] },
  ]

  for (const c of list) {
    const t = c.updatedAt
    if (t >= startOfToday) buckets[0].items.push(c)
    else if (t >= startOfToday - day) buckets[1].items.push(c)
    else if (t >= startOfToday - 7 * day) buckets[2].items.push(c)
    else if (t >= startOfToday - 30 * day) buckets[3].items.push(c)
    else buckets[4].items.push(c)
  }

  return buckets.filter((b) => b.items.length > 0)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Estimates tokens well enough for a live composer counter (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4)
}
