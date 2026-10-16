import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard, getMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, HandCard, PlayerState } from './types'

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['lantern_wisp', 'dawn_acolyte', 'daybreak', 'coffee'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['winter_wizard', 'prism_lens', 'leecher', 'coffee'], topMonsterIndex: 0 },
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
  if (!found) throw new Error(`Action not found: ${listLegalActions(state).map((a) => JSON.stringify(a))}`)
  return found
}

function card(instanceId: string, defId: string): HandCard {
  return { instanceId, defId }
}

describe('light support cards', () => {
  it('adds a small splash package', () => {
    expect(getMonster('lantern_wisp')).toMatchObject({ points: 1, maxHp: 50, families: ['light'] })
    expect(getMonster('dawn_acolyte')).toMatchObject({ points: 2, maxHp: 70, weakness: 'ice' })
    expect(getCard('daybreak')).toMatchObject({ kind: 'effect' })
    expect(getCard('prism_lens')).toMatchObject({ kind: 'equipment', maxHp: 20 })
  })

  it('Gleam lets another element trigger Light weakness without a second multiplier', () => {
    let state = main(game())
    put(state.players[0], 0, 'lantern_wisp', { energy: 1 })
    put(state.players[0], 1, 'fire_sprite', { energy: 1, hp: 80 })
    put(state.players[1], 0, 'winter_wizard')

    state = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'gleam' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 1,
      ),
    )
    expect(state.abilityUsesLeft).toBe(1)
    expect(state.players[0].field[1]?.hp).toBe(90)
    expect(state.players[0].field[1]?.illuminatedThisTurn).toBe(true)

    state = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'fire_punch' &&
          candidate.choice === 'firePunchFull',
      ),
    )
    expect(state.players[1].field[0]?.hp).toBe(40)
  })

  it('Gleam can heal the Wisp itself', () => {
    let state = main(game())
    put(state.players[0], 0, 'lantern_wisp', { energy: 1, hp: 30 })
    state = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'gleam' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 0,
      ),
    )
    expect(state.players[0].field[0]?.hp).toBe(40)
    expect(state.players[0].field[0]?.illuminatedThisTurn).toBe(true)
  })

  it('Chorus deals 20 light damage plus 10 for each other monster', () => {
    let state = main(game())
    put(state.players[0], 0, 'dawn_acolyte', { energy: 2 })
    put(state.players[0], 1, 'blob')
    put(state.players[0], 2, 'orc')
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'chorus'),
    )
    expect(state.players[1].field[0]?.hp).toBe(30)
  })

  it('Healing Light clears statuses from any monster and heals it 20', () => {
    let state = main(game())
    put(state.players[0], 0, 'dawn_acolyte', { energy: 1 })
    put(state.players[1], 0, 'leecher', {
      hp: 40,
      statuses: [{ kind: 'poison', turns: 3, skipNextTick: false }],
    })
    state = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'healing_light' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.player === 1,
      ),
    )
    expect(state.players[1].field[0]?.statuses).toEqual([])
    expect(state.players[1].field[0]?.hp).toBe(60)
  })

  it('Daybreak damages a withdrawn enemy and advances it', () => {
    let state = main(game())
    put(state.players[1], 0, 'winter_wizard', { stance: 'withdrawn' })
    state.players[0].hand = [card('day', 'daybreak')]
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PLAY_EFFECT'),
    )
    expect(state.players[1].field[0]?.hp).toBe(60)
    expect(state.players[1].field[0]?.stance).toBe('active')
  })

  it('Prism Lens illuminates attacks and adds one successful die face', () => {
    let state = main(game())
    put(state.players[0], 0, 'orc', {
      energy: 1,
      equipment: [{ instanceId: 'lens', defId: 'prism_lens', hp: 20, maxHp: 20 }],
    })
    put(state.players[1], 0, 'winter_wizard')
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'blood_thirsty'),
    )
    expect(state.players[1].field[0]?.hp).toBe(70)

    state = main(game())
    put(state.players[0], 0, 'orc', {
      energy: 2,
      equipment: [{ instanceId: 'lens', defId: 'prism_lens', hp: 20, maxHp: 20 }],
    })
    put(state.players[1], 0, 'winter_wizard')
    state = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'cruel_scimitar'),
    )
    expect(state.players[1].field[0]?.hp).toBe(30)
  })

  it('Daybreak does not advance a slain or immobilized monster', () => {
    let state = main(game())
    put(state.players[1], 0, 'blob', { stance: 'withdrawn', hp: 10 })
    state.players[0].hand = [card('day', 'daybreak')]
    state = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(state.players[1].field[0]).toBeNull()

    state = main(game())
    put(state.players[1], 0, 'winter_wizard', {
      stance: 'withdrawn',
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    state.players[0].hand = [card('day2', 'daybreak')]
    state = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(state.players[1].field[0]?.stance).toBe('withdrawn')
  })

  it('clears Gleam illumination at the start of that controller’s next turn', () => {
    let state = main(game())
    put(state.players[0], 0, 'lantern_wisp', { energy: 1 })
    put(state.players[0], 1, 'blob')
    state = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'gleam' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 1,
      ),
    )
    expect(state.players[0].field[1]?.illuminatedThisTurn).toBe(true)
    state.phase = 'draw'
    state = applyAction(state, { type: 'SKIP_DRAW' })
    expect(state.players[0].field[1]?.illuminatedThisTurn).toBe(false)
  })
})
