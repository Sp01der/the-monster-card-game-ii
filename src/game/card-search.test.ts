import { describe, expect, it } from 'vitest'
import { cardMatchesSearchType } from './catalog'

describe('card type search', () => {
  it('matches damage a card deals, not its weakness', () => {
    expect(cardMatchesSearchType('stormling', 'electric')).toBe(true)
    expect(cardMatchesSearchType('stormling', 'water')).toBe(true)
    expect(cardMatchesSearchType('stormling', 'wind')).toBe(true)
    expect(cardMatchesSearchType('stormling_commander', 'electric')).toBe(true)
    expect(cardMatchesSearchType('stormling_commander', 'water')).toBe(true)
    expect(cardMatchesSearchType('gale_serpent', 'wind')).toBe(false)
    expect(cardMatchesSearchType('gale_serpent', 'poison')).toBe(true)
    expect(cardMatchesSearchType('unending_bannerman', 'electric')).toBe(false)
    expect(cardMatchesSearchType('veyan_bard', 'sound')).toBe(true)
    expect(cardMatchesSearchType('storm_bolts', 'electric')).toBe(true)
    expect(cardMatchesSearchType('daybreak', 'light')).toBe(true)
    expect(cardMatchesSearchType('whirlpool', 'water')).toBe(true)
  })

  it('matches families', () => {
    expect(cardMatchesSearchType('stormling', 'stormling')).toBe(true)
    expect(cardMatchesSearchType('woody', 'plant')).toBe(true)
    expect(cardMatchesSearchType('woody', 'woody')).toBe(true)
    expect(cardMatchesSearchType('stormling', 'plant')).toBe(false)
    expect(cardMatchesSearchType('blob', 'blob')).toBe(true)
    expect(cardMatchesSearchType('green_fairy', 'plant')).toBe(false)
  })
})
