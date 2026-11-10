import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { HAND_SIZE_LIMIT } from './types'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { GameState, HandCard } from './types'

function game(): GameState {
  return createGame(
    {
      name: 'Alice',
      cardIds: ['blob', 'coffee', 'sword', 'health_potion', 'rally', 'fire_sprite', 'ember_tortoise'],
      topMonsterIndex: 0,
    },
    {
      name: 'Bob',
      cardIds: ['ice_core', 'shield', 'coffee', 'blizzard', 'frost_hawk', 'winter_wizard', 'chill_sprite'],
      topMonsterIndex: 0,
    },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
  )
}

function padHand(state: GameState, size: number) {
  const player = state.players[0]
  let n = 0
  while (player.hand.length < size) {
    player.hand.push({
      instanceId: `pad-${n++}`,
      defId: 'coffee',
    } satisfies HandCard)
  }
}

describe('hand size limit', () => {
  it(`forces a discard down to ${HAND_SIZE_LIMIT} when finishing the energy phase`, () => {
    let state = game()
    state.phase = 'energy'
    state.energyPool = 1
    state.players[0].field[0] = {
      instanceId: 'm0',
      defId: 'blob',
      hp: 50,
      maxHp: 50,
      stance: 'active',
      energy: 0,
      pendingEnergy: 0,
      statuses: [],
      equipment: [],
    }
    padHand(state, HAND_SIZE_LIMIT + 2)

    state = applyAction(state, { type: 'SKIP_ENERGY' })
    expect(state.phase).toBe('end')
    expect(state.pending).toMatchObject({
      kind: 'handDiscard',
      player: 0,
      remaining: 2,
    })
    expect(listLegalActions(state).every((a) => a.type === 'DISCARD_FROM_HAND')).toBe(true)
    expect(listLegalActions(state).some((a) => a.type === 'END_TURN')).toBe(false)

    const first = listLegalActions(state).find((a) => a.type === 'DISCARD_FROM_HAND')
    expect(first?.type).toBe('DISCARD_FROM_HAND')
    state = applyAction(state, first!)
    expect(state.pending).toMatchObject({ kind: 'handDiscard', remaining: 1 })
    expect(state.players[0].hand).toHaveLength(HAND_SIZE_LIMIT + 1)

    const second = listLegalActions(state).find((a) => a.type === 'DISCARD_FROM_HAND')
    state = applyAction(state, second!)
    expect(state.pending).toBeNull()
    expect(state.players[0].hand).toHaveLength(HAND_SIZE_LIMIT)
    expect(listLegalActions(state).some((a) => a.type === 'END_TURN')).toBe(true)

    state = applyAction(state, { type: 'END_TURN' })
    expect(state.awaitingHandoff).toBe(true)
    expect(state.activePlayer).toBe(1)
  })

  it('does not prompt when the hand is already at the limit', () => {
    let state = game()
    state.phase = 'energy'
    state.energyPool = 0
    while (state.players[0].hand.length > HAND_SIZE_LIMIT) state.players[0].hand.pop()
    while (state.players[0].hand.length < HAND_SIZE_LIMIT) {
      state.players[0].hand.push({ instanceId: `keep-${state.players[0].hand.length}`, defId: 'coffee' })
    }

    state = applyAction(state, { type: 'END_TURN' })
    expect(state.pending).toBeNull()
    expect(state.awaitingHandoff).toBe(true)
    expect(state.players[0].hand).toHaveLength(HAND_SIZE_LIMIT)
  })

  it('triggers from END_TURN while still in the energy phase', () => {
    let state = game()
    state.phase = 'energy'
    state.energyPool = 0
    padHand(state, HAND_SIZE_LIMIT + 1)

    state = applyAction(state, { type: 'END_TURN' })
    expect(state.phase).toBe('end')
    expect(state.pending).toMatchObject({
      kind: 'handDiscard',
      player: 0,
      remaining: 1,
    })
    expect(state.endStepResolved).toBe(false)
  })
})
