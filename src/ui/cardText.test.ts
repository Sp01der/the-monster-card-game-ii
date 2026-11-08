import { describe, expect, it } from 'vitest'
import { getCard } from '../game/catalog'
import type { FieldMonster } from '../game/types'
import { abilityLines, boostPrintedDamage, withBladeCost } from './cardText'

function mon(partial: Partial<FieldMonster> & { defId: string }): FieldMonster {
  return {
    instanceId: 'x',
    hp: 80,
    maxHp: 80,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    ...partial,
  }
}

describe('boostPrintedDamage', () => {
  it('raises damage figures and leaves heals alone', () => {
    expect(boostPrintedDamage('20 damage', 10)).toBe('30 damage')
    expect(boostPrintedDamage('30 piercing shadow damage.', 20)).toBe('50 piercing shadow damage.')
    expect(boostPrintedDamage('Roll 1–2 = 30, 3–4 = 40, 5–6 = 50.', 10)).toBe(
      'Roll 1–2 = 40, 3–4 = 50, 5–6 = 60.',
    )
    expect(boostPrintedDamage('20 damage. 3/6 chance of 30 damage instead.', 10)).toBe(
      '30 damage. 3/6 chance of 40 damage instead.',
    )
    expect(
      boostPrintedDamage('20 electric; spend up to 3 extra energy for +20 each', 10),
    ).toBe('30 electric; spend up to 3 extra energy for +20 each')
    expect(boostPrintedDamage('Spend 1–3 energy: 30 damage per energy spent', 10)).toBe(
      'Spend 1–3 energy: 30 damage per energy spent. +10 damage.',
    )
    expect(boostPrintedDamage('Heal another monster 30 HP.', 10)).toBe('Heal another monster 30 HP.')
    expect(
      boostPrintedDamage('30 fire damage and burn. 2/6 chance of this card taking 20 damage.', 10),
    ).toBe('40 fire damage and burn. 2/6 chance of this card taking 20 damage.')
    expect(
      boostPrintedDamage('Every monster that has damaged one of your cards this game takes 20 damage.', 10),
    ).toBe('Every monster that has damaged one of your cards this game takes 30 damage.')
    expect(
      boostPrintedDamage(
        "Lower this card's HP by 10 any number of times. Deal 20 damage per 10 HP lost.",
        10,
      ),
    ).toBe(
      "Lower this card's HP by 10 any number of times. Deal 20 damage per 10 HP lost. +10 damage.",
    )
  })
})

describe('withBladeCost live damage', () => {
  it('bakes Cloud of Darkness, Wizrobe stacks, and equipment into ability text', () => {
    const shadow = withBladeCost(
      abilityLines(getCard('skeleton_mage')),
      mon({
        defId: 'skeleton_mage',
        energy: 1,
        shadowBonus: 20,
        equipment: [{ instanceId: 's', defId: 'sword', hp: 20, maxHp: 20 }],
      }),
    )
    // 30 base + 20 shadow + 20 sword (spare energy) = 70
    expect(shadow.find((line) => line.id === 'anti_heal')?.body).toBe('70 piercing shadow damage.')

    const wizrobe = withBladeCost(
      abilityLines(getCard('wizrobe')),
      mon({ defId: 'wizrobe', attackBonus: 20 }),
    )
    expect(wizrobe.find((line) => line.id === 'magic_missile')?.body).toBe('40 damage')

    const warden = withBladeCost(
      abilityLines(getCard('amanesian_warden')),
      mon({ defId: 'amanesian_warden', gold: 2 }),
      10,
    )
    // 20 base + 20 gold passive + 10 ATTACK! = 50
    expect(warden.find((line) => line.id === 'iron_fists')?.body).toBe('50 damage.')

    const hunt = withBladeCost(
      abilityLines(getCard('blubis_eel')),
      mon({ defId: 'blubis_eel', attackBonus: 10 }),
    )
    expect(hunt.find((line) => line.id === 'hunt')?.body).toBe(
      '20 damage; bury any number for +30 each',
    )

    const fires = withBladeCost(
      abilityLines(getCard('veridis_warrior')),
      mon({ defId: 'veridis_warrior', attackBonus: 10 }),
    )
    expect(fires.find((line) => line.id === 'veridian_fires')?.body).toBe(
      "Lower this card's HP by 10 any number of times. Deal 20 damage per 10 HP lost. +10 damage.",
    )
  })
})
