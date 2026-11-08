import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { GameAction, GameState } from './types'

function must<T extends GameAction['type']>(state: GameState, type: T): Extract<GameAction, { type: T }> {
  const action = listLegalActions(state).find((candidate) => candidate.type === type)
  if (!action || action.type !== type) {
    throw new Error(`Expected ${type}, got ${listLegalActions(state).map((candidate) => candidate.type).join(', ')}`)
  }
  return action as Extract<GameAction, { type: T }>
}

function game(): GameState {
  return createGame(
    {
      name: 'Ada',
      cardIds: ['blob', 'ice_core', 'snapatrap', 'coffee', 'sword', 'health_potion', 'rally', 'shield'],
      topMonsterIndex: 0,
    },
    {
      name: 'Bea',
      cardIds: ['fire_sprite', 'ember_tortoise', 'bomber_beetle', 'ruby_ring', 'coffee', 'sword'],
      topMonsterIndex: 0,
    },
    { shuffleRandom: () => 0, skipHandoff: false, rng: () => 1, random: () => 0 },
  )
}

describe('opening hand', () => {
  it('offers one keep or redraw before either player can act', () => {
    let state = game()
    expect(listLegalActions(state).map((action) => action.type)).toEqual(['CONFIRM_HANDOFF'])

    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    expect(listLegalActions(state).map((action) => action.type)).toEqual([
      'KEEP_OPENING_HAND',
      'REDRAW_OPENING_HAND',
    ])
    expect(listLegalActions(state).some((action) => action.type === 'PLAY_MONSTER')).toBe(false)
  })

  it('keeps the top monster, draws the new cards first, then shuffles the old cards into the deck', () => {
    let state = game()
    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    const ada = state.players[0]
    const top = ada.hand[0]
    const replaced = ada.hand.slice(1).map((card) => card.instanceId)
    const drawn = ada.deck.slice(0, replaced.length).map((card) => card.instanceId)

    state = applyAction(state, must(state, 'REDRAW_OPENING_HAND'))
    expect(state.players[0].hand[0].instanceId).toBe(top.instanceId)
    expect(state.players[0].hand.slice(1).map((card) => card.instanceId)).toEqual(drawn)
    expect(state.players[0].hand).toHaveLength(4)
    for (const id of replaced) {
      expect(state.players[0].deck.some((card) => card.instanceId === id)).toBe(true)
      expect(state.players[0].hand.some((card) => card.instanceId === id)).toBe(false)
    }
    expect(listLegalActions(state).map((action) => action.type)).toEqual(['CONTINUE_OPENING_HAND'])

    state = applyAction(state, must(state, 'CONTINUE_OPENING_HAND'))
    expect(state.activePlayer).toBe(1)
    expect(state.awaitingHandoff).toBe(true)
    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    const beaHand = state.players[1].hand.map((card) => card.instanceId)
    state = applyAction(state, must(state, 'KEEP_OPENING_HAND'))
    expect(state.players[1].hand.map((card) => card.instanceId)).toEqual(beaHand)
    expect(state.openingMulligan).toBeUndefined()
    expect(state.activePlayer).toBe(0)
    expect(state.awaitingHandoff).toBe(true)

    state = applyAction(state, must(state, 'CONFIRM_HANDOFF'))
    expect(listLegalActions(state).some((action) => action.type === 'PLAY_MONSTER')).toBe(true)
  })
})
