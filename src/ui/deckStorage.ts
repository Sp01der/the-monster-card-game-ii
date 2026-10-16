import { CATALOG, getCard } from '../game/catalog'
import { STARTERS } from '../game/starters'

export type StoredDeck = {
  id: string
  name: string
  counts: Record<string, number>
  topMonsterId: string | null
  updatedAt: number
}

export type DeckStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const DECKS_KEY = 'mcg-ii.saved-decks'
const LAST_KEY = 'mcg-ii.last-deck'

export function memoryStorage(): DeckStorage {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

export function browserStorage(): DeckStorage {
  try {
    const probe = '__mcg_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch {
    return memoryStorage()
  }
}

export function sanitizeCounts(counts: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {}
  for (const [id, n] of Object.entries(counts)) {
    if (!Number.isInteger(n) || n <= 0) continue
    if (!CATALOG[id]) continue
    next[id] = n
  }
  return next
}

export function sanitizeTop(
  counts: Record<string, number>,
  topMonsterId: string | null,
): string | null {
  if (topMonsterId && (counts[topMonsterId] ?? 0) > 0 && getCard(topMonsterId).kind === 'monster') {
    return topMonsterId
  }
  return Object.keys(counts).find((id) => getCard(id).kind === 'monster') ?? null
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeDeck(value: unknown): StoredDeck | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Untitled deck'
  const countsInput: Record<string, number> = {}
  if (raw.counts && typeof raw.counts === 'object') {
    for (const [id, n] of Object.entries(raw.counts as Record<string, unknown>)) {
      if (typeof n === 'number') countsInput[id] = n
    }
  }
  const counts = sanitizeCounts(countsInput)
  const top = typeof raw.topMonsterId === 'string' ? raw.topMonsterId : null
  return {
    id: raw.id,
    name,
    counts,
    topMonsterId: sanitizeTop(counts, top),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}

export function createDeckStore(storage: DeckStorage) {
  function read(): StoredDeck[] {
    const raw = storage.getItem(DECKS_KEY)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((entry) => {
        const deck = sanitizeDeck(entry)
        return deck ? [deck] : []
      })
    } catch {
      return []
    }
  }

  function write(decks: StoredDeck[]) {
    storage.setItem(DECKS_KEY, JSON.stringify(decks))
  }

  function readLast(): [string | null, string | null] {
    const raw = storage.getItem(LAST_KEY)
    if (!raw) return [null, null]
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return [null, null]
      return [asId(parsed[0]), asId(parsed[1])]
    } catch {
      return [null, null]
    }
  }

  function writeLast(last: [string | null, string | null]) {
    storage.setItem(LAST_KEY, JSON.stringify(last))
  }

  function knownDeckId(id: string): boolean {
    if (STARTERS.some((starter) => starter.id === id)) return true
    return read().some((deck) => deck.id === id)
  }

  return {
    list(): StoredDeck[] {
      return read().sort((a, b) => b.updatedAt - a.updatedAt)
    },

    save(input: {
      id?: string
      name: string
      counts: Record<string, number>
      topMonsterId: string | null
    }): StoredDeck {
      const decks = read()
      const counts = sanitizeCounts(input.counts)
      const deck: StoredDeck = {
        id: input.id ?? newId(),
        name: input.name.trim() || 'Untitled deck',
        counts,
        topMonsterId: sanitizeTop(counts, input.topMonsterId),
        updatedAt: Date.now(),
      }
      const next = decks.some((existing) => existing.id === deck.id)
        ? decks.map((existing) => (existing.id === deck.id ? deck : existing))
        : [...decks, deck]
      write(next)
      return deck
    },

    remove(id: string) {
      write(read().filter((deck) => deck.id !== id))
      const last = readLast()
      if (last[0] === id) last[0] = null
      if (last[1] === id) last[1] = null
      writeLast(last)
    },

    getLastUsed(player: 0 | 1): string | null {
      const id = readLast()[player]
      if (!id || !knownDeckId(id)) return null
      return id
    },

    setLastUsed(player: 0 | 1, id: string | null) {
      const last = readLast()
      last[player] = id
      writeLast(last)
    },
  }
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export type DeckStore = ReturnType<typeof createDeckStore>
