import { describe, expect, it } from 'vitest'
import { isUndoablePhaseAction, listLegalActions } from './actions'
import { getMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'orc', 'coffee', 'sword'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'orc', 'coffee', 'sword'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
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

function main(state: GameState, player: 0 | 1 = 0): GameState {
  state.phase = 'main'
  state.activePlayer = player
  state.players[0].isFirstTurn = false
  state.players[1].isFirstTurn = false
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.playedCardThisTurn = false
  state.pending = null
  return state
}

function uses(state: GameState, abilityId: string, kind: 'monster' | 'equipment') {
  return listLegalActions(state).filter(
    (action): action is Extract<GameAction, { type: 'USE_ABILITY' }> =>
      action.type === 'USE_ABILITY' && action.abilityId === abilityId && action.target?.kind === kind,
  )
}

const shield = { instanceId: 'shield-1', defId: 'shield', hp: 30, maxHp: 30 }

describe('equipment targeting', () => {
  it('lets a single-target attack hit equipment on a legal host', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 1 })
    put(state.players[1], 0, 'blob', { equipment: [{ ...shield }] })

    expect(uses(state, 'wakkle', 'equipment')).toContainEqual(
      expect.objectContaining({
        target: { kind: 'equipment', player: 1, slot: 0, equipmentIndex: 0 },
      }),
    )

    const next = applyAction(state, {
      type: 'USE_ABILITY',
      slot: 0,
      abilityId: 'wakkle',
      target: { kind: 'equipment', player: 1, slot: 0, equipmentIndex: 0 },
    })
    expect(next.players[1].field[0]?.hp).toBe(50)
    expect(next.players[1].field[0]?.equipment[0]?.hp).toBe(10)
  })

  it('deals the damage of a damaging status attack and does not afflict the equipment', () => {
    const state = main(game())
    put(state.players[0], 0, 'wyvern', { energy: 3 })
    put(state.players[1], 0, 'blob', { equipment: [{ ...shield }] })

    const next = applyAction(state, {
      type: 'USE_ABILITY',
      slot: 0,
      abilityId: 'tail_sting',
      target: { kind: 'equipment', player: 1, slot: 0, equipmentIndex: 0 },
    })
    expect(next.players[1].field[0]?.equipment[0]?.hp).toBe(10)
    expect(next.players[1].field[0]?.statuses).toEqual([])
  })

  it('does not offer equipment to a status-only ability', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 2 })
    put(state.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    expect(uses(state, 'splat', 'monster').length).toBeGreaterThan(0)
    expect(uses(state, 'splat', 'equipment')).toEqual([])
  })

  it('does not offer equipment to area or adjacency attacks', () => {
    const state = main(game())
    put(state.players[0], 0, 'breaker', { energy: 2 })
    put(state.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    put(state.players[1], 1, 'blob')
    put(state.players[1], 2, 'blob')
    expect(uses(state, 'ground_shaker', 'equipment')).toEqual([])
    expect(uses(state, 'ground_shaker', 'monster').length).toBeGreaterThan(0)

    const rockets = main(game())
    put(rockets.players[0], 0, 'rocketeer', { energy: 3 })
    put(rockets.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    expect(uses(rockets, 'rocket', 'equipment')).toEqual([])

    const quake = main(game())
    put(quake.players[0], 0, 'colossus', { energy: 2 })
    put(quake.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    const after = applyAction(
      quake,
      listLegalActions(quake).find(
        (action) => action.type === 'USE_ABILITY' && action.abilityId === 'quake',
      ) as GameAction,
    )
    expect(after.players[1].field[0]?.hp).toBe(40)
    expect(after.players[1].field[0]?.equipment[0]?.hp).toBe(30)
  })

  it('keeps equipment off a protected host and still allows it when the host can be hit', () => {
    const state = main(game())
    put(state.players[0], 0, 'hill_troll', { energy: 2 })
    put(state.players[0], 1, 'orc', { equipment: [{ ...shield }] })
    put(state.players[1], 0, 'blob', { energy: 2 })
    const guarding = applyAction(
      state,
      listLegalActions(state).find(
        (action) => action.type === 'USE_ABILITY' && action.abilityId === 'meat_shield',
      )!,
    )
    const attack = main(guarding, 1)
    expect(uses(attack, 'wakkle', 'equipment')).toEqual([])
    expect(
      listLegalActions(attack).some(
        (action) =>
          action.type === 'USE_ABILITY' &&
          action.abilityId === 'wakkle' &&
          action.target?.kind === 'monster' &&
          action.target.slot === 1,
      ),
    ).toBe(false)
    expect(uses(attack, 'splat', 'equipment')).toEqual([])

    attack.players[1].hand = [{ instanceId: 'lra', defId: 'long_range_archer' }]
    const shots = listLegalActions(attack).filter((action) => action.type === 'PLAY_EFFECT')
    expect(
      shots.some(
        (action) => action.type === 'PLAY_EFFECT' && action.targets[0]?.kind === 'equipment',
      ),
    ).toBe(false)

    const open = main(game())
    put(open.players[0], 0, 'blob')
    put(open.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    open.players[0].hand = [{ instanceId: 'lra', defId: 'long_range_archer' }]
    expect(
      listLegalActions(open).some(
        (action) =>
          action.type === 'PLAY_EFFECT' &&
          action.targets[0]?.kind === 'equipment' &&
          action.targets[0].equipmentIndex === 0,
      ),
    ).toBe(true)
  })

  it('includes equipment on separately targeted hits and sound wave, not on pure status hits', () => {
    const hits = main(game())
    put(hits.players[0], 0, 'blob', { energy: 1 })
    put(hits.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    hits.pending = {
      kind: 'multiHit',
      sourcePlayer: 0,
      sourceSlot: 0,
      remaining: 1,
      amount: 20,
      damageType: 'untyped',
      requiredEnergy: 0,
    }
    expect(
      listLegalActions(hits).some(
        (action) => action.type === 'PENDING_TARGET' && action.target.kind === 'equipment',
      ),
    ).toBe(true)

    hits.pending = {
      kind: 'multiHit',
      sourcePlayer: 0,
      sourceSlot: 0,
      remaining: 2,
      amount: 0,
      damageType: 'fire',
      requiredEnergy: 0,
      status: 'burn',
      statusTurns: 2,
    }
    expect(
      listLegalActions(hits).some(
        (action) => action.type === 'PENDING_TARGET' && action.target.kind === 'equipment',
      ),
    ).toBe(false)

    const wave = main(game())
    put(wave.players[0], 0, 'deci_construct', { energy: 1 })
    put(wave.players[1], 0, 'blob', { equipment: [{ ...shield }] })
    wave.pending = {
      kind: 'soundWave',
      sourcePlayer: 0,
      sourceSlot: 0,
      chosenInstanceIds: [],
      requiredEnergy: 0,
    }
    const pick = listLegalActions(wave).find(
      (action) => action.type === 'SOUND_WAVE_TARGET' && action.target.kind === 'equipment',
    )
    expect(pick).toBeTruthy()
    const chosen = applyAction(wave, pick!)
    const after = applyAction(chosen, { type: 'SOUND_WAVE_FINISH' })
    expect(after.players[1].field[0]?.hp).toBe(50)
    expect(after.players[1].field[0]?.equipment[0]?.hp).toBe(10)
    expect(after.pending).toBeNull()
  })

  it('heals equipment on a legal host and does not treat that as a status', () => {
    const state = main(game())
    put(state.players[0], 0, 'lantern_wisp', { energy: 1 })
    put(state.players[0], 1, 'blob', {
      equipment: [{ instanceId: 'shield-1', defId: 'shield', hp: 10, maxHp: 30 }],
    })
    const next = applyAction(state, {
      type: 'USE_ABILITY',
      slot: 0,
      abilityId: 'gleam',
      target: { kind: 'equipment', player: 0, slot: 1, equipmentIndex: 0 },
    })
    expect(next.players[0].field[1]?.equipment[0]?.hp).toBe(20)
    expect(next.players[0].field[1]?.illuminatedThisTurn).toBeUndefined()

    const fairy = main(game())
    put(fairy.players[0], 0, 'yellow_fairy', {
      energy: 1,
      equipment: [{ instanceId: 'own-shield', defId: 'shield', hp: 10, maxHp: 30 }],
    })
    put(fairy.players[0], 1, 'blob', {
      equipment: [{ instanceId: 'shield-1', defId: 'shield', hp: 10, maxHp: 30 }],
    })
    const healed = applyAction(fairy, {
      type: 'USE_ABILITY',
      slot: 0,
      abilityId: 'heal',
      target: { kind: 'equipment', player: 0, slot: 1, equipmentIndex: 0 },
    })
    expect(healed.players[0].field[1]?.equipment[0]?.hp).toBe(30)
    expect(uses(fairy, 'heal', 'equipment').some((action) => action.target?.slot === 0)).toBe(false)
    expect(uses(fairy, 'heal', 'equipment').some((action) => action.target?.slot === 1)).toBe(true)
  })
})

describe('phase undo', () => {
  it('marks phase skips and turn ends as undoable, and leaves abilities alone', () => {
    expect(isUndoablePhaseAction({ type: 'SKIP_DRAW' })).toBe(true)
    expect(isUndoablePhaseAction({ type: 'SKIP_MAIN' })).toBe(true)
    expect(isUndoablePhaseAction({ type: 'SKIP_MOVE' })).toBe(true)
    expect(isUndoablePhaseAction({ type: 'SKIP_ENERGY' })).toBe(true)
    expect(isUndoablePhaseAction({ type: 'FINISH_ENERGY' })).toBe(true)
    expect(isUndoablePhaseAction({ type: 'END_TURN' })).toBe(true)
    expect(isUndoablePhaseAction({ type: 'USE_ABILITY', slot: 0, abilityId: 'wakkle' })).toBe(false)
    expect(isUndoablePhaseAction({ type: 'WITHDRAW', slot: 0 })).toBe(false)
    expect(isUndoablePhaseAction({ type: 'DRAW' })).toBe(false)
    expect(isUndoablePhaseAction({ type: 'ATTACH_ENERGY', slot: 0 })).toBe(false)
    expect(isUndoablePhaseAction({ type: 'CONFIRM_HANDOFF' })).toBe(false)
    expect(isUndoablePhaseAction({ type: 'PLASMA_ROLL' })).toBe(false)
  })

  it('leaves the pre-skip state intact so undo can restore it', () => {
    const state = main(game())
    state.phase = 'energy'
    state.energyPool = 2
    const skipped = applyAction(state, { type: 'SKIP_ENERGY' })
    expect(skipped.phase).toBe('end')
    expect(skipped.energyPool).toBe(0)
    expect(state.phase).toBe('energy')
    expect(state.energyPool).toBe(2)
  })
})
