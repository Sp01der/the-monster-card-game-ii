import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { chaosFireworksSpend, getMonster, hasFireOrBlastAttack } from './catalog'
import { computeDamage, getCircleAdjacent } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(randomValues: number[] = [0]): GameState {
  let randomIndex = 0
  return createGame(
    {
      name: 'P1',
      cardIds: ['red_knight', 'lava_lizels', 'sun_sprite', 'rocketeer'],
      topMonsterIndex: 0,
    },
    {
      name: 'P2',
      cardIds: ['red_cyclops', 'blazing_stallion', 'blob', 'ice_core'],
      topMonsterIndex: 0,
    },
    {
      skipHandoff: true,
      shuffleRandom: () => 0,
      rng: () => 1,
      random: () => randomValues[randomIndex++] ?? randomValues.at(-1) ?? 0,
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

describe('fire card catalog', () => {
  it('defines the six new monsters', () => {
    expect(getMonster('red_knight')).toMatchObject({ points: 4, maxHp: 120, defense: 1 })
    expect(getMonster('lava_lizels')).toMatchObject({ points: 2, maxHp: 100, weakness: 'water' })
    expect(getMonster('sun_sprite')).toMatchObject({ points: 2, maxHp: 90, weakness: 'water' })
    expect(getMonster('red_cyclops')).toMatchObject({ points: 3, maxHp: 120, weakness: 'water' })
    expect(getMonster('blazing_stallion')).toMatchObject({ points: 2, maxHp: 80, weakness: 'water' })
    expect(getMonster('rocketeer')).toMatchObject({ points: 2, maxHp: 80, weakness: 'poison' })
    expect(hasFireOrBlastAttack('red_knight')).toBe(true)
    expect(hasFireOrBlastAttack('rocketeer')).toBe(true)
    expect(hasFireOrBlastAttack('blob')).toBe(false)
    expect(getMonster('red_cyclops').abilities.find((a) => a.id === 'eye_flash')?.cost).toEqual({
      require: 3,
      spend: 0,
    })
    expect(
      getMonster('red_knight').abilities.find((a) => a.id === 'fire_sword')?.effects,
    ).toContainEqual({ type: 'status', status: 'burn', turns: 3 })
  })
})

describe('circle adjacency', () => {
  it('wraps leftmost and rightmost occupied cards between players', () => {
    const state = main(game())
    put(state.players[0], 0, 'rocketeer')
    put(state.players[0], 2, 'lava_lizels')
    put(state.players[1], 1, 'blob')
    put(state.players[1], 5, 'ice_core')

    const left = getCircleAdjacent(state, 0, 0)
    expect(left).toEqual([
      { kind: 'monster', player: 0, slot: 2 },
      { kind: 'monster', player: 1, slot: 1 },
    ])

    const mid = getCircleAdjacent(state, 0, 2)
    expect(mid).toEqual([
      { kind: 'monster', player: 0, slot: 0 },
      { kind: 'monster', player: 1, slot: 5 },
    ])
  })
})

describe('Red Knight', () => {
  it('Flurry spends chosen energy for 30 each', () => {
    const state = main(game())
    put(state.players[0], 0, 'red_knight', { energy: 4 })
    put(state.players[1], 0, 'blob')
    const after = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'flurry_of_blows' &&
          candidate.extraEnergy === 2,
      ),
    )
    expect(after.players[1].field[0]).toBeNull()
    expect(after.players[0].field[0]?.energy).toBe(2)
  })

  it("Knight's Honour redirects a fatal hit and spends 1 energy", () => {
    const state = main(game())
    put(state.players[0], 0, 'red_knight', { energy: 3 })
    put(state.players[0], 1, 'blob', { hp: 20 })
    put(state.players[1], 0, 'fire_sprite', { energy: 1 })

    let next = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'knights_honour'),
    )
    expect(next.players[0].field[0]?.honourGuardUntilNextTurn).toBe(true)

    next.activePlayer = 1
    next.phase = 'main'
    next.abilityUsesLeft = 1
    next.actedSlots = []
    next.playedCardThisTurn = false
    next.players[1].isFirstTurn = false
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'fire_punch' &&
          candidate.choice === 'firePunchFull' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 1,
      ),
    )
    expect(next.players[0].field[1]?.hp).toBe(20)
    expect(next.players[0].field[0]?.hp).toBe(100)
    expect(next.players[0].field[0]?.energy).toBe(2)
  })
})

describe('Lava Lizels, Sun Sprite, Stallion, Rocketeer', () => {
  it('Lava Claw upgrades with spare required energy', () => {
    const state = main(game())
    put(state.players[0], 0, 'lava_lizels', { energy: 2 })
    put(state.players[1], 0, 'blob')
    const after = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'lava_claw'),
    )
    expect(after.players[1].field[0]?.hp).toBe(20)
  })

  it('Sunburn hits three times, or four with an extra 0, separately targeted', () => {
    let three = main(game())
    put(three.players[0], 0, 'sun_sprite', { energy: 1 })
    put(three.players[1], 0, 'blob')
    three = applyAction(
      three,
      action(three, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'sunburn'),
    )
    expect(three.pending).toMatchObject({ kind: 'multiHit', remaining: 3, amount: 10 })
    for (let i = 0; i < 3; i++) {
      three = applyAction(
        three,
        action(three, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 0),
      )
    }
    expect(three.players[1].field[0]?.hp).toBe(20)

    let four = main(game())
    put(four.players[0], 0, 'sun_sprite', { energy: 2 })
    put(four.players[1], 0, 'leecher')
    four = applyAction(
      four,
      action(four, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'sunburn'),
    )
    expect(four.pending).toMatchObject({ kind: 'multiHit', remaining: 4 })
    for (let i = 0; i < 4; i++) {
      four = applyAction(
        four,
        action(four, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 0),
      )
    }
    expect(four.players[1].field[0]?.hp).toBe(30)
  })

  it('Stampede also hits a circle-adjacent withdrawn card', () => {
    const state = main(game())
    put(state.players[0], 0, 'blazing_stallion', { energy: 2 })
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'ice_core', { stance: 'withdrawn' })
    const after = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'stampede' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 0,
      ),
    )
    expect(after.players[1].field[0]?.hp).toBe(20)
    expect(after.players[1].field[1]?.hp).toBe(30)
  })

  it('Rocket splashes circle-adjacent cards, including across the wrap', () => {
    const state = main(game())
    put(state.players[0], 0, 'rocketeer', { energy: 3 })
    put(state.players[0], 6, 'blob', { hp: 50 })
    put(state.players[1], 0, 'ice_core')
    const after = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'rocket'),
    )
    expect(after.players[1].field[0]?.hp).toBe(40)
    expect(after.players[0].field[6]?.hp).toBe(30)
  })

  it('Chaos of Fireworks discounts its cost and can splash your own cards', () => {
    const state = main(game())
    put(state.players[0], 0, 'rocketeer', { energy: 4 })
    put(state.players[0], 1, 'fire_sprite')
    put(state.players[0], 2, 'lava_lizels')
    put(state.players[1], 0, 'ice_core')
    expect(chaosFireworksSpend(state.players[0], 0)).toBe(4)
    const after = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'chaos_of_fireworks'),
    )
    expect(after.players[0].field[0]?.energy).toBe(0)
    expect(after.players[1].field[0]).toBeNull()
  })
})

describe('defense vs Sunburn packets', () => {
  it('applies Red Knight defense to each Sunburn hit', () => {
    expect(
      computeDamage({
        base: 10,
        damageType: 'fire',
        attacker: null,
        defender: {
          instanceId: 'k',
          defId: 'red_knight',
          hp: 120,
          maxHp: 120,
          stance: 'active',
          energy: 0,
          pendingEnergy: 0,
          statuses: [],
          equipment: [],
        },
      }),
    ).toBe(10)
  })
})

describe('times-X attacks', () => {
  it('Overheat is three separately targeted 10-fire burns, and durations add', () => {
    let state = main(game())
    put(state.players[0], 0, 'fire_sprite', { energy: 2 })
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'leecher')
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'overheat'),
    )
    expect(state.pending).toMatchObject({
      kind: 'multiHit',
      remaining: 3,
      amount: 10,
      status: 'burn',
      statusTurns: 3,
    })
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 0),
    )
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 0),
    )
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 1),
    )
    expect(state.pending).toBeNull()
    expect(state.players[1].field[0]?.hp).toBe(30)
    expect(state.players[1].field[0]?.statuses).toEqual([
      expect.objectContaining({ kind: 'burn', turns: 6 }),
    ])
    expect(state.players[1].field[1]?.hp).toBe(60)
    expect(state.players[1].field[1]?.statuses).toEqual([
      expect.objectContaining({ kind: 'burn', turns: 3 }),
    ])
  })

  it('Eye Flash is two separately targeted 2-turn burns', () => {
    let state = main(game())
    put(state.players[0], 0, 'red_cyclops', { energy: 3 })
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'leecher')
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'eye_flash'),
    )
    expect(state.pending).toMatchObject({ kind: 'multiHit', remaining: 2, amount: 0, statusTurns: 2 })
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 0),
    )
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PENDING_TARGET' && candidate.target.slot === 1),
    )
    expect(state.players[1].field[0]?.hp).toBe(50)
    expect(state.players[1].field[0]?.statuses).toEqual([
      expect.objectContaining({ kind: 'burn', turns: 2 }),
    ])
    expect(state.players[1].field[1]?.statuses).toEqual([
      expect.objectContaining({ kind: 'burn', turns: 2 }),
    ])
  })
})
