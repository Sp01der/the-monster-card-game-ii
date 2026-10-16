import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard, grantedAbilities, monsterAbilities } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, HandCard, PlayerState } from './types'

function game(rolls: number[] = [1]): GameState {
  let rollIndex = 0
  return createGame(
    {
      name: 'P1',
      cardIds: ['blob', 'quick_march', 'starlight_portal', 'command'],
      topMonsterIndex: 0,
    },
    {
      name: 'P2',
      cardIds: ['ice_core', 'scroll_wisdom', 'empower', 'spear'],
      topMonsterIndex: 0,
    },
    {
      skipHandoff: true,
      shuffleRandom: () => 0,
      rng: () => rolls[rollIndex++] ?? rolls.at(-1) ?? 1,
    },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  const def = getCard(defId)
  if (def.kind !== 'monster') throw new Error(`Not a monster: ${defId}`)
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

function card(instanceId: string, defId: string): HandCard {
  return { instanceId, defId }
}

describe('new effect and equipment catalog', () => {
  it('defines the eight new cards', () => {
    expect(getCard('quick_march')).toMatchObject({ kind: 'effect', name: 'Quick… March!' })
    expect(getCard('starlight_portal')).toMatchObject({ kind: 'effect', name: 'Starlight Portal' })
    expect(getCard('command')).toMatchObject({ kind: 'effect', name: 'Command' })
    expect(getCard('scroll_wisdom')).toMatchObject({ kind: 'effect', name: 'Scroll of Wisdom' })
    expect(getCard('empower')).toMatchObject({ kind: 'effect', name: 'Empower' })
    expect(getCard('spear')).toMatchObject({ kind: 'equipment', maxHp: 40 })
    expect(getCard('emerald_ring')).toMatchObject({ kind: 'equipment', maxHp: 20 })
    expect(getCard('fishing_rod')).toMatchObject({ kind: 'equipment', maxHp: 40 })
  })
})

describe('Quick… March!', () => {
  it('flips any number of legal stances and allows finishing with none', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { stance: 'active' })
    put(state.players[0], 1, 'ice_core', { stance: 'withdrawn' })
    put(state.players[0], 2, 'snapatrap', {
      stance: 'active',
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    state.players[0].hand = [card('m1', 'quick_march')]

    const afterPlay = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(afterPlay.pending).toMatchObject({ kind: 'march', chosenSlots: [] })
    expect(listLegalActions(afterPlay).some((a) => a.type === 'MARCH_FINISH')).toBe(true)
    expect(
      listLegalActions(afterPlay).some((a) => a.type === 'MARCH_TOGGLE' && a.slot === 2),
    ).toBe(false)

    const toggled = applyAction(applyAction(afterPlay, { type: 'MARCH_TOGGLE', slot: 0 }), {
      type: 'MARCH_TOGGLE',
      slot: 1,
    })
    const finished = applyAction(toggled, { type: 'MARCH_FINISH' })
    expect(finished.pending).toBeNull()
    expect(finished.players[0].field[0]?.stance).toBe('withdrawn')
    expect(finished.players[0].field[1]?.stance).toBe('active')
    expect(finished.players[0].field[2]?.stance).toBe('active')
    expect(finished.movedSlots).toEqual([0, 1])
    expect(finished.movedThisTurn).toBe(false)
  })
})

describe('Starlight Portal', () => {
  it('lets you play any number of cards, including zero', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    state.players[0].hand = [
      card('p1', 'starlight_portal'),
      card('c1', 'command'),
      card('b1', 'blob'),
    ]

    const portal = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(portal.pending).toMatchObject({ kind: 'playCards' })
    expect(listLegalActions(portal).some((a) => a.type === 'PORTAL_FINISH')).toBe(true)

    const afterCommand = applyAction(
      portal,
      action(portal, (a) => a.type === 'PLAY_EFFECT' && getCard(portal.players[0].hand[a.handIndex].defId).id === 'command'),
    )
    expect(afterCommand.pending?.kind).toBe('playCards')
    expect(afterCommand.abilityUsesLeft).toBe(2)

    const afterMonster = applyAction(
      afterCommand,
      action(
        afterCommand,
        (a) => a.type === 'PLAY_MONSTER' && a.slot === 1 && a.stance === 'withdrawn',
      ),
    )
    expect(afterMonster.players[0].field[1]?.defId).toBe('blob')
    expect(afterMonster.pending?.kind).toBe('playCards')

    const finished = applyAction(afterMonster, { type: 'PORTAL_FINISH' })
    expect(finished.pending).toBeNull()
  })

  it('resumes the portal after a nested Quick March', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { stance: 'active' })
    state.players[0].hand = [card('p1', 'starlight_portal'), card('m1', 'quick_march')]

    const portal = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    const march = applyAction(
      portal,
      action(portal, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(march.pending?.kind).toBe('march')
    expect(march.pendingStack.some((pending) => pending.kind === 'playCards')).toBe(true)

    const afterMarch = applyAction(applyAction(march, { type: 'MARCH_TOGGLE', slot: 0 }), {
      type: 'MARCH_FINISH',
    })
    expect(afterMarch.players[0].field[0]?.stance).toBe('withdrawn')
    expect(afterMarch.pending?.kind).toBe('playCards')
  })
})

describe('Command, Scroll of Wisdom, and Empower', () => {
  it('Command grants an extra team action', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 1 })
    put(state.players[0], 1, 'ice_core', { energy: 1 })
    put(state.players[1], 0, 'snapatrap')
    state.players[0].hand = [card('c1', 'command')]

    const after = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(after.abilityUsesLeft).toBe(2)

    const first = applyAction(
      after,
      action(after, (a) => a.type === 'USE_ABILITY' && a.slot === 0),
    )
    expect(first.abilityUsesLeft).toBe(1)
    const second = applyAction(
      first,
      action(first, (a) => a.type === 'USE_ABILITY' && a.slot === 1),
    )
    expect(second.abilityUsesLeft).toBe(0)
  })

  it('Scroll of Wisdom draws up to 3 cards', () => {
    const state = main(game())
    state.players[0].hand = [card('s1', 'scroll_wisdom')]
    state.players[0].deck = [card('d1', 'blob'), card('d2', 'blob'), card('d3', 'blob'), card('d4', 'blob')]

    const after = applyAction(
      state,
      action(state, (a) => a.type === 'PLAY_EFFECT' && a.handIndex === 0),
    )
    expect(after.players[0].hand).toHaveLength(3)
    expect(after.players[0].deck).toHaveLength(1)
  })

  it('Empower gives 2 energy and a free action that still acts only once', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { energy: 0 })
    put(state.players[0], 1, 'ice_core', { energy: 1 })
    put(state.players[1], 0, 'snapatrap')
    state.players[0].hand = [card('e1', 'empower')]
    state.abilityUsesLeft = 0

    const empowered = applyAction(
      state,
      action(
        state,
        (a) =>
          a.type === 'PLAY_EFFECT' &&
          a.targets[0]?.kind === 'monster' &&
          a.targets[0].slot === 0,
      ),
    )
    expect(empowered.players[0].field[0]?.energy).toBe(2)
    expect(empowered.players[0].field[0]?.freeActionThisTurn).toBe(true)
    expect(empowered.abilityUsesLeft).toBe(0)

    const used = applyAction(
      empowered,
      action(empowered, (a) => a.type === 'USE_ABILITY' && a.slot === 0),
    )
    expect(used.abilityUsesLeft).toBe(0)
    expect(used.actedSlots).toContain(0)
    expect(listLegalActions(used).some((a) => a.type === 'USE_ABILITY' && a.slot === 0)).toBe(false)
    expect(listLegalActions(used).some((a) => a.type === 'USE_ABILITY' && a.slot === 1)).toBe(false)
  })
})

describe('Spear, Emerald Ring, and Fishing Rod', () => {
  it('grants Spear and lets the attached monster use it', () => {
    const state = main(game([1]))
    put(state.players[0], 0, 'blob', {
      energy: 1,
      equipment: [{ instanceId: 'sp', defId: 'spear', hp: 40, maxHp: 40 }],
    })
    put(state.players[1], 0, 'ice_core')

    expect(grantedAbilities(state.players[0].field[0]!).map((a) => a.id)).toEqual(['spear'])
    expect(monsterAbilities(state.players[0].field[0]!).some((a) => a.id === 'spear')).toBe(true)

    const after = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.abilityId === 'spear'),
    )
    expect(after.players[1].field[0]?.hp).toBe(40)
  })

  it('heals 10 from Emerald Ring at the owner end step, capped at max HP', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      hp: 30,
      equipment: [{ instanceId: 'er', defId: 'emerald_ring', hp: 20, maxHp: 20 }],
    })
    put(state.players[0], 1, 'ice_core', {
      hp: 80,
      equipment: [{ instanceId: 'er2', defId: 'emerald_ring', hp: 20, maxHp: 20 }],
    })
    state.phase = 'end'

    const after = applyAction(state, { type: 'END_TURN' })
    expect(after.players[0].field[0]?.hp).toBe(40)
    expect(after.players[0].field[1]?.hp).toBe(80)
  })

  it('draws from Fishing Rod when leftover energy is spare', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      energy: 2,
      equipment: [{ instanceId: 'fr', defId: 'fishing_rod', hp: 40, maxHp: 40 }],
    })
    put(state.players[1], 0, 'ice_core')
    state.players[0].deck = [card('d1', 'blob'), card('d2', 'blob')]

    const after = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.slot === 0 && a.abilityId === 'wakkle'),
    )
    expect(after.players[0].field[0]?.energy).toBe(1)
    expect(after.players[0].hand.some((c) => c.instanceId === 'd1')).toBe(true)
  })

  it('does not draw from Fishing Rod without spare energy', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      energy: 1,
      equipment: [{ instanceId: 'fr', defId: 'fishing_rod', hp: 40, maxHp: 40 }],
    })
    put(state.players[1], 0, 'ice_core')
    state.players[0].deck = [card('d1', 'blob')]

    const after = applyAction(
      state,
      action(state, (a) => a.type === 'USE_ABILITY' && a.slot === 0 && a.abilityId === 'wakkle'),
    )
    expect(after.players[0].field[0]?.energy).toBe(0)
    expect(after.players[0].hand.some((c) => c.instanceId === 'd1')).toBe(false)
  })
})
