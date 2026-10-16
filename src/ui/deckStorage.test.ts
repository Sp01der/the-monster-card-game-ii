import { describe, expect, it } from 'vitest'
import { createDeckStore, memoryStorage } from './deckStorage'

describe('deck storage', () => {
  it('saves, lists, overwrites, and deletes', () => {
    const store = createDeckStore(memoryStorage())
    const saved = store.save({
      name: 'My fire',
      counts: { fire_sprite: 2, coffee: 1 },
      topMonsterId: 'fire_sprite',
    })
    expect(store.list().map((deck) => deck.id)).toEqual([saved.id])

    const again = store.save({
      id: saved.id,
      name: 'My fire 2',
      counts: { fire_sprite: 3 },
      topMonsterId: 'fire_sprite',
    })
    expect(again.id).toBe(saved.id)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0].name).toBe('My fire 2')
    expect(store.list()[0].counts).toEqual({ fire_sprite: 3 })

    store.remove(saved.id)
    expect(store.list()).toEqual([])
  })

  it('drops unknown card ids and invalid counts', () => {
    const storage = memoryStorage()
    const store = createDeckStore(storage)
    const saved = store.save({
      name: '   ',
      counts: { blob: 2, not_a_card: 4, coffee: 0, sword: 1, ice_core: 1.5 },
      topMonsterId: 'sword',
    })
    expect(saved.name).toBe('Untitled deck')
    expect(saved.counts).toEqual({ blob: 2, sword: 1 })
    expect(saved.topMonsterId).toBe('blob')

    const raw = JSON.parse(storage.getItem('mcg-ii.saved-decks') ?? '[]') as {
      counts: Record<string, number>
    }[]
    expect(raw[0].counts).toEqual({ blob: 2, sword: 1 })
  })

  it('remembers last-used decks and forgets missing ones', () => {
    const store = createDeckStore(memoryStorage())
    store.setLastUsed(0, 'ember')
    store.setLastUsed(1, 'missing')
    expect(store.getLastUsed(0)).toBe('ember')
    expect(store.getLastUsed(1)).toBeNull()

    const saved = store.save({
      name: 'A',
      counts: { blob: 1 },
      topMonsterId: 'blob',
    })
    store.setLastUsed(1, saved.id)
    expect(store.getLastUsed(1)).toBe(saved.id)

    store.remove(saved.id)
    expect(store.getLastUsed(1)).toBeNull()
    expect(store.getLastUsed(0)).toBe('ember')
  })

  it('ignores unknown ids already stored', () => {
    const storage = memoryStorage()
    storage.setItem(
      'mcg-ii.saved-decks',
      JSON.stringify([
        {
          id: 'old',
          name: 'Old',
          counts: { blob: 2, retired_card: 3, coffee: 0 },
          topMonsterId: 'retired_card',
          updatedAt: 1,
        },
      ]),
    )
    const store = createDeckStore(storage)
    expect(store.list()).toEqual([
      {
        id: 'old',
        name: 'Old',
        counts: { blob: 2 },
        topMonsterId: 'blob',
        updatedAt: 1,
      },
    ])
  })
})
