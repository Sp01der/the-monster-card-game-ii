import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { ALL_CARD_IDS, getMonster } from './catalog'
import { computeDamage } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

const newIds = [
  'water_lizel', 'goblin_magician', 'wyvern', 'big_blob', 'red_blob',
  'purple_blob', 'rarkling', 'leecher', 'storm_bolts', 'shield',
  'rain_of_goo', 'energy_crystal', 'rusted_construct', 'yellow_fairy',
  'gazit', 'horned', 'malvistra', 'orc',
]

function game(rolls: number[] = [1]): GameState {
  let i = 0
  return createGame(
    { name: 'P1', cardIds: ['water_lizel', 'rain_of_goo', 'storm_bolts', 'coffee'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['wyvern', 'shield', 'energy_crystal', 'coffee'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => rolls[i++] ?? rolls.at(-1) ?? 1 },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  const def = getMonster(defId)
  player.field[slot] = {
    instanceId: `${player.id}-${slot}-${defId}`,
    defId,
    hp: def.maxHp,
    maxHp: def.maxHp,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    ...extra,
  }
}

function main(state: GameState) {
  state.phase = 'main'
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  return state
}

function action(
  state: GameState,
  predicate: (a: GameAction) => boolean,
): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error(`action not found: ${listLegalActions(state).map((a) => a.type)}`)
  return found
}

describe('new card catalog', () => {
  it('contains every requested card', () => {
    for (const id of newIds) expect(ALL_CARD_IDS).toContain(id)
  })
})

describe('new combat rules', () => {
  it('marks Yellow Fairy Heal as ranged', () => {
    expect(getMonster('yellow_fairy').abilities.find((a) => a.id === 'heal')?.ranged).toBe(true)
  })

  it('Orc abilities use the clarified chance, ranged, and free rules', () => {
    let state = main(game([2]))
    put(state.players[0], 0, 'orc', { energy: 2 })
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'cruel_scimitar'),
    )
    expect(state.players[1].field[0]!.hp).toBe(30)

    state = main(game())
    put(state.players[0], 0, 'orc', { energy: 2, stance: 'withdrawn' })
    put(state.players[1], 0, 'leecher')
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'poisoned_shaft',
      ),
    ).toBe(true)

    state.players[0].field[0]!.stance = 'active'
    state.abilityUsesLeft = 0
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'blood_thirsty',
      ),
    ).toBe(true)
  })

  it('Water Lizel Claw automatically upgrades at 2 energy', () => {
    let state = main(game())
    put(state.players[0], 0, 'water_lizel', { energy: 2 })
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'claw'),
    )
    expect(state.players[0].field[0]!.energy).toBe(1)
    expect(state.players[1].field[0]!.hp).toBe(40)
  })

  it('Wet adds 10 before water weakness', () => {
    const attacker = {
      ...({} as FieldMonster),
      instanceId: 'a', defId: 'blob', hp: 50, maxHp: 50, stance: 'active' as const,
      energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
    }
    const defender = {
      ...attacker,
      instanceId: 'd',
      defId: 'big_blob',
      hp: 100,
      maxHp: 100,
      statuses: [{ kind: 'wet' as const, turns: 3, skipNextTick: false }],
    }
    expect(computeDamage({ base: 20, damageType: 'water', attacker, defender })).toBe(50)
  })

  it('Poison deals 30 when its owner used the card, otherwise 10', () => {
    let state = game()
    put(state.players[0], 0, 'leecher', {
      statuses: [{ kind: 'poison', turns: 3, skipNextTick: false }],
    })
    state.players[0].isFirstTurn = false
    state.players[0].hasFinishedFirstTurn = true
    state.phase = 'end'
    state.actedSlots = [0]
    state = applyAction(state, { type: 'END_TURN' })
    expect(state.players[0].field[0]!.hp).toBe(40)
  })

  it('Shield contributes one defence', () => {
    const base = {
      instanceId: 'x', defId: 'leecher', hp: 70, maxHp: 70, stance: 'active' as const,
      energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
    }
    const shielded = {
      ...base,
      equipment: [{ instanceId: 's', defId: 'shield', hp: 30, maxHp: 30 }],
    }
    expect(computeDamage({ base: 30, attacker: base, defender: shielded })).toBe(20)
  })
})

describe('energy passives', () => {
  it('Spark, Fairy, Crystal, and unused Construct apply cumulatively', () => {
    let state = main(game([1]))
    put(state.players[0], 0, 'goblin_magician', { energy: 1 })
    put(state.players[0], 1, 'yellow_fairy', {
      equipment: [{ instanceId: 'c', defId: 'energy_crystal', hp: 30, maxHp: 30 }],
    })
    put(state.players[0], 2, 'rusted_construct')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'spark'),
    )
    state = applyAction(state, { type: 'SKIP_MAIN' })
    state = applyAction(state, { type: 'SKIP_MOVE' })
    expect(state.phase).toBe('energy')
    expect(state.energyPool).toBe(4)
    expect(state.players[0].field[1]!.energy).toBe(1)
    expect(state.players[0].field[2]!.energy).toBe(1)
  })

  it('Energize skips the entire energy phase', () => {
    let state = main(game())
    put(state.players[0], 0, 'gazit', { energy: 1 })
    put(state.players[0], 1, 'yellow_fairy')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'energize'),
    )
    expect(state.players[0].field[0]!.energy).toBe(2)
    expect(state.players[0].field[1]!.energy).toBe(1)
    state = applyAction(state, { type: 'SKIP_MAIN' })
    state = applyAction(state, { type: 'SKIP_MOVE' })
    expect(state.phase).toBe('end')
    expect(state.energyPool).toBe(0)
  })
})

describe('multi-step cards', () => {
  it('Plasma Volley rolls then requests separate targets', () => {
    let state = main(game([6]))
    put(state.players[0], 0, 'rusted_construct', { energy: 3 })
    put(state.players[1], 0, 'leecher')
    put(state.players[1], 1, 'water_lizel')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'plasma_volley'),
    )
    expect(state.pending?.kind).toBe('multiHit')
    if (state.pending?.kind === 'multiHit') expect(state.pending.remaining).toBe(3)
    expect(state.log.findLast((entry) => entry.dieRoll !== undefined)?.dieRoll).toBe(6)
    const hit = action(state, (a) => a.type === 'PENDING_TARGET')
    state = applyAction(state, hit)
    if (state.pending?.kind === 'multiHit') expect(state.pending.remaining).toBe(2)
  })

  it('Big Blob death pauses for two chosen Blob placements', () => {
    let state = main(game())
    put(state.players[0], 0, 'water_lizel', { energy: 1 })
    put(state.players[1], 0, 'big_blob', { hp: 10 })
    state.players[1].hasFinishedFirstTurn = true
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'claw'),
    )
    expect(state.pending?.kind).toBe('spawnBlobs')
    state = applyAction(state, { type: 'SPAWN_BLOB', slot: 0, stance: 'withdrawn' })
    state = applyAction(state, { type: 'SPAWN_BLOB', slot: 1, stance: 'active' })
    expect(state.players[1].field[0]?.defId).toBe('blob')
    expect(state.players[1].field[0]?.stance).toBe('withdrawn')
    expect(state.pending).toBeNull()
    expect(state.winner).toBeNull()
  })

  it('Trickery removes a random hand card and places it exactly in deck', () => {
    let state = main(game([1]))
    put(state.players[0], 0, 'goblin_magician', { energy: 2 })
    const handBefore = state.players[1].hand.length
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'trickery'),
    )
    expect(state.pending?.kind).toBe('trickery')
    expect(state.players[1].hand).toHaveLength(handBefore - 1)
    state = applyAction(state, { type: 'TRICKERY_PLACE', deckIndex: 0 })
    expect(state.pending).toBeNull()
  })
})

describe('special choices and effects', () => {
  it('Horned CHARGE spends the chosen extra energy', () => {
    let state = main(game())
    put(state.players[0], 0, 'horned', { energy: 4 })
    put(state.players[1], 0, 'water_lizel')
    const charge = action(
      state,
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'charge' && a.extraEnergy === 2,
    )
    state = applyAction(state, charge)
    expect(state.players[0].field[0]!.energy).toBe(1)
    expect(state.players[1].field[0]!.hp).toBe(40)
  })

  it('Transferal moves min(2, source energy) and skips energy phase', () => {
    let state = main(game())
    put(state.players[0], 0, 'malvistra', { energy: 1 })
    put(state.players[0], 1, 'blob', { energy: 1 })
    put(state.players[1], 0, 'leecher')
    const transfer = action(
      state,
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.abilityId === 'transferal' &&
        a.targets?.[0]?.player === 0 &&
        a.targets?.[0]?.slot === 1 &&
        a.targets?.[1]?.player === 1,
    )
    state = applyAction(state, transfer)
    expect(state.players[0].field[1]!.energy).toBe(0)
    expect(state.players[1].field[0]!.energy).toBe(1)
    expect(state.skipEnergyPhase).toBe(true)
  })

  it('Rain of Goo requires three distinct targets in Goo mode', () => {
    let state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[0], 1, 'red_blob')
    put(state.players[1], 0, 'leecher')
    const rainIndex = state.players[0].hand.findIndex((c) => c.defId === 'rain_of_goo')
    state = applyAction(state, { type: 'PLAY_EFFECT', handIndex: rainIndex, targets: [] })
    state = applyAction(state, { type: 'RAIN_CHOOSE_MODE', mode: 'goo' })
    for (const target of [
      { kind: 'monster' as const, player: 0 as const, slot: 0 },
      { kind: 'monster' as const, player: 0 as const, slot: 1 },
      { kind: 'monster' as const, player: 1 as const, slot: 0 },
    ]) {
      state = applyAction(state, { type: 'RAIN_GOO_TARGET', target })
    }
    expect(state.pending).toBeNull()
    expect(state.players[0].field[0]!.statuses.some((s) => s.kind === 'goo')).toBe(true)
    expect(state.players[1].field[0]!.statuses.some((s) => s.kind === 'goo')).toBe(true)
  })

  it('prevents duplicate equipment names on one monster', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      equipment: [{ instanceId: 'shield-1', defId: 'shield', hp: 30, maxHp: 30 }],
    })
    state.players[0].hand.push({ instanceId: 'shield-2', defId: 'shield' })
    const index = state.players[0].hand.length - 1
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'PLAY_EQUIPMENT' && a.handIndex === index && a.slot === 0,
      ),
    ).toBe(false)
  })
})
