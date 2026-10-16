import { describe, expect, it } from 'vitest'
import {
  computeDamage,
  getAdjacentSlots,
  getAdjacentTargets,
  prismSuccessFaces,
  roundToNearest10,
} from './damage'
import type { FieldMonster } from './types'

function mon(partial: Partial<FieldMonster> & { defId: string }): FieldMonster {
  return {
    instanceId: 'x',
    hp: 50,
    maxHp: 50,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    ...partial,
  }
}

describe('roundToNearest10', () => {
  it('rounds 15 to 20', () => {
    expect(roundToNearest10(15)).toBe(20)
  })
  it('rounds 14 to 10', () => {
    expect(roundToNearest10(14)).toBe(10)
  })
})

describe('computeDamage', () => {
  it('applies weakness x1.5 rounded to nearest 10', () => {
    const amount = computeDamage({
      base: 20,
      damageType: 'fire',
      attacker: mon({ defId: 'blob' }),
      defender: mon({ defId: 'ice_core' }),
    })
    // 20 * 1.5 = 30
    expect(amount).toBe(30)
  })

  it('does not apply weakness for untyped damage', () => {
    const amount = computeDamage({
      base: 20,
      damageType: 'untyped',
      attacker: mon({ defId: 'blob' }),
      defender: mon({ defId: 'ice_core' }),
    })
    expect(amount).toBe(20)
  })

  it('applies defense with minimum 10', () => {
    const amount = computeDamage({
      base: 10,
      attacker: mon({ defId: 'blob' }),
      defender: mon({ defId: 'ember_tortoise' }),
    })
    // 10 - 20 = -10 clamped to 10
    expect(amount).toBe(10)
  })

  it('skips defense for piercing / sound', () => {
    const amount = computeDamage({
      base: 10,
      damageType: 'sound',
      attacker: mon({ defId: 'blob' }),
      defender: mon({ defId: 'ember_tortoise' }),
    })
    expect(amount).toBe(10)
  })

  it('applies Sword +10 without energy and +20 with energy', () => {
    const noEnergy = computeDamage({
      base: 20,
      attacker: mon({
        defId: 'blob',
        equipment: [{ instanceId: 's', defId: 'sword', hp: 20, maxHp: 20 }],
      }),
      defender: mon({ defId: 'ice_core' }),
    })
    expect(noEnergy).toBe(30)

    const withEnergy = computeDamage({
      base: 20,
      attacker: mon({
        defId: 'blob',
        energy: 1,
        equipment: [{ instanceId: 's', defId: 'sword', hp: 20, maxHp: 20 }],
      }),
      defender: mon({ defId: 'ice_core' }),
    })
    expect(withEnergy).toBe(40)
  })

  it('only gives Sword +20 for energy beyond every required or consumed dot', () => {
    const sword = [{ instanceId: 's', defId: 'sword', hp: 20, maxHp: 20 }]
    const defender = mon({ defId: 'blob' })

    const allThreeRequired = computeDamage({
      base: 20,
      requiredEnergy: 3,
      attacker: mon({ defId: 'ice_core', energy: 3, equipment: sword }),
      defender,
    })
    expect(allThreeRequired).toBe(30)

    const onlyTwoRequired = computeDamage({
      base: 20,
      requiredEnergy: 2,
      attacker: mon({ defId: 'ice_core', energy: 3, equipment: sword }),
      defender,
    })
    expect(onlyTwoRequired).toBe(40)

    const allEnergyConsumed = computeDamage({
      base: 20,
      requiredEnergy: 0,
      attacker: mon({ defId: 'ice_core', energy: 0, equipment: sword }),
      defender,
    })
    expect(allEnergyConsumed).toBe(30)
  })

  it('adds Spear +10 and stacks it with Sword', () => {
    const spear = [{ instanceId: 'p', defId: 'spear', hp: 40, maxHp: 40 }]
    const both = [
      { instanceId: 's', defId: 'sword', hp: 20, maxHp: 20 },
      { instanceId: 'p', defId: 'spear', hp: 40, maxHp: 40 },
    ]
    const defender = mon({ defId: 'blob' })

    expect(
      computeDamage({
        base: 20,
        attacker: mon({ defId: 'ice_core', equipment: spear }),
        defender,
      }),
    ).toBe(30)

    expect(
      computeDamage({
        base: 20,
        attacker: mon({ defId: 'ice_core', equipment: both }),
        defender,
      }),
    ).toBe(40)

    expect(
      computeDamage({
        base: 20,
        attacker: mon({ defId: 'ice_core', energy: 1, equipment: both }),
        defender,
      }),
    ).toBe(50)
  })

  it('lets an illuminated attacker trigger Light weakness once', () => {
    const defender = mon({ defId: 'winter_wizard' })
    expect(
      computeDamage({
        base: 30,
        damageType: 'fire',
        attacker: mon({ defId: 'fire_sprite', illuminatedThisTurn: true }),
        defender,
      }),
    ).toBe(50)

    expect(
      computeDamage({
        base: 30,
        damageType: 'fire',
        attacker: mon({ defId: 'fire_sprite' }),
        defender,
      }),
    ).toBe(30)

    expect(
      computeDamage({
        base: 20,
        damageType: 'light',
        attacker: mon({ defId: 'lantern_wisp', illuminatedThisTurn: true }),
        defender,
      }),
    ).toBe(30)
  })

  it('adds one unused success face for Prism Lens', () => {
    const lens = mon({
      defId: 'blob',
      equipment: [{ instanceId: 'l', defId: 'prism_lens', hp: 20, maxHp: 20 }],
    })
    expect(prismSuccessFaces(lens, [2, 3, 4, 5, 6])).toEqual([2, 3, 4, 5, 6, 1])
    expect(prismSuccessFaces(lens, [1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6])
    expect(prismSuccessFaces(mon({ defId: 'blob' }), [1, 2, 3])).toEqual([1, 2, 3])
  })
})

describe('adjacency', () => {
  it('finds neighboring living cards and skips empty slots', () => {
    const field = [
      mon({ defId: 'blob' }),
      null,
      mon({ defId: 'ice_core' }),
      mon({ defId: 'snapatrap' }),
      null,
      null,
      null,
    ]
    expect(getAdjacentSlots(field, 2)).toEqual([0, 3])
    expect(getAdjacentSlots(field, 0)).toEqual([2])
  })

  it('falls back to nearest opposing monster when no neighbors', () => {
    const own = [
      mon({ defId: 'blob' }),
      null,
      null,
      null,
      null,
      null,
      null,
    ]
    const opp = [
      null,
      null,
      mon({ defId: 'ice_core' }),
      null,
      mon({ defId: 'snapatrap' }),
      null,
      null,
    ]
    expect(getAdjacentTargets(own, 0, opp)).toEqual([{ player: 'opponent', slot: 2 }])
  })
})
