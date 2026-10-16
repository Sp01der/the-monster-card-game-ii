import { describe, expect, it } from 'vitest'
import { CATALOG } from './catalog'
import { sampleDeck } from './setup'
import { cardIdsFromCounts, STARTERS } from './starters'

describe('starter decks', () => {
  it('are playable themed decks', () => {
    expect(STARTERS.map((starter) => starter.id)).toEqual(['ember', 'frost', 'tide', 'gloom'])

    for (const starter of STARTERS) {
      const cards = cardIdsFromCounts(starter.counts)
      expect(cards.length).toBeGreaterThanOrEqual(20)
      expect(cards.length).toBeLessThanOrEqual(24)
      for (const id of Object.keys(starter.counts)) {
        expect(CATALOG[id], id).toBeTruthy()
        expect(starter.counts[id]).toBeGreaterThan(0)
      }
      expect(cards.some((id) => CATALOG[id].kind === 'monster')).toBe(true)
      expect(CATALOG[starter.topMonsterId].kind).toBe('monster')
      expect(starter.counts[starter.topMonsterId]).toBeGreaterThan(0)
    }
  })

  it('sampleDeck is the Ember starter', () => {
    const ember = STARTERS.find((starter) => starter.id === 'ember')
    expect(ember).toBeTruthy()
    const setup = sampleDeck('Ada')
    expect(setup.name).toBe('Ada')
    expect(setup.cardIds).toEqual(cardIdsFromCounts(ember!.counts))
    expect(setup.cardIds[setup.topMonsterIndex]).toBe('fire_sprite')
  })
})
