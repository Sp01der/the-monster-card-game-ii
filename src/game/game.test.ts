import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { applyAction } from './reducer'
import { createGame, type DeckSetup } from './setup'
import type { FieldMonster, GameState, PlayerState } from './types'
import { FIELD_SIZE } from './types'
import { getMonster } from './catalog'
import { applyStatus } from './helpers'

function fixedRng(...rolls: number[]): () => number {
  const queue = [...rolls]
  return () => {
    const n = queue.shift()
    if (n === undefined) return 1
    return n
  }
}

function tinyDeck(name: string, cards: string[], top = 0): DeckSetup {
  return { name, cardIds: cards, topMonsterIndex: top }
}

function startGame(rng: () => number = fixedRng()): GameState {
  // Deterministic: no shuffle movement — use shuffleRandom that always picks 0
  return createGame(
    tinyDeck('P1', ['blob', 'ice_core', 'snapatrap', 'coffee', 'sword']),
    tinyDeck('P2', ['fire_sprite', 'ember_tortoise', 'veyan_archer', 'health_potion', 'ruby_ring']),
    { rng, shuffleRandom: () => 0, skipHandoff: true },
  )
}

function placeMonster(player: PlayerState, slot: number, defId: string, extra?: Partial<FieldMonster>) {
  const def = getMonster(defId)
  player.field[slot] = {
    instanceId: `t-${defId}-${slot}`,
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

function skipToMain(state: GameState): GameState {
  let s = state
  if (s.phase === 'draw') {
    const skip = listLegalActions(s).find((a) => a.type === 'SKIP_DRAW' || a.type === 'DRAW')
    if (skip) s = applyAction(s, skip)
  }
  return s
}

function playMonster(
  state: GameState,
  stance: 'active' | 'withdrawn' = 'active',
): GameState {
  const play = listLegalActions(state).find(
    (a) => a.type === 'PLAY_MONSTER' && a.stance === stance,
  )
  if (!play) throw new Error('No PLAY_MONSTER')
  return applyAction(state, play)
}

describe('first turn', () => {
  it('starts in main (no draw), forbids abilities, requires playing a monster', () => {
    let state = startGame()
    expect(state.phase).toBe('main')
    expect(state.abilityUsesLeft).toBe(0)
    expect(listLegalActions(state).some((a) => a.type === 'DRAW' || a.type === 'SKIP_DRAW')).toBe(
      false,
    )

    const main = listLegalActions(state)
    expect(main.some((a) => a.type === 'USE_ABILITY')).toBe(false)
    expect(main.some((a) => a.type === 'SKIP_MAIN')).toBe(false)
    expect(main.some((a) => a.type === 'PLAY_MONSTER')).toBe(true)
    expect(main.some((a) => a.type === 'PLAY_MONSTER' && a.stance === 'withdrawn')).toBe(true)

    const play = main.find((a) => a.type === 'PLAY_MONSTER' && a.stance === 'active')
    if (!play || play.type !== 'PLAY_MONSTER') throw new Error('expected play')
    state = applyAction(state, play)
    expect(state.playedCardThisTurn).toBe(true)
    expect(state.players[0].field[play.slot]!.stance).toBe('active')
    expect(listLegalActions(state).some((a) => a.type === 'SKIP_MAIN')).toBe(true)
  })

  it('can play the opening monster withdrawn', () => {
    let state = startGame()
    const play = listLegalActions(state).find(
      (a) => a.type === 'PLAY_MONSTER' && a.stance === 'withdrawn',
    )
    if (!play || play.type !== 'PLAY_MONSTER') throw new Error('expected play')
    state = applyAction(state, play)
    expect(state.players[0].field[play.slot]!.stance).toBe('withdrawn')
  })
})

describe('energy', () => {
  it('requires attached energy and spends only filled dots', () => {
    let state = startGame()
    state = skipToMain(state)
    const play = listLegalActions(state).find(
      (a) => a.type === 'PLAY_MONSTER' && a.stance === 'active',
    )!
    state = applyAction(state, play)
    state = applyAction(state, { type: 'SKIP_MAIN' })
    state = applyAction(state, { type: 'SKIP_MOVE' })
    state = applyAction(state, {
      type: 'ATTACH_ENERGY',
      slot: play.type === 'PLAY_MONSTER' ? play.slot : 0,
    })
    state = applyAction(state, { type: 'END_TURN' })
    state = applyAction(state, { type: 'CONFIRM_HANDOFF' })

    // P2 first turn starts in main (no draw)
    expect(state.phase).toBe('main')
    state = playMonster(state)
    state = applyAction(state, { type: 'SKIP_MAIN' })
    state = applyAction(state, { type: 'SKIP_MOVE' })
    state = applyAction(state, { type: 'SKIP_ENERGY' })
    state = applyAction(state, { type: 'END_TURN' })
    state = applyAction(state, { type: 'CONFIRM_HANDOFF' })

    // P1 second turn — may draw
    expect(state.phase).toBe('draw')
    state = applyAction(state, { type: 'SKIP_DRAW' })
    const p1 = state.players[0]
    const slot = p1.field.findIndex((m) => m !== null)
    expect(slot).toBeGreaterThanOrEqual(0)
    expect(p1.field[slot]!.energy).toBe(1)
    expect(p1.field[slot]!.pendingEnergy).toBe(0)

    // Blob Wakkle costs + (spend 1). Should be legal.
    const wakkle = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle',
    )
    expect(wakkle).toBeTruthy()
  })

  it('0+ needs 2 energy and spends 1', () => {
    let state = startGame()
    // Put Veyan Archer with 2 energy for P1 after first turns
    placeMonster(state.players[0], 0, 'veyan_archer', { energy: 2 })
    placeMonster(state.players[1], 0, 'blob', { stance: 'active' })
    state.players[0].isFirstTurn = false
    state.players[0].hasFinishedFirstTurn = true
    state.players[1].isFirstTurn = false
    state.players[1].hasFinishedFirstTurn = true
    state.phase = 'main'
    state.abilityUsesLeft = 1

    const volley = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'arrow_volley',
    )
    expect(volley).toBeTruthy()
    state = applyAction(state, volley!)
    expect(state.players[0].field[0]!.energy).toBe(1)
  })
})

describe('slain vs remove', () => {
  it('slain subtracts points; remove does not', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'bomber_beetle', { energy: 3 })
    placeMonster(state.players[1], 0, 'blob', { hp: 50 })
    state.players[0].isFirstTurn = false
    state.players[1].isFirstTurn = false
    state.players[0].hasFinishedFirstTurn = true
    state.players[1].hasFinishedFirstTurn = true
    state.phase = 'main'
    state.abilityUsesLeft = 1

    const beforePoints = state.players[0].points
    const explode = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'explode',
    )!
    state = applyAction(state, explode)
    expect(state.players[0].field[0]).toBeNull()
    expect(state.players[0].points).toBe(beforePoints)
    expect(state.players[1].field[0]).toBeNull()
    expect(state.players[1].points).toBe(6 - 1) // blob slain
  })
})

describe('statuses', () => {
  it('goo blocks move and clears by spending energy', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', {
      energy: 1,
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    state.players[0].isFirstTurn = false
    state.phase = 'move'
    expect(listLegalActions(state).some((a) => a.type === 'WITHDRAW')).toBe(false)

    state.phase = 'main'
    state.abilityUsesLeft = 0
    const ungoo = listLegalActions(state).find((a) => a.type === 'UNGOO')
    expect(ungoo).toBeTruthy()
    state = applyAction(state, ungoo!)
    expect(state.players[0].field[0]!.statuses.some((s) => s.kind === 'goo')).toBe(false)
    expect(state.players[0].field[0]!.energy).toBe(0)
  })

  it('frozen blocks abilities', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', {
      energy: 1,
      statuses: [{ kind: 'frozen', turns: 2, skipNextTick: false }],
    })
    placeMonster(state.players[1], 0, 'ice_core')
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1
    expect(
      listLegalActions(state).some((a) => a.type === 'USE_ABILITY' && a.slot === 0),
    ).toBe(false)
  })

  it('adds durations of the same status into one', () => {
    const monster = {
      instanceId: 'm',
      defId: 'blob',
      hp: 50,
      maxHp: 50,
      stance: 'active' as const,
      energy: 0,
      pendingEnergy: 0,
      statuses: [],
      equipment: [],
    }
    applyStatus(monster, 'burn', 2)
    applyStatus(monster, 'burn', 3)
    expect(monster.statuses).toEqual([
      { kind: 'burn', turns: 5, skipNextTick: false, sourceInstanceId: undefined },
    ])
  })

  it('burn skips the turn it was applied, then deals 20', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob')
    placeMonster(state.players[1], 0, 'ice_core', {
      statuses: [{ kind: 'burn', turns: 3, skipNextTick: false }],
      hp: 80,
    })
    state.players[0].isFirstTurn = false
    state.players[0].hasFinishedFirstTurn = true
    state.players[1].isFirstTurn = false
    state.players[1].hasFinishedFirstTurn = true
    state.phase = 'end'
    state = applyAction(state, { type: 'END_TURN' })
    // Only the status owner's end step ticks it.
    expect(state.players[1].field[0]!.hp).toBe(80)
    expect(state.players[1].field[0]!.statuses[0].skipNextTick).toBe(false)

    // Finish P2 turn quickly to get back to end of another turn... simpler: call end again after confirming
    state = applyAction(state, { type: 'CONFIRM_HANDOFF' })
    state = applyAction(state, { type: 'SKIP_DRAW' })
    // play required? P2 may still be first turn
    state.players[1].isFirstTurn = false
    // Force to end
    state.phase = 'end'
    state = applyAction(state, { type: 'END_TURN' })
    expect(state.players[1].field[0]!.hp).toBe(60)
  })
})

describe('ranged targeting', () => {
  it('withdrawn ranged can hit active; only active ranged hits withdrawn', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'veyan_archer', {
      energy: 2,
      stance: 'withdrawn',
    })
    placeMonster(state.players[1], 0, 'blob', { stance: 'active' })
    placeMonster(state.players[1], 1, 'ice_core', { stance: 'withdrawn' })
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1

    const fromWithdrawn = listLegalActions(state).filter(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'arrow_volley',
    )
    expect(
      fromWithdrawn.every(
        (a) => a.type === 'USE_ABILITY' && a.target && a.target.kind === 'monster' && a.target.slot === 0,
      ),
    ).toBe(true)

    state.players[0].field[0]!.stance = 'active'
    const fromActive = listLegalActions(state).filter(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'arrow_volley',
    )
    const slots = fromActive.map((a) =>
      a.type === 'USE_ABILITY' && a.target?.kind === 'monster' ? a.target.slot : -1,
    )
    expect(slots).toContain(0)
    expect(slots).toContain(1)
  })
})

describe('no active enemies', () => {
  it('allows attacking withdrawn enemies when opponent has no active cards', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', { energy: 1, stance: 'active' })
    placeMonster(state.players[1], 0, 'ice_core', { stance: 'withdrawn' })
    placeMonster(state.players[1], 1, 'snapatrap', { stance: 'withdrawn' })
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1

    const targets = listLegalActions(state)
      .filter((a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle')
      .map((a) => (a.type === 'USE_ABILITY' && a.target?.kind === 'monster' ? a.target.slot : -1))
    expect(targets).toContain(0)
    expect(targets).toContain(1)
  })

  it('still blocks normal attacks on withdrawn when an active enemy exists', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', { energy: 1, stance: 'active' })
    placeMonster(state.players[1], 0, 'ice_core', { stance: 'active' })
    placeMonster(state.players[1], 1, 'snapatrap', { stance: 'withdrawn' })
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1

    const targets = listLegalActions(state)
      .filter((a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle')
      .map((a) => (a.type === 'USE_ABILITY' && a.target?.kind === 'monster' ? a.target.slot : -1))
    expect(targets).toEqual([0])
  })
})

describe('win/loss', () => {
  it('loses at 0 points', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', { energy: 1 })
    placeMonster(state.players[1], 0, 'blob', { hp: 10 })
    state.players[1].points = 1
    state.players[0].isFirstTurn = false
    state.players[1].hasFinishedFirstTurn = true
    state.phase = 'main'
    state.abilityUsesLeft = 1

    const wakkle = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle',
    )!
    state = applyAction(state, wakkle)
    expect(state.winner).toBe(0)
  })

  it('loses with no monsters after first turn finished', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', { energy: 1 })
    placeMonster(state.players[1], 0, 'blob', { hp: 10 })
    state.players[1].hasFinishedFirstTurn = true
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1
    const wakkle = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle',
    )!
    state = applyAction(state, wakkle)
    expect(state.players[1].field.every((s) => s === null)).toBe(true)
    expect(state.winner).toBe(0)
  })
})

describe('field size', () => {
  it('has seven slots', () => {
    const state = startGame()
    expect(state.players[0].field).toHaveLength(FIELD_SIZE)
  })
})

describe('one ability per card', () => {
  it('blocks a second ability on the same card, including free Regrow', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'snapatrap', { energy: 1 })
    placeMonster(state.players[1], 0, 'blob')
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1
    state.actedSlots = []

    const chomp = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'chomp' && a.slot === 0,
    )!
    state = applyAction(state, chomp)
    expect(state.actedSlots).toContain(0)
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'USE_ABILITY' && a.slot === 0 && a.abilityId === 'regrow',
      ),
    ).toBe(false)
  })

  it('allows Regrow then an ability on a different card', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'snapatrap', { energy: 1, hp: 50 })
    placeMonster(state.players[0], 1, 'blob', { energy: 1 })
    placeMonster(state.players[1], 0, 'ice_core')
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1
    state.actedSlots = []

    const regrow = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'regrow',
    )!
    state = applyAction(state, regrow)
    expect(state.abilityUsesLeft).toBe(1)
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle' && a.slot === 1,
      ),
    ).toBe(true)
  })

  it('Ruby Ring lets the equipped card act without spending the team action, but not twice', () => {
    let state = startGame()
    placeMonster(state.players[0], 0, 'blob', {
      energy: 2,
      equipment: [{ instanceId: 'r', defId: 'ruby_ring', hp: 20, maxHp: 20 }],
    })
    placeMonster(state.players[0], 1, 'ice_core', { energy: 1 })
    placeMonster(state.players[1], 0, 'snapatrap')
    state.players[0].isFirstTurn = false
    state.phase = 'main'
    state.abilityUsesLeft = 1
    state.actedSlots = []

    const wakkle = listLegalActions(state).find(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'wakkle' && a.slot === 0,
    )!
    state = applyAction(state, wakkle)
    expect(state.abilityUsesLeft).toBe(1)
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'USE_ABILITY' && a.slot === 0,
      ),
    ).toBe(false)
    expect(
      listLegalActions(state).some(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'shard' && a.slot === 1,
      ),
    ).toBe(true)
  })
})
