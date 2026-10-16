import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { countsAsElectricCard, formatDamageType, getMonster } from './catalog'
import { computeDamage } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(rolls: number[] = [3]): GameState {
  let rollIndex = 0
  return createGame(
    {
      name: 'P1',
      cardIds: ['thunder_core', 'construct', 'tempest_wraith', 'deci_construct'],
      topMonsterIndex: 0,
    },
    {
      name: 'P2',
      cardIds: ['blob', 'leecher', 'red_knight', 'ice_core'],
      topMonsterIndex: 0,
    },
    {
      skipHandoff: true,
      shuffleRandom: () => 0,
      rng: () => rolls[rollIndex++] ?? rolls.at(-1) ?? 3,
    },
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

function main(state: GameState): GameState {
  state.phase = 'main'
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].isFirstTurn = false
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.playedCardThisTurn = false
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error(`Action not found: ${listLegalActions(state).map((a) => a.type)}`)
  return found
}

describe('electric / construct catalog', () => {
  it('defines the new monsters', () => {
    expect(getMonster('thunder_core')).toMatchObject({ points: 2, maxHp: 80, weakness: 'wind' })
    expect(getMonster('construct')).toMatchObject({ points: 2, maxHp: 100, defense: 1, idleEnergy: true })
    expect(getMonster('tempest_wraith')).toMatchObject({ points: 2, maxHp: 70, darkCharge: true })
    expect(getMonster('deci_construct')).toMatchObject({ points: 2, maxHp: 100, idleEnergy: true })
    expect(getMonster('supply_construct')).toMatchObject({ points: 2, maxHp: 90, defense: 1, idleEnergy: true })
    expect(getMonster('lightning_worm')).toMatchObject({ points: 4, maxHp: 170, weakness: 'poison' })
    expect(getMonster('gladin_tunneller')).toMatchObject({ points: 4, maxHp: 170, weakness: 'water' })
    expect(formatDamageType('sound')).toBe('sonic')
    expect(countsAsElectricCard('thunder_core')).toBe(true)
    expect(countsAsElectricCard('tempest_wraith')).toBe(true)
    expect(countsAsElectricCard('blob')).toBe(false)
  })
})

describe('Thunder Core', () => {
  it('Zap spends an extra + for 40 electric', () => {
    let state = main(game())
    put(state.players[0], 0, 'thunder_core', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'zap' && a.extraEnergy === 1),
    )
    expect(state.players[1].field[0]?.hp).toBe(10)
    expect(state.players[0].field[0]?.energy).toBe(1)
  })

  it('Storm is four separately targeted piercing electric hits', () => {
    let state = main(game())
    put(state.players[0], 0, 'thunder_core', { energy: 2 })
    put(state.players[1], 0, 'red_knight')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'storm'),
    )
    expect(state.pending).toMatchObject({
      kind: 'multiHit',
      remaining: 4,
      amount: 10,
      piercing: true,
    })
    for (let i = 0; i < 4; i++) {
      state = applyAction(
        state,
        action(state, (a) => a.type === 'PENDING_TARGET' && a.target.slot === 0),
      )
    }
    expect(state.players[1].field[0]?.hp).toBe(80)
  })
})

describe('Construct Plasma Cannon', () => {
  it('accumulates hits then fires, and two misses fail', () => {
    let state = main(game([4, 5]))
    put(state.players[0], 0, 'construct', { energy: 4 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'plasma_cannon'),
    )
    expect(state.pending).toMatchObject({ kind: 'plasmaCannon', hits: 1, misses: 0 })
    state = applyAction(state, { type: 'PLASMA_ROLL' })
    expect(state.pending).toMatchObject({ kind: 'plasmaCannon', hits: 2, misses: 0 })
    state = applyAction(
      state,
      action(state, (a) => a.type === 'PLASMA_FIRE' && a.target.slot === 0),
    )
    expect(state.players[1].field[0]?.hp).toBe(10)
    expect(state.pending).toBeNull()

    state = main(game([1, 2]))
    put(state.players[0], 0, 'construct', { energy: 4 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'plasma_cannon'),
    )
    expect(state.pending).toMatchObject({ hits: 0, misses: 1 })
    expect(listLegalActions(state).some((a) => a.type === 'PLASMA_FIRE')).toBe(false)
    state = applyAction(state, { type: 'PLASMA_ROLL' })
    expect(state.pending).toBeNull()
    expect(state.players[1].field[0]?.hp).toBe(50)
  })
})

describe('Tempest Wraith', () => {
  it('Lingering Energy treats the next ability’s + as 0', () => {
    let state = main(game())
    put(state.players[0], 0, 'tempest_wraith', { energy: 2 })
    put(state.players[0], 1, 'grief_soldier', { energy: 1 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'lingering_energy'),
    )
    expect(state.players[0].lingeringEnergy).toBe(true)
    state.abilityUsesLeft = 1
    state.actedSlots = []
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'black_blade'),
    )
    expect(state.players[0].field[1]?.energy).toBe(1)
    expect(state.players[0].lingeringEnergy).toBe(false)
    expect(state.players[1].field[0]?.hp).toBe(20)
  })
})

describe('Deci-construct', () => {
  it('Sound Wave can finish with fewer than three targets', () => {
    let state = main(game())
    put(state.players[0], 0, 'deci_construct', { energy: 4 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'sound_wave'),
    )
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'SOUND_WAVE_TARGET' &&
          a.target.player === 1 &&
          a.target.slot === 0,
      ),
    )
    state = applyAction(state, { type: 'SOUND_WAVE_FINISH' })
    expect(state.players[1].field[0]?.hp).toBe(30)
    expect(state.pending).toBeNull()
  })
})

describe('Supply Construct', () => {
  it('Collect and Supply move any amount, including the required 0', () => {
    let state = main(game())
    put(state.players[0], 0, 'supply_construct', { energy: 1 })
    put(state.players[0], 1, 'blob', { energy: 3 })
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'collect' &&
          a.extraEnergy === 3 &&
          a.target?.slot === 1,
      ),
    )
    expect(state.players[0].field[0]?.energy).toBe(4)
    expect(state.players[0].field[1]?.energy).toBe(0)

    state.abilityUsesLeft = 1
    state.actedSlots = []
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'supply' &&
          a.extraEnergy === 4 &&
          a.target?.slot === 1,
      ),
    )
    expect(state.players[0].field[0]?.energy).toBe(0)
    expect(state.players[0].field[1]?.energy).toBe(4)
    expect(state.abilityUsesLeft).toBe(1)
  })
})

describe('Lightning Worm', () => {
  it('gains energy from each electric damage packet and Channels other electric cards', () => {
    let state = main(game())
    put(state.players[0], 0, 'lightning_worm', { energy: 1 })
    put(state.players[0], 1, 'thunder_core')
    put(state.players[1], 0, 'thunder_core', { energy: 1 })
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'channel'),
    )
    expect(state.players[0].field[0]?.energy).toBe(1)

    state.activePlayer = 1
    state.abilityUsesLeft = 1
    state.actedSlots = []
    state.players[1].isFirstTurn = false
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'zap' && (a.extraEnergy ?? 0) === 0),
    )
    expect(state.players[0].field[0]?.energy).toBe(2)
  })
})

describe('idle energy', () => {
  it('Constructs gain 1 energy when unused, like Rusted Construct', () => {
    let state = main(game())
    put(state.players[0], 0, 'construct')
    put(state.players[0], 1, 'supply_construct')
    state.actedSlots = []
    state.movedSlots = []
    state = applyAction(state, { type: 'SKIP_MAIN' })
    state = applyAction(state, { type: 'SKIP_MOVE' })
    expect(state.players[0].field[0]?.energy).toBe(1)
    expect(state.players[0].field[1]?.energy).toBe(1)
  })
})

describe('piercing electric', () => {
  it('Phantom Bolt ignores defense', () => {
    const knight = {
      instanceId: 'k',
      defId: 'red_knight',
      hp: 120,
      maxHp: 120,
      stance: 'active' as const,
      energy: 0,
      pendingEnergy: 0,
      statuses: [],
      equipment: [],
    }
    expect(computeDamage({ base: 20, damageType: 'electric', piercing: true, attacker: null, defender: knight })).toBe(
      20,
    )
    expect(computeDamage({ base: 20, damageType: 'electric', attacker: null, defender: knight })).toBe(10)
  })
})
