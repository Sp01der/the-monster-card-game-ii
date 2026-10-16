import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getMonster } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, HandCard, PlayerState } from './types'

function game(rolls: number[] = [1], randomValues: number[] = [0]): GameState {
  let rollIndex = 0
  let randomIndex = 0
  return createGame(
    {
      name: 'P1',
      cardIds: ['fisher_mirel', 'navit_gel', 'blubis_eel', 'whirlpool'],
      topMonsterIndex: 0,
    },
    {
      name: 'P2',
      cardIds: ['hydro_core', 'drowned_pirate', 'water_lizel', 'blob'],
      topMonsterIndex: 0,
    },
    {
      skipHandoff: true,
      shuffleRandom: () => 0,
      rng: () => rolls[rollIndex++] ?? rolls.at(-1) ?? 1,
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

function card(instanceId: string, defId: string): HandCard {
  return { instanceId, defId }
}

describe('water card catalog', () => {
  it('defines the requested stats, flags, and low-face rolls', () => {
    expect(getMonster('fisher_mirel')).toMatchObject({ points: 2, maxHp: 80 })
    expect(getMonster('drowned_pirate')).toMatchObject({ weakness: 'light' })
    expect(getMonster('hydro_core')).toMatchObject({ weakness: 'ice' })
    expect(getMonster('navit_gel')).toMatchObject({ weakness: 'fire' })
    expect(getMonster('blubis_eel')).toMatchObject({ points: 4, maxHp: 160, weakness: 'ice' })
    expect(getMonster('blubis_eel').abilities.find((a) => a.id === 'hunt')?.cost).toEqual({
      require: 1,
      spend: 1,
    })

    const pirate = getMonster('drowned_pirate')
    expect(pirate.abilities.find((a) => a.id === 'sunken_plunder')?.ranged).toBe(true)
    const snap = getMonster('blubis_eel').abilities.find((a) => a.id === 'snap')
    expect(snap?.effects[0]).toMatchObject({ successFaces: [1, 2] })
  })
})

describe('water card abilities', () => {
  it('Fish draws during main as a free action and is unavailable on an empty deck', () => {
    let state = main(game())
    put(state.players[0], 0, 'fisher_mirel', { energy: 2 })
    state.players[0].hand = []
    state.players[0].deck = [card('drawn', 'blob')]

    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'fish'),
    )
    expect(state.players[0].hand.map((c) => c.instanceId)).toEqual(['drawn'])
    expect(state.abilityUsesLeft).toBe(1)
    expect(state.actedSlots).toEqual([0])

    state.actedSlots = []
    expect(
      listLegalActions(state).some((a) => a.type === 'USE_ABILITY' && a.abilityId === 'fish'),
    ).toBe(false)
  })

  it('Mudball rolls a six for 10 water damage and Wet', () => {
    let state = main(game([6]))
    put(state.players[0], 0, 'fisher_mirel', { energy: 1 })
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'mudball'),
    )
    expect(state.players[1].field[0]!.hp).toBe(60)
    expect(state.players[1].field[0]!.statuses.some((s) => s.kind === 'wet')).toBe(true)
  })

  it('does not treat energy required by Splash as spare Sword energy', () => {
    let state = main(game())
    put(state.players[0], 0, 'hydro_core', {
      energy: 1,
      equipment: [{ instanceId: 'sword', defId: 'sword', hp: 20, maxHp: 20 }],
    })
    put(state.players[1], 0, 'leecher')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'splash'),
    )
    expect(state.players[1].field[0]!.hp).toBe(50)
  })

  it('retrieves an exact chosen card from either discard pile', () => {
    let state = main(game())
    put(state.players[0], 0, 'drowned_pirate', { energy: 3 })
    state.players[0].discard = [card('own-a', 'blob'), card('own-b', 'shield')]

    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'lost_treasure'),
    )
    state = applyAction(state, { type: 'PICK_DISCARD', instanceId: 'own-b' })
    expect(state.players[0].hand.some((c) => c.instanceId === 'own-b')).toBe(true)
    expect(state.players[0].discard.map((c) => c.instanceId)).toEqual(['own-a'])

    state.actedSlots = []
    state.abilityUsesLeft = 1
    state.players[0].field[0]!.energy = 3
    state.players[1].discard = [card('stolen', 'energy_crystal')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'sunken_plunder'),
    )
    state = applyAction(state, { type: 'PICK_DISCARD', instanceId: 'stolen' })
    expect(state.players[0].hand.some((c) => c.instanceId === 'stolen')).toBe(true)
    expect(state.players[1].discard).toHaveLength(0)
  })

  it('Tentacle Attack requests three independently targeted hits', () => {
    let state = main(game())
    put(state.players[0], 0, 'navit_gel', { energy: 3 })
    put(state.players[1], 0, 'water_lizel')
    put(state.players[1], 1, 'leecher')
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'tentacle_attack'),
    )
    expect(state.pending).toMatchObject({ kind: 'multiHit', remaining: 3, amount: 20 })
    state = applyAction(
      state,
      action(state, (a) => a.type === 'PENDING_TARGET' && a.target.slot === 0),
    )
    state = applyAction(
      state,
      action(state, (a) => a.type === 'PENDING_TARGET' && a.target.slot === 1),
    )
    expect(state.pending).toMatchObject({ kind: 'multiHit', remaining: 1 })
  })

  it('Absorb buries selected cards at random positions and creates one Sting per card', () => {
    let state = main(game([1], [0, 0.999]))
    put(state.players[0], 0, 'navit_gel', { energy: 1 })
    put(state.players[1], 0, 'water_lizel')
    state.players[0].hand = [card('bury-a', 'blob'), card('bury-b', 'shield')]
    state.players[0].deck = [card('deck-a', 'coffee'), card('deck-b', 'orc')]

    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'absorb'),
    )
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'bury-a' })
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'bury-b' })
    state = applyAction(state, { type: 'BURY_FINISH' })

    expect(state.players[0].hand).toHaveLength(0)
    expect(state.players[0].deck.map((c) => c.instanceId)).toEqual([
      'bury-a', 'deck-a', 'deck-b', 'bury-b',
    ])
    expect(state.pending).toMatchObject({
      kind: 'multiHit',
      remaining: 2,
      amount: 20,
      damageType: 'poison',
    })
  })

  it('Hunt combines its base damage with 30 per buried card', () => {
    let state = main(game())
    put(state.players[0], 0, 'blubis_eel', {
      energy: 2,
      equipment: [{ instanceId: 'sword', defId: 'sword', hp: 20, maxHp: 20 }],
    })
    put(state.players[1], 0, 'water_lizel')
    state.players[0].hand = [card('bury-a', 'blob'), card('bury-b', 'shield')]

    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'hunt'),
    )
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'bury-a' })
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'bury-b' })
    state = applyAction(state, { type: 'BURY_FINISH' })
    expect(state.players[1].field[0]!.hp).toBe(20)
  })

  it('Whirlpool deals one combined water attack based on cards buried', () => {
    let state = main(game())
    put(state.players[0], 0, 'fisher_mirel')
    put(state.players[1], 0, 'water_lizel')
    state.players[0].hand = [
      card('whirlpool', 'whirlpool'),
      card('bury-a', 'blob'),
      card('bury-b', 'shield'),
    ]

    state = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'bury-a' })
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'bury-b' })
    state = applyAction(state, { type: 'BURY_FINISH' })
    expect(state.players[1].field[0]!.hp).toBe(60)
  })

  it('Churn the Waters buries first, then can redraw a newly buried card', () => {
    let state = main(game([1], [0]))
    put(state.players[0], 0, 'fisher_mirel')
    state.players[0].hand = [
      card('churn', 'churn_waters'),
      card('buried', 'blob'),
    ]
    state.players[0].deck = [card('old-top', 'shield')]

    state = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    state = applyAction(state, { type: 'BURY_TOGGLE', instanceId: 'buried' })
    state = applyAction(state, { type: 'BURY_FINISH' })

    expect(state.players[0].hand.map((c) => c.instanceId)).toEqual(['buried'])
    expect(state.players[0].deck.map((c) => c.instanceId)).toEqual(['old-top'])
  })
})
