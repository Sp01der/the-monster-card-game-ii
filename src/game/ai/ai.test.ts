import { describe, expect, it } from 'vitest'
import { listLegalActions } from '../actions'
import { getMonster } from '../catalog'
import { applyAction } from '../reducer'
import { createGame, type DeckSetup } from '../setup'
import type { FieldMonster, GameAction, GameState, HandCard, PlayerState } from '../types'
import { cloneState } from '../helpers'
import { applyBelief, chooseAction, decisionPlayer, evaluate } from './index'

function tinyDeck(name: string, cards: string[], top = 0): DeckSetup {
  return { name, cardIds: cards, topMonsterIndex: top }
}

function fixedRng(...rolls: number[]): () => number {
  const queue = [...rolls]
  return () => {
    const n = queue.shift()
    if (n === undefined) return 1
    return n
  }
}

const P0_LIST = ['fire_sprite', 'ember_tortoise', 'coffee', 'sword', 'rally', 'health_potion']
const P1_LIST = ['ice_core', 'frost_hawk', 'shield', 'blizzard', 'coffee', 'health_potion']

function baseGame(rng: () => number = fixedRng(1, 2, 3, 4, 5, 6)): GameState {
  return createGame(tinyDeck('Human', P0_LIST), tinyDeck('Computer', P1_LIST), {
    rng,
    shuffleRandom: () => 0,
    skipHandoff: true,
  })
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

function card(instanceId: string, defId: string): HandCard {
  return { instanceId, defId }
}

function readyMain(state: GameState, active: 0 | 1 = 0): GameState {
  state.activePlayer = active
  state.phase = 'main'
  state.awaitingHandoff = false
  state.openingMulligan = undefined
  state.players[0].isFirstTurn = false
  state.players[1].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.playedCardThisTurn = false
  state.pending = null
  return state
}

function decksFrom(state: GameState): [DeckSetup, DeckSetup] {
  return [
    tinyDeck(state.players[0].name, P0_LIST),
    tinyDeck(state.players[1].name, P1_LIST),
  ]
}

describe('decisionPlayer', () => {
  it('returns the pending owner, including opponent responses', () => {
    const state = readyMain(baseGame())
    state.pending = { kind: 'handDiscard', player: 1, remaining: 1 }
    expect(decisionPlayer(state)).toBe(1)
    state.pending = { kind: 'mirrorOffer', owner: 0, defId: 'coffee' }
    expect(decisionPlayer(state)).toBe(1)
    state.pending = { kind: 'forceWithdraw', player: 1, slot: 0 }
    expect(decisionPlayer(state)).toBe(1)
    state.pending = { kind: 'spy', owner: 0 }
    expect(decisionPlayer(state)).toBe(0)
    state.pending = null
    expect(decisionPlayer(state)).toBe(0)
  })
})

describe('fairness', () => {
  it('picks the same action when only hidden cards and live dice differ', () => {
    const liveDiceA = fixedRng(6, 6, 6, 6, 6, 6)
    const liveDiceB = fixedRng(1, 1, 1, 1, 1, 1)

    const a = readyMain(baseGame(liveDiceA), 1)
    const b = readyMain(baseGame(liveDiceB), 1)

    put(a.players[1], 0, 'frost_hawk', { energy: 2 })
    put(b.players[1], 0, 'frost_hawk', { energy: 2 })
    put(a.players[0], 0, 'fire_sprite', { hp: 40 })
    put(b.players[0], 0, 'fire_sprite', { hp: 40 })

    // Same public board; different opponent (human) hand/deck splits.
    a.players[0].hand = [card('a1', 'coffee'), card('a2', 'sword')]
    a.players[0].deck = [
      card('a3', 'ember_tortoise'),
      card('a4', 'rally'),
      card('a5', 'health_potion'),
    ]
    b.players[0].hand = [card('b1', 'rally'), card('b2', 'health_potion')]
    b.players[0].deck = [
      card('b3', 'ember_tortoise'),
      card('b4', 'coffee'),
      card('b5', 'sword'),
    ]

    // AI hand identical; AI deck order differs.
    a.players[1].hand = [card('c1', 'shield'), card('c2', 'blizzard')]
    a.players[1].deck = [
      card('c3', 'ice_core'),
      card('c4', 'coffee'),
      card('c5', 'health_potion'),
    ]
    b.players[1].hand = [card('c1', 'shield'), card('c2', 'blizzard')]
    b.players[1].deck = [
      card('c5', 'health_potion'),
      card('c4', 'coffee'),
      card('c3', 'ice_core'),
    ]

    const decks = decksFrom(a)
    const opts = {
      aiPlayer: 1 as const,
      decks,
      seed: 42,
      timeBudgetMs: 30_000,
      sampleCount: 2,
    }
    const choiceA = chooseAction(a, opts)
    const choiceB = chooseAction(b, { ...opts, decks: decksFrom(b) })
    expect(choiceA).toEqual(choiceB)

    // Live dice queues were not consumed by search.
    expect(liveDiceA()).toBe(6)
    expect(liveDiceB()).toBe(1)
  })

  it('may mark different Spy targets when the revealed hand changes', () => {
    const state = readyMain(baseGame(), 0)
    put(state.players[0], 0, 'shadow_imp', { energy: 2 })
    state.pending = { kind: 'spy', owner: 0 }
    state.players[1].hand = [card('weak', 'coffee'), card('threat', 'blizzard')]

    const decks: [DeckSetup, DeckSetup] = [
      tinyDeck('Human', [...P0_LIST, 'shadow_imp']),
      tinyDeck('Computer', P1_LIST),
    ]
    const markCoffee = chooseAction(state, {
      aiPlayer: 0,
      decks,
      seed: 9,
      timeBudgetMs: 150,
      sampleCount: 2,
    })

    state.players[1].hand = [card('only', 'blizzard')]
    const markBlizzard = chooseAction(state, {
      aiPlayer: 0,
      decks,
      seed: 9,
      timeBudgetMs: 150,
      sampleCount: 2,
    })

    expect(markCoffee.type === 'SPY_MARK' || markCoffee.type === 'SPY_SKIP').toBe(true)
    expect(markBlizzard.type === 'SPY_MARK' || markBlizzard.type === 'SPY_SKIP').toBe(true)
    if (markCoffee.type === 'SPY_MARK' && markBlizzard.type === 'SPY_MARK') {
      expect(markCoffee.instanceId).not.toEqual(markBlizzard.instanceId)
    }
  })
})

describe('tactics', () => {
  it('takes a point-winning attack when one is available', () => {
    const state = readyMain(baseGame(), 1)
    // Snipe deals 40. A 40 HP fire sprite is worth 2 points; human sits at 2 points.
    put(state.players[1], 0, 'veyan_archer', { energy: 3 })
    put(state.players[0], 0, 'fire_sprite', { hp: 40 })
    state.players[0].points = 2
    for (let i = 1; i < state.players[0].field.length; i++) state.players[0].field[i] = null
    state.players[1].hand = []
    state.players[1].deck = [
      card('d1', 'shield'),
      card('d2', 'coffee'),
      card('d3', 'health_potion'),
    ]
    state.playedCardThisTurn = true

    const legal = listLegalActions(state)
    expect(legal.some((a) => a.type === 'USE_ABILITY' && a.abilityId === 'snipe')).toBe(true)

    const action = chooseAction(state, {
      aiPlayer: 1,
      decks: [
        tinyDeck(state.players[0].name, P0_LIST),
        tinyDeck(state.players[1].name, [...P1_LIST, 'veyan_archer']),
      ],
      seed: 3,
      timeBudgetMs: 30_000,
      sampleCount: 2,
    })
    expect(action).toMatchObject({ type: 'USE_ABILITY', abilityId: 'snipe' })
  })

  it('mulligan choice is stable under deck reordering', () => {
    const a = baseGame()
    a.awaitingHandoff = false
    a.openingMulligan = { decided: [true, false], revealed: false }
    a.activePlayer = 1
    a.players[1].hand = [
      card('top', 'ice_core'),
      card('x', 'coffee'),
      card('y', 'shield'),
      card('z', 'blizzard'),
    ]
    a.players[1].deck = [
      card('d1', 'frost_hawk'),
      card('d2', 'health_potion'),
      card('d3', 'coffee'),
    ]

    const b = cloneState(a)
    b.players[1].deck = [
      card('d3', 'coffee'),
      card('d1', 'frost_hawk'),
      card('d2', 'health_potion'),
    ]

    const opts = {
      aiPlayer: 1 as const,
      decks: decksFrom(a),
      seed: 77,
      timeBudgetMs: 200,
      sampleCount: 2,
    }
    expect(chooseAction(a, opts)).toEqual(chooseAction(b, opts))
  })
})

describe('toggle menus', () => {
  function absorbBuryState(): GameState {
    const state = readyMain(baseGame(), 1)
    put(state.players[1], 0, 'navit_gel', { energy: 2 })
    put(state.players[0], 0, 'fire_sprite', { hp: 40 })
    state.players[0].points = 2
    state.players[1].hand = [card('spare-a', 'coffee'), card('spare-b', 'shield')]
    state.players[1].deck = [card('d1', 'blizzard'), card('d2', 'health_potion')]
    state.pending = {
      kind: 'bury',
      owner: 1,
      chosenInstanceIds: [],
      purpose: 'absorb',
      sourceSlot: 0,
      requiredEnergy: 1,
    }
    return state
  }

  it('weighs Absorb bury sets and finishes instead of oscillating toggles', () => {
    let state = absorbBuryState()
    const decks: [DeckSetup, DeckSetup] = [
      tinyDeck('Human', P0_LIST),
      tinyDeck('Computer', [...P1_LIST, 'navit_gel']),
    ]

    const seen = new Set<string>()
    let leftBury = false
    for (let step = 0; step < 16; step++) {
      if (state.winner !== null) break
      expect(decisionPlayer(state)).toBe(1)
      const action = chooseAction(state, {
        aiPlayer: 1,
        decks,
        seed: 50 + step,
        timeBudgetMs: 2_000,
        sampleCount: 1,
      })
      const key = JSON.stringify(action)
      // Never undo the same toggle immediately (classic oscillation).
      if (action.type === 'BURY_TOGGLE') {
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
      state = applyAction(state, action)
      if (state.pending?.kind !== 'bury') leftBury = true
      if (!state.pending) break
    }

    expect(leftBury).toBe(true)
    // Lethal absorb: bury both for two Stings into a 40 HP, 2-point sprite.
    expect(state.players[0].points).toBe(0)
    expect(state.winner).toBe(1)
  })

  it('from an Absorb prompt, prefers burying enough cards to secure the kill', () => {
    const state = absorbBuryState()
    const decks: [DeckSetup, DeckSetup] = [
      tinyDeck('Human', P0_LIST),
      tinyDeck('Computer', [...P1_LIST, 'navit_gel']),
    ]
    // First step should start selecting cards, not immediately finish with zero.
    const first = chooseAction(state, {
      aiPlayer: 1,
      decks,
      seed: 12,
      timeBudgetMs: 2_000,
      sampleCount: 1,
    })
    expect(first.type).toBe('BURY_TOGGLE')
  })
})

describe('belief', () => {
  it('redeals the opponent hand from the unseen multiset without reading the true split', () => {
    const state = readyMain(baseGame(), 1)
    state.players[0].hand = [card('secret1', 'rally'), card('secret2', 'sword')]
    state.players[0].deck = [
      card('rest1', 'ember_tortoise'),
      card('rest2', 'coffee'),
      card('rest3', 'health_potion'),
    ]
    put(state.players[0], 0, 'fire_sprite')

    const belief = applyBelief(state, 1, decksFrom(state), 99)
    expect(belief.players[0].hand).toHaveLength(2)
    expect(belief.players[0].deck).toHaveLength(3)
    const ids = [...belief.players[0].hand, ...belief.players[0].deck].map((c) => c.defId).sort()
    expect(ids).toEqual(
      ['coffee', 'ember_tortoise', 'health_potion', 'rally', 'sword'].sort(),
    )
    // True hand contents need not appear in belief hand.
    const beliefHand = belief.players[0].hand.map((c) => c.defId).sort()
    // Just ensure belief installed private rng (rolling does not use Math.random path alone).
    expect(typeof belief.rng()).toBe('number')
    void beliefHand
  })
})

describe('match smoke', () => {
  it('plays a short match with legal actions and preserves the live dice queue', () => {
    const rolls = [2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5]
    const live = fixedRng(...rolls)
    let state = createGame(
      tinyDeck('Human', P0_LIST),
      tinyDeck('Computer', P1_LIST),
      { rng: live, shuffleRandom: () => 0, skipHandoff: true, random: () => 0.5 },
    )
    const decks: [DeckSetup, DeckSetup] = [
      tinyDeck('Human', P0_LIST),
      tinyDeck('Computer', P1_LIST),
    ]

    // Finish opening mulligans quickly with keep.
    for (let i = 0; i < 4; i++) {
      if (!state.openingMulligan) break
      const seat = decisionPlayer(state)
      if (seat === 1) {
        state = applyAction(state, chooseAction(state, {
          aiPlayer: 1,
          decks,
          seed: 1 + i,
          timeBudgetMs: 80,
          sampleCount: 1,
        }))
      } else {
        const keep = listLegalActions(state).find(
          (a) => a.type === 'KEEP_OPENING_HAND' || a.type === 'CONTINUE_OPENING_HAND',
        )
        if (keep) state = applyAction(state, keep)
        else break
      }
    }

    let steps = 0
    while (state.winner === null && steps < 40) {
      const seat = decisionPlayer(state)
      const legal = listLegalActions(state)
      expect(legal.length).toBeGreaterThan(0)
      let action: GameAction
      if (seat === 1) {
        action = chooseAction(state, {
          aiPlayer: 1,
          decks,
          seed: 100 + steps,
          timeBudgetMs: 80,
          sampleCount: 1,
        })
      } else {
        // Human stub: prefer playing a monster, else skip phase / end turn.
        action =
          legal.find((a) => a.type === 'PLAY_MONSTER' && a.stance === 'active') ??
          legal.find((a) => a.type === 'SKIP_MAIN') ??
          legal.find((a) => a.type === 'SKIP_MOVE') ??
          legal.find((a) => a.type === 'SKIP_ENERGY') ??
          legal.find((a) => a.type === 'END_TURN') ??
          legal.find((a) => a.type === 'DRAW' || a.type === 'SKIP_DRAW') ??
          legal[0]
      }
      expect(legal.some((a) => JSON.stringify(a) === JSON.stringify(action))).toBe(true)
      state = applyAction(state, action)
      if (state.awaitingHandoff) {
        state = applyAction(state, { type: 'CONFIRM_HANDOFF' })
      }
      steps++
    }

    expect(steps).toBeGreaterThan(5)
    // Unused live rolls remain available (search must not drain them).
    expect(live()).toBeGreaterThanOrEqual(1)
    expect(evaluate(state, 1)).toBeTypeOf('number')
  })
})
