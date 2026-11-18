import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { forgeEquipmentIds, getCard, getMonster } from './catalog'
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
  state.energyPool = 0
  state.blobEnergyPool = 0
  state.bannerEnergyPool = 0
  return state
}

function act(state: GameState, predicate: (candidate: GameAction) => boolean) {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return applyAction(state, found)
}

function use(state: GameState, abilityId: string, predicate?: (candidate: GameAction) => boolean) {
  return act(
    state,
    (candidate) =>
      candidate.type === 'USE_ABILITY' &&
      candidate.abilityId === abilityId &&
      (predicate ? predicate(candidate) : true),
  )
}

function endTurn(state: GameState) {
  state.phase = 'energy'
  state.energyPool = 0
  state.blobEnergyPool = 0
  state.bannerEnergyPool = 0
  state.endStepResolved = false
  state.pending = null
  const ended = applyAction(state, { type: 'END_TURN' })
  return applyAction(ended, { type: 'CONFIRM_HANDOFF' })
}

describe('smith, sea, and sleeper cards', () => {
  it('prints the new cards and keeps enchantments out of the forge', () => {
    expect(getCard('blast_leecher')).toMatchObject({ points: 3, maxHp: 110, weakness: 'ice' })
    expect(getCard('gnome_demolitionist')).toMatchObject({ points: 2, maxHp: 70 })
    expect(getMonster('gnome_demolitionist').weakness).toBeUndefined()
    expect(getCard('gnome_bomb')).toMatchObject({ maxHp: 40, createdOnly: true, removeOnLeave: true })
    expect(getCard('pegasus_gift')).toMatchObject({ enchantment: true })
    expect(getCard('resilience')).toMatchObject({ enchantment: true })
    expect(forgeEquipmentIds()).toContain('sword')
    expect(forgeEquipmentIds()).not.toContain('pegasus_gift')
    expect(forgeEquipmentIds()).not.toContain('resilience')
    expect(forgeEquipmentIds()).not.toContain('gnome_bomb')
    expect(forgeEquipmentIds()).not.toContain('colossus_keystone')
  })

  it('replaces Heavy Claws damage and always heals the printed Drain amount', () => {
    const low = main(game(() => 1))
    put(low.players[0], 0, 'blast_leecher', { energy: 1 })
    put(low.players[1], 0, 'blob')
    expect(use(low, 'heavy_claws').players[1].field[0]?.hp).toBe(40)

    const high = main(game(() => 6))
    put(high.players[0], 0, 'blast_leecher', { energy: 1 })
    put(high.players[1], 0, 'blob')
    expect(use(high, 'heavy_claws').players[1].field[0]?.hp).toBe(20)

    const drain = main(game())
    put(drain.players[0], 0, 'blast_leecher', { energy: 2, hp: 80 })
    put(drain.players[1], 0, 'orc')
    const drained = use(drain, 'vampiric_drain')
    expect(drained.players[1].field[0]?.hp).toBe(60)
    expect(drained.players[0].field[0]?.hp).toBe(110)
  })

  it('splashes Blast like Rocket and checks sleep before Drugged Vampiric Suck', () => {
    const blast = main(game())
    put(blast.players[0], 0, 'blast_leecher', { energy: 3 })
    put(blast.players[1], 0, 'blob', { instanceId: 'left' })
    put(blast.players[1], 1, 'orc', { instanceId: 'center' })
    put(blast.players[1], 2, 'blob', { instanceId: 'right' })
    const splashed = use(blast, 'blast', (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.slot === 1)
    expect(splashed.players[1].field[1]?.hp).toBe(50)
    expect(splashed.players[1].field[0]?.hp).toBe(30)
    expect(splashed.players[1].field[2]?.hp).toBe(30)
    expect(splashed.players[0].field[0]?.hp).toBe(110)

    const suck = main(game())
    put(suck.players[0], 0, 'moonlight_leecher', { energy: 1, hp: 40 })
    put(suck.players[1], 0, 'orc')
    const first = use(suck, 'drugged_vampiric_suck')
    expect(first.players[1].field[0]?.hp).toBe(70)
    expect(first.players[1].field[0]?.statuses.map((status) => status.kind)).toEqual(['asleep'])
    expect(first.players[0].field[0]?.hp).toBe(50)
    main(first)
    const second = use(first, 'drugged_vampiric_suck')
    expect(second.players[1].field[0]?.hp).toBe(60)
    expect(second.players[1].field[0]?.statuses.map((status) => status.kind)).toEqual(['asleep'])
    expect(second.players[0].field[0]?.hp).toBe(70)
  })

  it('heals asleep monsters at the end of every turn, then poison can wake them', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', {
      hp: 40,
      statuses: [{ kind: 'asleep', turns: 0, skipNextTick: false }, { kind: 'poison', turns: 2, skipNextTick: false }],
    })
    put(state.players[1], 0, 'blob', {
      hp: 40,
      statuses: [{ kind: 'asleep', turns: 0, skipNextTick: false }],
    })
    expect(listLegalActions(state).some((action) => action.type === 'USE_ABILITY')).toBe(false)
    state.phase = 'move'
    state.movedThisTurn = false
    expect(listLegalActions(state).some((action) => action.type === 'WITHDRAW' || action.type === 'ADVANCE')).toBe(false)

    const passed = endTurn(state)
    expect(passed.players[0].field[0]?.hp).toBe(40)
    expect(passed.players[0].field[0]?.statuses.some((status) => status.kind === 'asleep')).toBe(false)
    expect(passed.players[1].field[0]?.hp).toBe(50)
    expect(passed.players[1].field[0]?.statuses.some((status) => status.kind === 'asleep')).toBe(true)
  })

  it('doubles energy now and applies sleep at the start of your next turn', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob')
    put(state.players[1], 0, 'orc', { energy: 2 })
    state.players[0].hand = [{ instanceId: 'surge', defId: 'energy_surge' }]
    const surged = act(
      state,
      (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.targets[0]?.player === 1,
    )
    expect(surged.players[1].field[0]?.energy).toBe(6)
    expect(surged.players[1].field[0]?.statuses).toEqual([])
    expect(surged.players[1].field[0]?.sleepOnTurn).toBe(0)
    const opponent = endTurn(surged)
    expect(opponent.activePlayer).toBe(1)
    expect(opponent.players[1].field[0]?.statuses).toEqual([])
    const yours = endTurn(opponent)
    expect(yours.activePlayer).toBe(0)
    expect(yours.players[1].field[0]?.statuses.map((status) => status.kind)).toEqual(['asleep'])
    expect(yours.players[1].field[0]?.sleepOnTurn).toBeUndefined()
  })

  it('resolves each discarded card before the next, and assigns trading gold', () => {
    const alchemy = main(game())
    put(alchemy.players[0], 0, 'wavebrewer', { energy: 1 })
    put(alchemy.players[1], 0, 'blob')
    alchemy.players[0].hand = [
      { instanceId: 'a', defId: 'coffee' },
      { instanceId: 'b', defId: 'coffee' },
    ]
    let next = use(alchemy, 'ocean_alchemy')
    next = applyAction(next, { type: 'DISCARD_ANY_TOGGLE', instanceId: 'a' })
    next = applyAction(next, { type: 'DISCARD_ANY_TOGGLE', instanceId: 'b' })
    next = applyAction(next, { type: 'DISCARD_ANY_FINISH' })
    next = applyAction(next, { type: 'ALCHEMY_MODE', mode: 'damage' })
    next = act(next, (candidate) => candidate.type === 'ALCHEMY_TARGET')
    expect(next.players[1].field[0]?.hp).toBe(30)
    next = applyAction(next, { type: 'ALCHEMY_MODE', mode: 'energy' })
    next = act(next, (candidate) => candidate.type === 'ALCHEMY_TARGET' && candidate.target.slot === 0 && candidate.target.player === 0)
    expect(next.players[0].field[0]?.energy).toBe(2)
    expect(next.pending).toBeNull()

    const trade = main(game())
    put(trade.players[0], 0, 'seaborn_merchant', { energy: 1 })
    trade.players[0].hand = [{ instanceId: 'c', defId: 'coffee' }]
    let sold = use(trade, 'overseas_trading')
    expect(sold.abilityUsesLeft).toBe(1)
    sold = applyAction(sold, { type: 'DISCARD_ANY_TOGGLE', instanceId: 'c' })
    sold = applyAction(sold, { type: 'DISCARD_ANY_FINISH' })
    expect(sold.pending?.kind).toBe('assignGold')
    sold = applyAction(sold, { type: 'ASSIGN_GOLD', slot: 0 })
    sold = applyAction(sold, { type: 'ASSIGN_GOLD', slot: 0 })
    expect(sold.players[0].field[0]?.gold).toBe(2)
  })

  it('detonates every Gnome Bomb and then Removes it', () => {
    const state = main(game())
    put(state.players[0], 1, 'gnome_demolitionist', { energy: 2 })
    put(state.players[1], 0, 'blob', { instanceId: 'left' })
    put(state.players[1], 1, 'orc', { instanceId: 'host' })
    put(state.players[1], 2, 'blob', { instanceId: 'right' })
    const armed = use(
      state,
      'magnetic_bomb',
      (candidate) => candidate.type === 'USE_ABILITY' && candidate.target?.player === 1 && candidate.target.slot === 1,
    )
    expect(armed.players[1].field[1]?.equipment.map((equipment) => equipment.defId)).toEqual(['gnome_bomb'])
    expect(armed.players[1].field[1]?.equipment[0]?.hp).toBe(40)
    main(armed)
    armed.players[0].field[1]!.energy = 1
    const boom = use(armed, 'detonate')
    expect(boom.players[1].field[1]?.hp).toBe(30)
    expect(boom.players[1].field[0]?.hp).toBe(20)
    expect(boom.players[1].field[2]?.hp).toBe(20)
    expect(boom.players[1].field[1]?.equipment).toEqual([])
    expect(boom.players[1].removed.map((card) => card.defId)).toEqual(['gnome_bomb'])
    expect(boom.players[1].discard.map((card) => card.defId)).not.toContain('gnome_bomb')
  })

  it('forges a normal equipment card at +10 HP and adds Dwarven Spirit gold', () => {
    const state = main(game())
    put(state.players[0], 0, 'elder_smith', { energy: 1, gold: 3 })
    put(state.players[1], 0, 'orc')
    let forged = use(state, 'master_of_the_forge')
    expect(forged.players[0].field[0]?.gold).toBe(1)
    expect(listLegalActions(forged).some((action) => action.type === 'FORGE_PICK' && action.defId === 'pegasus_gift')).toBe(false)
    forged = applyAction(forged, { type: 'FORGE_PICK', defId: 'sword' })
    forged = act(forged, (candidate) => candidate.type === 'FORGE_ATTACH' && candidate.target.player === 1)
    expect(forged.players[1].field[0]?.equipment[0]).toMatchObject({ defId: 'sword', hp: 30, maxHp: 30 })

    const spirit = main(game())
    put(spirit.players[0], 0, 'elder_smith', { energy: 2, gold: 3 })
    put(spirit.players[1], 0, 'orc')
    expect(use(spirit, 'dwarven_spirit').players[1].field[0]?.hp).toBe(40)
  })
})
