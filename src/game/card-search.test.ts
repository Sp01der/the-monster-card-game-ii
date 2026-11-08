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
    expect(cardMatchesSearchType('veyan_bard', 'sonic')).toBe(true)
    expect(cardMatchesSearchType('shadow_imp', 'shadow')).toBe(true)
    expect(cardMatchesSearchType('grief_soldier', 'shadow')).toBe(true)
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

  it('matches dark charge and gold affinity', () => {
    expect(cardMatchesSearchType('shadow_imp', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('grief_soldier', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('boneling', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('tempest_wraith', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('keeper_of_the_catacombs', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('skeleton_mage', 'dark_charge')).toBe(true)
    expect(cardMatchesSearchType('blob', 'dark_charge')).toBe(false)
    expect(cardMatchesSearchType('dwarven_miner', 'gold_affinity')).toBe(true)
    expect(cardMatchesSearchType('red_knight', 'gold_affinity')).toBe(true)
    expect(cardMatchesSearchType('shadow_imp', 'gold_affinity')).toBe(false)
  })
})
