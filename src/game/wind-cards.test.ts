import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard } from './catalog'
import { dealDamageToTarget } from './combat'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 1 },
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

function use(state: GameState, abilityId: string, predicate?: (candidate: GameAction) => boolean) {
  return applyAction(
    state,
    action(
      state,
      (candidate) =>
        candidate.type === 'USE_ABILITY' &&
        candidate.abilityId === abilityId &&
        (predicate ? predicate(candidate) : true),
    ),
  )
}

function finishTurn(state: GameState): GameState {
  let next = state
  if (next.phase === 'main') next = applyAction(next, { type: 'SKIP_MAIN' })
  if (next.phase === 'move') next = applyAction(next, { type: 'SKIP_MOVE' })
  if (next.phase === 'energy') {
    if (next.pending?.kind === 'stoneCure') next = applyAction(next, { type: 'STONE_KEEP' })
    while (next.energyPool > 0 || next.blobEnergyPool > 0 || next.bannerEnergyPool > 0) {
      next = applyAction(next, { type: 'SKIP_ENERGY' })
    }
    next = applyAction(next, { type: 'END_TURN' })
  }
  if (next.pending?.kind === 'arrowVolley') next = applyAction(next, { type: 'ARROW_SKIP' })
  return next
}

describe('wind, stone, and ethereal cards', () => {
  it('deals 40 shadow damage when a Stalked monster uses an ability', () => {
    const state = main(game())
    put(state.players[0], 0, 'silent_walker', { energy: 1 })
    put(state.players[1], 0, 'blob', { energy: 2 })
    const marked = use(state, 'stalk')
    expect(marked.players[1].field[0]?.stalkedBy).toEqual([0])
    const struck = use(main(marked, 1), 'wakkle')
    expect(struck.players[1].field[0]?.hp).toBe(10)
    const ended = finishTurn(main(struck, 1))
    expect(ended.players[1].field[0]?.stalkedBy).toBeUndefined()
  })

  it('stops the opponent playing effects on their next turn', () => {
    const state = main(game())
    put(state.players[0], 0, 'silent_walker', { energy: 2 })
    put(state.players[1], 0, 'blob')
    const silenced = use(state, 'silence')
    expect(silenced.players[1].silenceNextTurn).toBe(true)
    const theirTurn = finishTurn(silenced)
    expect(theirTurn.awaitingHandoff).toBe(true)
    const started = applyAction(theirTurn, { type: 'CONFIRM_HANDOFF' })
    put(started.players[0], 1, 'orc')
    started.players[1].hand = [{ instanceId: 'gust', defId: 'targeted_hurricane' }]
    expect(started.players[1].blockEffects).toBe(true)
    expect(listLegalActions(main(started, 1)).some((candidate) => candidate.type === 'PLAY_EFFECT')).toBe(false)
  })

  it('takes a card from hand for Tax, or gains gold when the hand is empty', () => {
    const state = main(game())
    put(state.players[0], 0, 'keltreson_noble', { energy: 3 })
    put(state.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    state.players[1].hand = [{ instanceId: 'gift', defId: 'blob' }]
    const taxing = use(state, 'tax')
    expect(taxing.pending?.kind).toBe('tax')
    const given = applyAction(taxing, { type: 'TAX_GIVE', instanceId: 'gift' })
    expect(given.players[0].hand.map((card) => card.defId)).toContain('blob')
    expect(given.players[1].hand).toHaveLength(0)

    const broke = main(game())
    put(broke.players[0], 0, 'keltreson_noble', { energy: 3 })
    put(broke.players[1], 0, 'blob')
    broke.players[1].hand = []
    const gold = use(broke, 'tax')
    expect(gold.players[0].field[0]?.gold).toBe(1)
    expect(gold.pending).toBeNull()
  })

  it('keeps Ethereal monsters in the match and returns them to an empty slot', () => {
    const state = main(game())
    put(state.players[0], 0, 'northsel_great_hawk', { energy: 2, instanceId: 'hawk' })
    put(state.players[1], 0, 'blob', { instanceId: 'rider', hp: 40 })
    const soaring = use(state, 'soar')
    expect(soaring.players[0].field[0]).toBeNull()
    expect(soaring.players[1].field[0]).toBeNull()
    expect(soaring.winner).toBeNull()
    expect(soaring.players[0].ethereal?.[0]?.monster?.instanceId).toBe('hawk')
    expect(soaring.players[1].ethereal?.[0]?.monster?.hp).toBe(40)

    let next = finishTurn(soaring)
    next = applyAction(next, { type: 'CONFIRM_HANDOFF' })
    next = finishTurn(main(next, 1))
    next = applyAction(next, { type: 'CONFIRM_HANDOFF' })
    expect(next.pending?.kind).toBe('etherealReturn')
    const placed = applyAction(next, { type: 'ETHEREAL_PLACE', slot: 0, stance: 'active' })
    expect(placed.players[0].field[0]?.instanceId).toBe('hawk')
    expect(placed.pending?.kind).toBe('etherealReturn')
    const home = applyAction(placed, { type: 'ETHEREAL_PLACE', slot: 1, stance: 'withdrawn' })
    expect(home.players[1].field[1]?.instanceId).toBe('rider')
    expect(home.players[1].field[1]?.stance).toBe('withdrawn')
    expect(home.pending).toBeNull()
  })

  it('attaches a monster to Shrine of Healing and leaves the shrine behind', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 20, instanceId: 'patient' })
    put(state.players[1], 0, 'orc')
    state.players[0].hand = [{ instanceId: 'shrine', defId: 'shrine_of_healing' }]
    const played = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_STRUCTURE'))
    expect(played.players[0].field[0]).toBeNull()
    expect(played.players[0].ethereal?.[0]?.attachedMonster?.hp).toBe(20)
    expect(played.winner).toBeNull()
    let ended = finishTurn(played)
    if (ended.awaitingHandoff) ended = applyAction(ended, { type: 'CONFIRM_HANDOFF' })
    expect(ended.players[0].ethereal?.[0]?.attachedMonster?.hp).toBe(30)
    const returned = applyAction(
      main(ended, 0),
      action(main(ended, 0), (candidate) => candidate.type === 'RETURN_ETHEREAL' && candidate.stance === 'active'),
    )
    expect(returned.players[0].field[0]?.instanceId).toBe('patient')
    expect(returned.players[0].ethereal?.[0]?.card.defId).toBe('shrine_of_healing')
    expect(returned.players[0].ethereal?.[0]?.attachedMonster).toBeUndefined()
  })

  it('returns a card to hand and cannot bounce an opponent last monster', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[1], 0, 'blob', { equipment: [{ instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 }] })
    put(state.players[1], 1, 'orc')
    state.players[0].hand = [{ instanceId: 'gust', defId: 'targeted_hurricane' }]
    const bounced = applyAction(
      state,
      action(
        state,
        (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets[0]?.kind === 'equipment',
      ),
    )
    expect(bounced.players[1].hand.map((card) => card.defId)).toContain('sword')
    expect(bounced.players[1].field[0]?.equipment).toEqual([])

    const alone = main(game())
    put(alone.players[0], 0, 'blob')
    put(alone.players[1], 0, 'blob')
    alone.players[0].hand = [{ instanceId: 'gust', defId: 'targeted_hurricane' }]
    const choices = listLegalActions(alone).filter((candidate) => candidate.type === 'PLAY_EFFECT')
    expect(choices.some((candidate) => candidate.targets[0]?.player === 1)).toBe(false)
    expect(choices.some((candidate) => candidate.targets[0]?.player === 0)).toBe(true)
  })

  it('makes Buried Alive Stone ignore damage until a blast, and Saphire Ring prevents it', () => {
    const state = main(game())
    put(state.players[0], 0, 'sandstorm_golem', { energy: 6, abilitiesUnlocked: true })
    put(state.players[1], 0, 'blob', { hp: 40 })
    const stone = use(state, 'buried_alive')
    expect(stone.players[1].field[0]?.statuses.some((status) => status.kind === 'stone' && status.cure === 'skipEnergy')).toBe(true)
    const poked = use(main(stone), 'dust_devil')
    expect(poked.players[1].field[0]?.hp).toBe(40)
    dealDamageToTarget(poked, poked.players[0].field[0], { kind: 'monster', player: 1, slot: 0 }, 20, 'blast')
    expect(poked.players[1].field[0]?.statuses.some((status) => status.kind === 'stone')).toBe(false)
    expect(poked.players[1].field[0]?.hp).toBe(20)

    const immune = main(game())
    put(immune.players[0], 0, 'sandstorm_golem', { energy: 6, abilitiesUnlocked: true })
    put(immune.players[1], 0, 'blob', {
      equipment: [{ instanceId: 'ring', defId: 'saphire_ring', hp: 20, maxHp: 20 }],
    })
    const safe = use(immune, 'buried_alive')
    expect(safe.players[1].field[0]?.statuses).toEqual([])
  })

  it('lets the owner skip an energy phase to remove Stone', () => {
    const state = main(game(), 1)
    put(state.players[1], 0, 'blob', {
      statuses: [{ kind: 'stone', turns: 0, skipNextTick: false, cure: 'skipEnergy' }],
    })
    state.phase = 'move'
    const energy = applyAction(state, { type: 'SKIP_MOVE' })
    expect(energy.pending?.kind).toBe('stoneCure')
    const cured = applyAction(energy, { type: 'STONE_CURE', instanceId: '1-0-blob' })
    expect(cured.players[1].field[0]?.statuses).toEqual([])
    expect(cured.phase).toBe('end')
  })

  it('hits every other monster once with earth and wind', () => {
    const state = main(game())
    put(state.players[0], 0, 'sandstorm_golem', { energy: 6, abilitiesUnlocked: true })
    put(state.players[0], 1, 'blob', {
      equipment: [{ instanceId: 'sword', defId: 'sword', hp: 30, maxHp: 30 }],
    })
    put(state.players[1], 0, 'thunder_core')
    const storm = use(state, 'sandstorm')
    expect(storm.players[1].field[0]?.hp).toBe(30)
    expect(storm.players[0].field[0]?.hp).toBe(200)
    expect(storm.players[0].field[1]?.equipment[0]?.hp).toBe(30)

    const dust = main(game())
    put(dust.players[0], 0, 'sandstorm_golem', { energy: 2, abilitiesUnlocked: true })
    put(dust.players[1], 0, 'thunder_core')
    expect(use(dust, 'dust_devil').players[1].field[0]?.hp).toBe(20)
  })

  it('counts only HP actually gained, then adds wind damage next turn', () => {
    const state = main(game())
    put(state.players[0], 0, 'larrathere_knight', { energy: 1 })
    put(state.players[0], 1, 'blob', { hp: 20 })
    put(state.players[1], 0, 'blob')
    const healed = use(
      state,
      'render_aid',
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.targets?.[0]?.slot === 1,
    )
    expect(healed.players[0].field[1]?.hp).toBe(50)
    expect(healed.players[1].field[0]?.hp).toBe(50)
    expect(healed.players[0].healedThisTurn).toBe(30)
    const ended = finishTurn(healed)
    expect(ended.players[0].healedLastTurn).toBe(30)
    const later = main(ended)
    later.players[0].field[0]!.energy = 1
    put(later.players[1], 0, 'blob')
    expect(use(later, 'way_of_the_wind').players[1].field[0]?.hp).toBe(20)
  })

  it('gives an unused Construct Warrior 1 energy and strikes twice through defense', () => {
    const state = main(game())
    put(state.players[0], 0, 'construct_warrior')
    state.phase = 'move'
    const energy = applyAction(state, { type: 'SKIP_MOVE' })
    expect(energy.players[0].field[0]?.energy).toBe(1)

    const blades = main(game())
    put(blades.players[0], 0, 'construct_warrior', { energy: 3 })
    put(blades.players[1], 0, 'construct')
    expect(use(blades, 'electro_blades').players[1].field[0]?.hp).toBe(60)
  })

  it('locks the golem until Storm Coming and then shoots at the end of a turn', () => {
    const locked = main(game())
    put(locked.players[0], 0, 'sandstorm_golem', { energy: 6 })
    put(locked.players[1], 0, 'blob')
    expect(listLegalActions(locked).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'dust_devil')).toBe(false)
    expect(use(locked, 'storm_coming').players[0].field[0]?.abilitiesUnlocked).toBe(true)

    const archer = main(game())
    put(archer.players[0], 0, 'unending_archer', { energy: 3 })
    put(archer.players[1], 0, 'blob')
    const sealed = use(archer, 'unrelenting_arrows')
    expect(sealed.players[0].field[0]?.abilitiesSealed).toBe(true)
    expect(listLegalActions(main(sealed)).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'volley')).toBe(false)
    let ending = sealed
    ending = applyAction(ending, { type: 'SKIP_MAIN' })
    ending = applyAction(ending, { type: 'SKIP_MOVE' })
    ending = applyAction(ending, { type: 'SKIP_ENERGY' })
    ending = applyAction(ending, { type: 'END_TURN' })
    expect(ending.pending?.kind).toBe('arrowVolley')
    const shot = applyAction(
      ending,
      action(
        ending,
        (candidate) =>
          candidate.type === 'ARROW_SHOT' && candidate.target.player === 1 && candidate.target.slot === 0,
      ),
    )
    expect(shot.players[1].field[0]?.hp).toBe(40)
  })

  it('has the chosen monster protect the Noble', () => {
    const state = main(game())
    put(state.players[0], 0, 'keltreson_noble', { energy: 2 })
    put(state.players[0], 1, 'blob', { instanceId: 'guard' })
    const guarding = use(state, 'body_guard')
    expect(guarding.players[0].field[0]?.protectedByInstanceId).toBe('guard')
    expect(guarding.players[0].field[1]?.protectingInstanceId).toBe(guarding.players[0].field[0]?.instanceId)
  })
})
