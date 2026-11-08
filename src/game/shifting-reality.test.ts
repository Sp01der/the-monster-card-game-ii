import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard, isBoneling, monsterAbilities } from './catalog'
import { discardMonster } from './helpers'
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
  player.field[slot] = {
    instanceId: `${player.id}-${slot}-${defId}`,
    defId,
    hp: extra.maxHp ?? 50,
    maxHp: extra.maxHp ?? 50,
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
  state.activePlayer = 0
  state.players[0].isFirstTurn = false
  state.players[0].hasFinishedFirstTurn = true
  state.players[1].isFirstTurn = false
  state.players[1].hasFinishedFirstTurn = true
  state.abilityUsesLeft = 1
  state.actedSlots = []
  state.movedSlots = []
  state.pending = null
  state.playedCardThisTurn = false
  state.awaitingHandoff = false
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return found
}

describe('Shifting Reality', () => {
  it('prints the seven cards', () => {
    expect(getCard('the_golden_die')).toMatchObject({ name: 'The Golden Die', effectId: 'goldenDie' })
    expect(getCard('time_warp')).toMatchObject({ name: 'Time Warp', effectId: 'timeWarp' })
    expect(getCard('inversion')).toMatchObject({ name: 'Inversion', effectId: 'inversion' })
    expect(getCard('recursion')).toMatchObject({ name: 'Recursion', effectId: 'recursion' })
    expect(getCard('mirror_pact')).toMatchObject({ name: 'Mirror Pact', effectId: 'mirrorPact' })
    expect(getCard('rewind')).toMatchObject({ name: 'Rewind', effectId: 'rewind' })
    expect(getCard('shapeshifter')).toMatchObject({ name: 'Shapeshifter', points: 3, maxHp: 110 })
  })

  it('lets the Golden Die owner choose the next roll without spending the real rng', () => {
    let calls = 0
    const state = main(game(() => {
      calls += 1
      return 1
    }))
    put(state.players[0], 0, 'construct', { hp: 100, maxHp: 100, energy: 2, instanceId: 'construct' })
    put(state.players[1], 0, 'blob', { hp: 50, maxHp: 50 })
    state.players[0].hand = [{ instanceId: 'die', defId: 'the_golden_die' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(next.goldenDice).toEqual([0])
    const before = next.players[1].field[0]!.hp
    next = applyAction(
      next,
      action(next, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'robotic_stab'),
    )
    expect(next.pending?.kind).toBe('goldenDie')
    expect(next.players[1].field[0]!.hp).toBe(before)
    next = applyAction(next, { type: 'GOLDEN_FACE', face: 6 })
    expect(calls).toBe(0)
    expect(next.players[1].field[0]!.hp).toBe(before - 30)
    expect(next.goldenDice ?? []).toEqual([])
    expect(next.log.some((entry) => entry.dieRoll === 6)).toBe(true)
  })

  it('gives Time Warp an extra full turn, and still loses at 0 points', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [{ instanceId: 'warp', defId: 'time_warp' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(next.players[0].points).toBe(5)
    expect(next.players[0].extraTurn).toBe(true)
    next.phase = 'end'
    next = applyAction(next, { type: 'END_TURN' })
    expect(next.activePlayer).toBe(0)
    expect(next.phase).toBe('draw')
    expect(next.awaitingHandoff).toBe(true)
    expect(next.players[0].extraTurn).toBe(false)

    const losing = main(game())
    put(losing.players[0], 0, 'blob')
    put(losing.players[1], 0, 'blob')
    losing.players[0].points = 1
    losing.players[0].hand = [{ instanceId: 'warp', defId: 'time_warp' }]
    const lost = applyAction(losing, action(losing, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(lost.winner).toBe(1)
    expect(lost.players[0].extraTurn).toBeUndefined()
  })

  it('swaps opposite monsters and leaves energy and equipment on the original side', () => {
    const state = main(game())
    const sword = { instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 }
    put(state.players[0], 0, 'blob', { energy: 3, equipment: [sword], instanceId: 'left' })
    put(state.players[1], 0, 'blob', { energy: 1, instanceId: 'right' })
    state.players[0].hand = [{ instanceId: 'invert', defId: 'inversion' }]
    const next = applyAction(
      state,
      action(
        state,
        (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets.length === 2,
      ),
    )
    expect(next.players[0].field[0]).toMatchObject({
      instanceId: 'right',
      energy: 3,
      equipment: [sword],
    })
    expect(next.players[1].field[0]).toMatchObject({
      instanceId: 'left',
      energy: 1,
      equipment: [],
    })

    const withdrawn = main(game())
    put(withdrawn.players[0], 0, 'blob', { stance: 'withdrawn', instanceId: 'back' })
    put(withdrawn.players[1], 0, 'blob', { stance: 'active', instanceId: 'front' })
    withdrawn.players[0].hand = [{ instanceId: 'invert', defId: 'inversion' }]
    const swapped = applyAction(
      withdrawn,
      action(withdrawn, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets.length === 2),
    )
    expect(swapped.players[0].field[0]).toMatchObject({ instanceId: 'front', stance: 'active' })
    expect(swapped.players[1].field[0]).toMatchObject({ instanceId: 'back', stance: 'withdrawn' })
  })

  it('replays the next effect once, without spending the card play', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 10, maxHp: 100, instanceId: 'patient' })
    state.players[0].hand = [
      { instanceId: 'loop', defId: 'recursion' },
      { instanceId: 'potion', defId: 'health_potion' },
    ]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0))
    expect(next.playedCardThisTurn).toBe(false)
    expect(next.recursion?.charges).toBe(1)
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.targets.some((target) => target.kind === 'monster' && target.slot === 0 && target.player === 0),
      ),
    )
    expect(next.players[0].field[0]!.hp).toBe(70)
    expect(next.pending).toBeNull()
    expect(next.playedCardThisTurn).toBe(true)
    expect(next.cardsPlayedThisTurn).toBe(1)
    expect(next.players[0].discard.some((card) => card.defId === 'health_potion')).toBe(true)
  })

  it('replays the watched effect immediately, even while Starlight Portal is still open', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 10, maxHp: 100, instanceId: 'patient' })
    state.players[0].hand = [
      { instanceId: 'portal', defId: 'starlight_portal' },
      { instanceId: 'loop', defId: 'recursion' },
      { instanceId: 'potion', defId: 'health_potion' },
    ]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets.length === 0 && candidate.handIndex === 0))
    expect(next.pending).toMatchObject({ kind: 'playCards' })
    expect(next.pending?.kind === 'playCards' && next.pending.from).toBeFalsy()
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets.length === 0))
    expect(next.playedCardThisTurn).toBe(true)
    expect(next.recursion?.charges).toBe(1)
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.targets.some((target) => target.kind === 'monster' && target.player === 0 && target.slot === 0),
      ),
    )
    expect(next.players[0].field[0]!.hp).toBe(70)
    expect(next.pending).toMatchObject({ kind: 'playCards' })
    expect(next.cardsPlayedThisTurn).toBe(2)
    expect(next.recursion).toBeUndefined()
  })

  it('replays Darklight Portal as soon as its discard play finishes', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 10, maxHp: 100, instanceId: 'patient' })
    state.players[0].hand = [
      { instanceId: 'loop', defId: 'recursion' },
      { instanceId: 'portal', defId: 'darklight_portal' },
    ]
    state.players[0].discard = [{ instanceId: 'potion', defId: 'health_potion' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(next.pending).toMatchObject({ kind: 'playCards', from: 'discard', limit: 1 })
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.fromDiscard === true &&
          candidate.targets.some((target) => target.kind === 'monster' && target.slot === 0),
      ),
    )
    expect(next.players[0].field[0]!.hp).toBe(40)
    expect(next.pending).toMatchObject({ kind: 'playCards', from: 'discard', limit: 1 })
    expect(next.cardsPlayedThisTurn).toBe(1)
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.fromDiscard === true &&
          candidate.targets.some((target) => target.kind === 'monster' && target.slot === 0),
      ),
    )
    expect(next.players[0].field[0]!.hp).toBe(70)
    expect(next.pending).toBeNull()
    expect(next.cardsPlayedThisTurn).toBe(1)
  })

  it('keeps a Recursion played during the watched effect for the following effect', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 10, maxHp: 100, instanceId: 'patient' })
    state.players[0].hand = [
      { instanceId: 'loop', defId: 'recursion' },
      { instanceId: 'portal', defId: 'darklight_portal' },
    ]
    state.players[0].discard = [{ instanceId: 'inner', defId: 'recursion' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.fromDiscard === true))
    expect(next.pending).toMatchObject({ kind: 'playCards', from: 'discard', limit: 1 })
    next = applyAction(next, { type: 'PORTAL_FINISH' })
    expect(next.pending).toBeNull()
    expect(next.recursion?.charges).toBe(1)
    expect(next.recursion?.watchId).toBeUndefined()
  })

  it('plays Mirror Pact copies during the pact, and a decline gives nobody a copy', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { instanceId: 'original' })
    put(state.players[1], 0, 'blob', { instanceId: 'theirs' })
    state.players[0].hand = [{ instanceId: 'pact', defId: 'mirror_pact' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT'))
    expect(next.pending?.kind).toBe('mirrorPick')
    next = applyAction(next, action(next, (candidate) => candidate.type === 'MIRROR_PICK' && candidate.instanceId === 'original'))
    expect(next.pending).toMatchObject({ kind: 'mirrorOffer', defId: 'blob' })
    const declined = applyAction(next, { type: 'MIRROR_DECLINE' })
    expect(declined.pending).toBeNull()
    expect(declined.players[1].field.filter(Boolean)).toHaveLength(1)

    next = applyAction(next, { type: 'MIRROR_AGREE' })
    expect(next.pending).toMatchObject({ kind: 'playCards', owner: 1, freePlay: true })
    next = applyAction(
      next,
      action(next, (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.stance === 'active'),
    )
    expect(next.players[1].field.filter(Boolean)).toHaveLength(2)
    expect(next.players[1].field.some((monster) => monster && monster.instanceId !== 'theirs' && monster.hp === 50)).toBe(true)
    expect(next.pending).toMatchObject({ kind: 'playCards', owner: 0, mirrorRole: 'self' })
    next = applyAction(next, { type: 'MIRROR_SKIP' })
    expect(next.pending).toBeNull()
    expect(next.players[0].field.filter((monster) => monster?.instanceId === 'original')).toHaveLength(1)
    expect(next.playedCardThisTurn).toBe(true)
  })

  it('copies a monster kit onto Shapeshifter and still loses 3 points', () => {
    const state = main(game())
    put(state.players[0], 0, 'shapeshifter', { hp: 110, maxHp: 110, energy: 1, instanceId: 'shape' })
    put(state.players[0], 1, 'blob', { instanceId: 'spare' })
    state.players[0].deck.push({ instanceId: 'bone-card', defId: 'boneling' })
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'shapeshift'))
    expect(next.pending?.kind).toBe('shapeshiftPick')
    next = applyAction(next, action(next, (candidate) => candidate.type === 'SHAPESHIFT_PICK' && candidate.defId === 'boneling'))
    const shifter = next.players[0].field[0]!
    expect(shifter.shapeshiftDefId).toBe('boneling')
    expect(shifter.maxHp).toBe(110)
    expect(shifter.hp).toBe(110)
    expect(isBoneling(shifter)).toBe(true)
    expect(monsterAbilities(shifter).map((ability) => ability.id)).toEqual(['shapeshift', 'hollow_scratch'])
    next.phase = 'move'
    next.movedThisTurn = false
    expect(listLegalActions(next).some((candidate) => candidate.type === 'WITHDRAW' && candidate.slot === 0)).toBe(false)

    next.phase = 'main'
    next.abilityUsesLeft = 1
    next.actedSlots = []
    shifter.hp = 20
    next.players[0].hand = [{ instanceId: 'archer', defId: 'long_range_archer' }]
    next = applyAction(
      next,
      action(
        next,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.targets.some((target) => target.kind === 'monster' && target.slot === 0 && target.player === 0),
      ),
    )
    expect(next.players[0].field[0]).toBeNull()
    expect(next.players[0].points).toBe(3)
  })

  it('remembers a card with Rewind and restores it without refunding points', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 40, maxHp: 50, energy: 2, instanceId: 'remembered' })
    put(state.players[0], 1, 'blob', { instanceId: 'spare' })
    state.players[0].hand = [
      { instanceId: 'rewind', defId: 'rewind' },
      { instanceId: 'fodder', defId: 'blob' },
    ]
    let next = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets[0]?.slot === 0),
    )
    expect(next.players[0].discard.some((card) => card.defId === 'rewind')).toBe(false)
    expect(next.players[0].ethereal?.[0]?.snapshot?.hp).toBe(40)
    expect(next.playedCardThisTurn).toBe(true)
    next.players[0].field[0]!.hp = 15
    next = applyAction(next, action(next, (candidate) => candidate.type === 'REWIND_USE'))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'REWIND_DISCARD' && candidate.instanceId === 'fodder'))
    expect(next.players[0].field[0]).toMatchObject({ instanceId: 'remembered', hp: 40, energy: 2 })
    expect(next.players[0].removed.some((card) => card.defId === 'rewind')).toBe(true)
    expect(next.players[0].discard.some((card) => card.instanceId === 'fodder')).toBe(true)

    const slain = main(game())
    put(slain.players[0], 0, 'blob', { hp: 40, maxHp: 50, instanceId: 'remembered' })
    put(slain.players[0], 1, 'blob', { instanceId: 'spare' })
    slain.players[0].hand = [
      { instanceId: 'rewind', defId: 'rewind' },
      { instanceId: 'fodder', defId: 'blob' },
    ]
    let restored = applyAction(
      slain,
      action(
        slain,
        (candidate) =>
          candidate.type === 'PLAY_EFFECT' &&
          candidate.targets[0]?.kind === 'monster' &&
          candidate.targets[0].slot === 0,
      ),
    )
    discardMonster(restored, restored.players[0], 0, 'slain')
    expect(restored.players[0].points).toBe(5)
    expect(restored.players[0].field[0]).toBeNull()
    restored = applyAction(restored, action(restored, (candidate) => candidate.type === 'REWIND_USE'))
    restored = applyAction(
      restored,
      action(restored, (candidate) => candidate.type === 'REWIND_DISCARD'),
    )
    expect(restored.players[0].field[0]).toMatchObject({ instanceId: 'remembered', hp: 40 })
    expect(restored.players[0].points).toBe(5)
  })
})
