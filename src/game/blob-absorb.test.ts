import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(rng: () => number = () => 1): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  const printed = getCard(defId)
  const maxHp = extra.maxHp ?? (printed.kind === 'monster' ? printed.maxHp : 50)
  player.field[slot] = {
    instanceId: extra.instanceId ?? `${player.id}-${slot}-${defId}`,
    defId,
    hp: extra.hp ?? maxHp,
    maxHp,
    stance: 'active',
    energy: 0,
    pendingEnergy: 0,
    statuses: [],
    equipment: [],
    ...extra,
  }
}

function main(state: GameState, player = 0): GameState {
  state.phase = 'main'
  state.activePlayer = player as 0 | 1
  state.openingMulligan = undefined
  state.players[0].isFirstTurn = false
  state.players[1].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.pending = null
  state.playedCardThisTurn = false
  state.awaitingHandoff = false
  state.winner = null
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return found
}

const sword = { instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 }
const resilience = { instanceId: 'resilience', defId: 'resilience', hp: 20, maxHp: 20 }

describe('black and big blobs', () => {
  it('absorbs a card at or below current HP and keeps it out of play', () => {
    const state = main(game())
    put(state.players[0], 0, 'black_blob', { energy: 2, hp: 40 })
    put(state.players[1], 0, 'blob', { hp: 50, energy: 3, statuses: [{ kind: 'burn', turns: 2, skipNextTick: false }] })
    put(state.players[1], 1, 'blob', {
      hp: 30,
      energy: 1,
      equipment: [{ ...sword }],
      statuses: [{ kind: 'burn', turns: 1, skipNextTick: false }],
    })
    put(state.players[1], 2, 'orc')
    const targets = listLegalActions(state).filter(
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'blob_absorb',
    )
    expect(targets.some((candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 0)).toBe(false)
    expect(targets.some((candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 2)).toBe(false)
    expect(
      targets.some(
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 1,
      ),
    ).toBe(true)

    const next = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 1,
      ),
    )
    expect(next.players[0].points).toBe(6)
    expect(next.players[1].points).toBe(6)
    expect(next.players[1].field[1]).toBeNull()
    expect(next.players[1].field[0]).not.toBeNull()
    expect(next.winner).toBeNull()
    const held = next.players[0].field[0]?.held
    expect(held?.kind).toBe('monster')
    if (held?.kind === 'monster') {
      expect(held.monster.hp).toBe(30)
      expect(held.monster.energy).toBe(1)
      expect(held.monster.stance).toBe('active')
      expect(held.monster.statuses).toEqual([{ kind: 'burn', turns: 1, skipNextTick: false }])
      expect(held.monster.equipment.map((equipment) => equipment.defId)).toEqual(['sword'])
    }
    expect(next.players[0].field[0]?.energy).toBe(1)
  })

  it('loses when the last monster is absorbed', () => {
    const state = main(game())
    put(state.players[0], 0, 'black_blob', { energy: 2 })
    put(state.players[1], 0, 'blob', { hp: 20 })
    const next = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'blob_absorb'),
    )
    expect(next.players[0].field[0]?.held?.kind).toBe('monster')
    expect(next.winner).toBe(0)
  })

  it('returns the previous card before absorbing again', () => {
    const state = main(game())
    put(state.players[0], 0, 'black_blob', { energy: 4 })
    put(state.players[1], 0, 'blob', { hp: 20, instanceId: 'first' })
    put(state.players[1], 1, 'blob', { hp: 20, instanceId: 'second' })
    put(state.players[1], 2, 'orc')
    let next = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 0 &&
          candidate.abilityId === 'blob_absorb',
      ),
    )
    next = main(next)
    next.players[0].field[0]!.energy = 2
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.target?.kind === 'monster' &&
          candidate.target.slot === 1 &&
          candidate.abilityId === 'blob_absorb',
      ),
    )
    expect(next.players[1].field[0]?.instanceId).toBe('first')
    expect(next.players[1].field[1]).toBeNull()
    expect(next.players[0].field[0]?.held?.kind).toBe('monster')
    if (next.players[0].field[0]?.held?.kind === 'monster') {
      expect(next.players[0].field[0].held.monster.instanceId).toBe('second')
    }
  })

  it('returns a monster to the absorber slot when the absorber dies', () => {
    const state = main(game(), 1)
    put(state.players[1], 0, 'blob', { energy: 2 })
    put(state.players[0], 0, 'black_blob', { energy: 2 })
    put(state.players[1], 1, 'blob', { hp: 20, instanceId: 'captive' })
    state.activePlayer = 0
    state.abilityUsesLeft = 1
    let next = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.slot === 1,
      ),
    )
    next.players[0].field[0]!.hp = 10
    next = main(next, 1)
    next.players[1].field[0]!.energy = 2
    next = applyAction(
      next,
      action(next, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'),
    )
    expect(next.players[0].points).toBe(4)
    expect(next.players[1].points).toBe(6)
    expect(next.players[0].field[0]?.instanceId).toBe('captive')
    expect(next.players[1].field[1]).toBeNull()
    expect(next.players[0].discard.map((card) => card.defId)).toContain('black_blob')
  })

  it('removes the held monster when no slot is empty', () => {
    const state = main(game())
    put(state.players[0], 0, 'black_blob', { energy: 4 })
    for (let slot = 0; slot < state.players[1].field.length; slot++) {
      put(state.players[1], slot, 'blob', { hp: 20, instanceId: `foe-${slot}` })
    }
    let next = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.slot === 3,
      ),
    )
    put(next.players[1], 3, 'orc', { instanceId: 'filler' })
    next = main(next)
    next.players[0].field[0]!.energy = 2
    const before = next.players[1].points
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.slot === 4,
      ),
    )
    expect(next.players[1].points).toBe(before)
    expect(next.players[1].discard.map((card) => card.instanceId)).toContain('foe-3')
    expect(next.players[0].field[0]?.held?.kind).toBe('monster')
    if (next.players[0].field[0]?.held?.kind === 'monster') {
      expect(next.players[0].field[0].held.monster.instanceId).toBe('foe-4')
    }
  })

  it('returns equipment to its host, or removes it when the host is gone', () => {
    const state = main(game())
    put(state.players[0], 0, 'black_blob', { energy: 4 })
    put(state.players[0], 1, 'blob', { maxHp: 70, hp: 40, equipment: [{ ...resilience }] })
    let next = applyAction(
      state,
      action(
        state,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.kind === 'equipment',
      ),
    )
    expect(next.players[0].field[1]?.equipment).toEqual([])
    expect(next.players[0].field[1]?.maxHp).toBe(50)
    expect(next.players[0].field[1]?.hp).toBe(40)
    next = main(next)
    next.players[0].field[0]!.energy = 2
    put(next.players[1], 0, 'blob', { hp: 20 })
    put(next.players[1], 1, 'orc')
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.player === 1,
      ),
    )
    expect(next.players[0].field[1]?.equipment.map((equipment) => equipment.defId)).toEqual(['resilience'])
    expect(next.players[0].field[1]?.maxHp).toBe(70)
    expect(next.players[0].field[1]?.hp).toBe(70)

    const gone = main(game())
    put(gone.players[0], 0, 'black_blob', { energy: 4 })
    put(gone.players[0], 1, 'blob', { hp: 10, equipment: [{ ...sword }] })
    put(gone.players[1], 0, 'blob', { energy: 2 })
    let removed = applyAction(
      gone,
      action(
        gone,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.kind === 'equipment',
      ),
    )
    removed = main(removed, 1)
    removed.players[1].field[0]!.energy = 2
    removed = applyAction(
      removed,
      action(
        removed,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'wakkle' &&
          candidate.target?.slot === 1,
      ),
    )
    removed = main(removed)
    removed.players[0].field[0]!.energy = 2
    put(removed.players[1], 0, 'blob', { hp: 20, instanceId: 'later' })
    put(removed.players[1], 1, 'orc')
    removed = applyAction(
      removed,
      action(
        removed,
        (candidate) =>
          candidate.type === 'USE_ABILITY' &&
          candidate.abilityId === 'blob_absorb' &&
          candidate.target?.kind === 'monster',
      ),
    )
    expect(removed.players[0].discard.map((card) => card.defId)).toContain('sword')
    expect(removed.players[0].field[0]?.held?.kind).toBe('monster')
  })

  it('replaces only the matching blob and places two of that blob on death', () => {
    const yellow = main(game())
    put(yellow.players[0], 0, 'yellow_blob')
    yellow.players[0].hand = [{ instanceId: 'big-yellow', defId: 'big_yellow_blob' }]
    expect(listLegalActions(yellow).some((candidate) => candidate.type === 'REPLACE_MONSTER')).toBe(true)
    expect(listLegalActions(yellow).some((candidate) => candidate.type === 'PLAY_MONSTER' && candidate.handIndex === 0)).toBe(false)
    yellow.players[0].hand = [{ instanceId: 'big-black', defId: 'big_black_blob' }]
    expect(listLegalActions(yellow).some((candidate) => candidate.type === 'REPLACE_MONSTER')).toBe(false)

    const black = main(game())
    put(black.players[0], 0, 'black_blob')
    black.players[0].hand = [{ instanceId: 'big-black', defId: 'big_black_blob' }]
    const replaced = applyAction(
      black,
      action(black, (candidate) => candidate.type === 'REPLACE_MONSTER'),
    )
    expect(replaced.players[0].field[0]?.defId).toBe('big_black_blob')
    expect(replaced.players[0].points).toBe(6)
    expect(replaced.players[0].discard.map((card) => card.defId)).toEqual(['black_blob'])

    const dying = main(game(), 1)
    put(dying.players[1], 0, 'blob', { energy: 2 })
    put(dying.players[0], 0, 'big_black_blob', { hp: 10 })
    const slain = applyAction(
      dying,
      action(dying, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'),
    )
    expect(slain.pending).toMatchObject({ kind: 'spawnBlobs', defId: 'black_blob', remaining: 2 })

    const yellowDeath = main(game(), 1)
    put(yellowDeath.players[1], 0, 'blob', { energy: 2 })
    put(yellowDeath.players[0], 0, 'big_yellow_blob', { hp: 10 })
    const popped = applyAction(
      yellowDeath,
      action(yellowDeath, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'),
    )
    expect(popped.pending).toMatchObject({ kind: 'spawnBlobs', defId: 'yellow_blob', remaining: 2 })
  })

  it('gives Big Yellow Blob an extra blob energy', () => {
    const state = main(game())
    put(state.players[0], 0, 'big_yellow_blob')
    put(state.players[0], 1, 'yellow_blob')
    state.phase = 'move'
    const next = applyAction(state, { type: 'SKIP_MOVE' })
    expect(next.blobEnergyPool).toBe(2)
  })

  it('goos a target and gives a blob energy, repeating only on a 6', () => {
    const quiet = main(game())
    put(quiet.players[0], 0, 'big_yellow_blob', { energy: 2 })
    put(quiet.players[0], 1, 'yellow_blob')
    put(quiet.players[1], 0, 'orc')
    const choosing = applyAction(
      quiet,
      action(quiet, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'charged_splat'),
    )
    expect(choosing.players[1].field[0]?.statuses.some((status) => status.kind === 'goo')).toBe(true)
    expect(choosing.pending).toMatchObject({ kind: 'chargedSplat', step: 'energy', again: false })
    const granted = applyAction(
      choosing,
      action(
        choosing,
        (candidate) =>
          candidate.type === 'CHARGED_SPLAT' &&
          candidate.target.kind === 'monster' &&
          candidate.target.slot === 1,
      ),
    )
    expect(granted.players[0].field[1]?.energy).toBe(1)
    expect(granted.pending).toBeNull()

    const again = main(game(() => 6))
    put(again.players[0], 0, 'big_yellow_blob', { energy: 2 })
    put(again.players[1], 0, 'orc')
    const repeating = applyAction(
      again,
      action(again, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'charged_splat'),
    )
    expect(repeating.players[0].field[0]?.energy).toBe(3)
    expect(repeating.pending).toMatchObject({ kind: 'chargedSplat', step: 'goo', again: false })
  })

  it('prices Black Wakkle at one spent energy and Big Black Wakkle at 30 shadow', () => {
    const black = getCard('black_blob')
    const yellow = getCard('big_yellow_blob')
    const big = getCard('big_black_blob')
    if (black.kind !== 'monster' || yellow.kind !== 'monster' || big.kind !== 'monster') throw new Error('monster')
    expect(black.abilities[0]?.cost).toEqual({ require: 0, spend: 1 })
    expect(black.abilities[0]?.effects).toEqual([{ type: 'damage', amount: 20, damageType: 'shadow' }])
    expect(yellow.abilities[0]?.cost).toEqual({ require: 1, spend: 1 })
    expect(big.abilities[0]?.name).toBe('Black Wakkle')
    expect(big.abilities[0]?.effects).toEqual([{ type: 'damage', amount: 30, damageType: 'shadow' }])

    const state = main(game())
    put(state.players[0], 0, 'big_yellow_blob', { energy: 2 })
    put(state.players[1], 0, 'blob')
    const next = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'big_yellow_wakkle'),
    )
    expect(next.players[1].field[0]?.hp).toBe(20)
  })
})
