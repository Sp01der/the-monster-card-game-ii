import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { countsAsPoisonCard, countPoisonCardsInPlay, getMonster, hasDarkCharge } from './catalog'
import { computeDamage } from './damage'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, HandCard, PlayerState } from './types'

function game(): GameState {
  return createGame(
    {
      name: 'P1',
      cardIds: ['shadow_imp', 'grief_soldier', 'imilthian_alchemist', 'famine'],
      topMonsterIndex: 0,
    },
    {
      name: 'P2',
      cardIds: ['blob', 'leecher', 'shield', 'coffee'],
      topMonsterIndex: 0,
    },
    {
      skipHandoff: true,
      shuffleRandom: () => 0,
      rng: () => 1,
    },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  const def = getMonster(defId)
  player.field[slot] = {
    instanceId: `${player.id}-${slot}-${defId}`,
    hp: def.maxHp,
    maxHp: def.maxHp,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    defId,
    ...extra,
  }
}

function card(instanceId: string, defId: string): HandCard {
  return { instanceId, defId }
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

describe('shadow card catalog', () => {
  it('defines the new cards and Dark Charge', () => {
    expect(getMonster('shadow_imp')).toMatchObject({ points: 1, maxHp: 50, weakness: 'light', darkCharge: true })
    expect(getMonster('grief_soldier')).toMatchObject({ points: 2, maxHp: 80, weakness: 'light', darkCharge: true })
    expect(getMonster('imilthian_alchemist')).toMatchObject({
      points: 2,
      maxHp: 90,
      weakness: 'light',
      darkCharge: true,
    })
    expect(getMonster('shadow_imp').passiveText).toBeUndefined()
    expect(getMonster('grief_soldier').passiveText).toBeUndefined()
    expect(getMonster('imilthian_alchemist').passiveText).toBeUndefined()
    expect(countsAsPoisonCard('imilthian_alchemist')).toBe(true)
    expect(countsAsPoisonCard('leecher')).toBe(true)
    expect(countsAsPoisonCard('blob')).toBe(false)
  })
})

describe('Shadow Imp', () => {
  it('Pilfer deals 10 shadow and forces the opponent to discard', () => {
    let state = main(game())
    put(state.players[0], 0, 'shadow_imp', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state.players[1].hand = [card('keep', 'shield'), card('toss', 'coffee')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'pilfer'),
    )
    expect(state.players[1].field[0]?.hp).toBe(40)
    expect(state.pending).toMatchObject({ kind: 'handDiscard', player: 1, remaining: 1 })
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'toss' })
    expect(state.players[1].hand.map((entry) => entry.instanceId)).toEqual(['keep'])
    expect(state.pending).toBeNull()
  })

  it('Spy marks a card that must be discarded next', () => {
    let state = main(game())
    put(state.players[0], 0, 'shadow_imp', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state.players[1].hand = [card('keep', 'shield'), card('marked', 'coffee')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'spy'),
    )
    expect(state.pending).toEqual({ kind: 'spy', owner: 0 })
    state = applyAction(state, { type: 'SPY_MARK', instanceId: 'marked' })
    expect(state.players[1].spyMarkInstanceId).toBe('marked')
    expect(listLegalActions(state).some((a) => a.type === 'USE_ABILITY')).toBe(false)

    state.abilityUsesLeft = 1
    state.actedSlots = []
    state.players[0].field[0]!.energy = 2
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'pilfer'),
    )
    const discards = listLegalActions(state).filter((a) => a.type === 'DISCARD_FROM_HAND')
    expect(discards).toEqual([{ type: 'DISCARD_FROM_HAND', instanceId: 'marked' }])
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'marked' })
    expect(state.players[1].spyMarkInstanceId).toBeUndefined()
    expect(state.players[1].hand.map((entry) => entry.instanceId)).toEqual(['keep'])
  })
})

describe('Famine', () => {
  it('makes the active player discard first, then the opponent', () => {
    let state = main(game())
    put(state.players[0], 0, 'shadow_imp')
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [card('famine-card', 'famine'), card('p1', 'coffee')]
    state.players[1].hand = [card('p2', 'shield')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(state.pending).toMatchObject({ kind: 'handDiscard', player: 0, remaining: 1, thenPlayers: [1] })
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'p1' })
    expect(state.pending).toMatchObject({ kind: 'handDiscard', player: 1, remaining: 1 })
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'p2' })
    expect(state.pending).toBeNull()
    expect(state.players[0].discard.some((entry) => entry.instanceId === 'p1')).toBe(true)
    expect(state.players[1].discard.some((entry) => entry.instanceId === 'p2')).toBe(true)
  })
})

describe('Grief Soldier', () => {
  it('Grief Bolt destroys discarded cards and forces that many discards', () => {
    let state = main(game())
    put(state.players[0], 0, 'grief_soldier', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state.players[0].discard = [card('gone-a', 'coffee'), card('gone-b', 'shield'), card('keep-d', 'famine')]
    state.players[1].hand = [card('d1', 'coffee'), card('d2', 'shield')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'grief_bolt'),
    )
    state = applyAction(state, { type: 'GRIEF_TOGGLE', instanceId: 'gone-a' })
    state = applyAction(state, { type: 'GRIEF_TOGGLE', instanceId: 'gone-b' })
    state = applyAction(state, { type: 'GRIEF_FINISH' })
    expect(state.players[0].removed.map((entry) => entry.instanceId)).toEqual(['gone-a', 'gone-b'])
    expect(state.players[0].discard.map((entry) => entry.instanceId)).toEqual(['keep-d'])
    expect(state.pending).toMatchObject({ kind: 'handDiscard', player: 1, remaining: 2 })
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'd1' })
    expect(state.pending).toMatchObject({ kind: 'handDiscard', player: 1, remaining: 1 })
    state = applyAction(state, { type: 'DISCARD_FROM_HAND', instanceId: 'd2' })
    expect(state.pending).toBeNull()
  })
})

describe('Imilthian Alchemist', () => {
  it("Bottle o' Toxins hits two adjacent cards and poisons for poison cards in play", () => {
    let state = main(game())
    put(state.players[0], 0, 'imilthian_alchemist', { energy: 2 })
    put(state.players[0], 1, 'leecher')
    put(state.players[1], 0, 'blob')
    put(state.players[1], 1, 'ice_core')
    expect(countPoisonCardsInPlay(state.players[0])).toBe(2)
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'bottle_toxins' &&
          a.targets?.[0].kind === 'monster' &&
          a.targets[0].player === 1 &&
          a.targets[0].slot === 0 &&
          a.targets[1].kind === 'monster' &&
          a.targets[1].player === 1 &&
          a.targets[1].slot === 1,
      ),
    )
    expect(state.players[1].field[0]?.hp).toBe(40)
    expect(state.players[1].field[1]?.statuses.some((status) => status.kind === 'poison' && status.turns === 2)).toBe(
      true,
    )
  })

  it('Transmutation destroys a hand card and fetches from discard', () => {
    let state = main(game())
    put(state.players[0], 0, 'imilthian_alchemist', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [card('sacrifice', 'coffee')]
    state.players[0].discard = [card('prize', 'famine')]
    state = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'transmutation'),
    )
    state = applyAction(state, { type: 'TRANSMUTE_DESTROY', instanceId: 'sacrifice' })
    expect(state.players[0].removed.some((entry) => entry.instanceId === 'sacrifice')).toBe(true)
    expect(state.players[0].discard.some((entry) => entry.instanceId === 'sacrifice')).toBe(false)
    state = applyAction(state, { type: 'TRANSMUTE_FETCH', instanceId: 'prize' })
    expect(state.players[0].hand.map((entry) => entry.instanceId)).toEqual(['prize'])
    expect(state.pending).toBeNull()
  })

  it("Imilithia's Brew permanently replaces printed weaknesses", () => {
    let state = main(game())
    put(state.players[0], 0, 'imilthian_alchemist', { energy: 2 })
    put(state.players[1], 0, 'blob')
    state = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.abilityId === 'imilithias_brew' &&
          a.target?.kind === 'monster' &&
          a.target.player === 1 &&
          a.target.slot === 0,
      ),
    )
    state = applyAction(state, { type: 'BREW_WEAKNESS', damageType: 'shadow' })
    expect(state.players[1].field[0]?.weaknessOverride).toBe('shadow')
    const blob = state.players[1].field[0]!
    expect(computeDamage({ base: 20, damageType: 'shadow', attacker: null, defender: blob })).toBe(30)
    expect(computeDamage({ base: 20, damageType: 'fire', attacker: null, defender: blob })).toBe(20)
  })
})

describe('Dark Charge', () => {
  it('can charge the same monster any number of times and stays in the energy phase', () => {
    let state = main(game())
    put(state.players[0], 0, 'shadow_imp')
    expect(hasDarkCharge(state.players[0].field[0]!)).toBe(true)
    state.players[0].discard = [card('fuel-a', 'coffee'), card('fuel-b', 'shield')]
    state.phase = 'energy'
    state.energyPool = 0
    state = applyAction(
      state,
      action(state, (a) => a.type === 'DARK_CHARGE' && a.slot === 0 && a.discardInstanceId === 'fuel-a'),
    )
    expect(state.players[0].field[0]?.energy).toBe(1)
    expect(state.players[0].removed.some((entry) => entry.instanceId === 'fuel-a')).toBe(true)
    expect(state.phase).toBe('energy')
    expect(
      listLegalActions(state).some((a) => a.type === 'DARK_CHARGE' && a.slot === 0),
    ).toBe(true)
    state = applyAction(
      state,
      action(state, (a) => a.type === 'DARK_CHARGE' && a.slot === 0 && a.discardInstanceId === 'fuel-b'),
    )
    expect(state.players[0].field[0]?.energy).toBe(2)
    expect(state.phase).toBe('energy')
    expect(listLegalActions(state).some((a) => a.type === 'END_TURN')).toBe(true)
  })

  it('stays in the energy phase after attaching or skipping if Dark Charge is still available', () => {
    let state = main(game())
    put(state.players[0], 0, 'shadow_imp')
    state.players[0].discard = [card('fuel', 'coffee')]
    state.phase = 'energy'
    state.energyPool = 1
    state = applyAction(state, { type: 'ATTACH_ENERGY', slot: 0 })
    expect(state.energyPool).toBe(0)
    expect(state.phase).toBe('energy')
    expect(listLegalActions(state).some((a) => a.type === 'DARK_CHARGE')).toBe(true)
    expect(listLegalActions(state).some((a) => a.type === 'END_TURN')).toBe(true)

    state = main(game())
    put(state.players[0], 0, 'shadow_imp')
    state.players[0].discard = [card('fuel', 'coffee')]
    state.phase = 'energy'
    state.energyPool = 1
    state = applyAction(state, { type: 'SKIP_ENERGY' })
    expect(state.energyPool).toBe(0)
    expect(state.phase).toBe('energy')
    expect(listLegalActions(state).some((a) => a.type === 'DARK_CHARGE')).toBe(true)
    expect(listLegalActions(state).some((a) => a.type === 'END_TURN')).toBe(true)
  })
})
