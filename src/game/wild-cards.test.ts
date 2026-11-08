import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getCard } from './catalog'
import { applyAction } from './reducer'
import { createGame } from './setup'
import type { FieldMonster, GameAction, GameState, PlayerState } from './types'
import { abilityLines, cardAbilities, cardBodyText, withBladeCost } from '../ui/cardText'

function game(): GameState {
  return createGame(
    { name: 'P1', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { name: 'P2', cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'], topMonsterIndex: 0 },
    { skipHandoff: true, shuffleRandom: () => 0, rng: () => 6 },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<FieldMonster> = {}) {
  player.field[slot] = {
    instanceId: extra.instanceId ?? `${player.id}-${slot}-${defId}`,
    defId,
    hp: extra.hp ?? extra.maxHp ?? 50,
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
  return state
}

function action(state: GameState, predicate: (candidate: GameAction) => boolean): GameAction {
  const found = listLegalActions(state).find(predicate)
  if (!found) throw new Error('Action not found')
  return found
}

const blade = { instanceId: 'blade', defId: 'lifesteal_blade', hp: 30, maxHp: 30 }
const gift = { instanceId: 'gift', defId: 'pegasus_gift', hp: 20, maxHp: 20 }

describe('Wildersel cards', () => {
  it('prints the seven cards', () => {
    expect(getCard('corsair_of_wildersel')).toMatchObject({
      name: 'Corsair of Wildersel', points: 2, maxHp: 80, goldAffinity: true,
    })
    expect(getCard('public_speaker')).toMatchObject({ name: 'Public Speaker', points: 2, maxHp: 80 })
    expect(getCard('pegasus_gift')).toMatchObject({ name: 'Pegasus Gift', maxHp: 20, kind: 'equipment' })
    expect(getCard('haunted_mists')).toMatchObject({ name: 'Haunted Mists', effectId: 'hauntedMists' })
    expect(getCard('veridis_warrior')).toMatchObject({ name: 'Veridis Warrior', points: 2, maxHp: 100 })
    expect(getCard('lifesteal_blade')).toMatchObject({ name: 'Lifesteal Blade', maxHp: 30, kind: 'equipment' })
    expect(getCard('wizrobe')).toMatchObject({ name: 'Wizrobe', points: 2, maxHp: 90 })
    expect(cardAbilities(getCard('public_speaker')).join(' ')).toContain('Choose two other monster cards')
    const wizrobe = getCard('wizrobe')
    expect(wizrobe.kind === 'monster' && wizrobe.passiveText).toContain("this card's attacks gain +10 damage")
    expect(cardBodyText('haunted_mists')).toContain('no cards may target')
    expect(cardBodyText('lifesteal_blade')).toContain('additional 0')
  })

  it('gives Raid gold only when the target took damage', () => {
    const state = main(game())
    put(state.players[0], 0, 'corsair_of_wildersel', { hp: 80, maxHp: 80, energy: 1, instanceId: 'corsair' })
    put(state.players[1], 0, 'blob', { hp: 50, maxHp: 50, instanceId: 'foe' })
    const raided = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'raid'))
    expect(raided.players[1].field[0]?.hp).toBe(20)
    expect(raided.pending?.kind).toBe('assignGold')
    const paid = applyAction(raided, action(raided, (candidate) => candidate.type === 'ASSIGN_GOLD'))
    expect(paid.players[0].field[0]?.gold).toBe(1)

    const mirrored = main(game())
    put(mirrored.players[0], 0, 'corsair_of_wildersel', { hp: 80, maxHp: 80, energy: 1, instanceId: 'corsair' })
    put(mirrored.players[1], 0, 'blob', { hp: 50, maxHp: 50 })
    mirrored.players[1].iceMirrorCharges = 1
    const bounced = applyAction(
      mirrored,
      action(mirrored, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'raid'),
    )
    expect(bounced.pending).toBeNull()
    expect(bounced.players[1].iceMirrorCharges).toBe(0)
    expect(bounced.players[0].field[0]?.gold ?? 0).toBe(0)
    expect(bounced.players[0].field[0]?.hp).toBeLessThan(80)
  })

  it('deals 50 with Treblae Shot', () => {
    const state = main(game())
    put(state.players[0], 0, 'corsair_of_wildersel', { hp: 80, maxHp: 80, energy: 3 })
    put(state.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    const next = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'treblae_shot'))
    expect(next.players[1].field[0]?.hp).toBe(30)
  })

  it('arms Rally on two other monsters and saves the death effect until an opponent kills it', () => {
    const state = main(game())
    put(state.players[0], 0, 'public_speaker', { hp: 80, maxHp: 80, energy: 1, instanceId: 'speaker' })
    put(state.players[0], 1, 'blob', { energy: 0, instanceId: 'ally' })
    put(state.players[1], 0, 'blob', { energy: 0, instanceId: 'foe' })
    const rallied = applyAction(
      state,
      action(state, (candidate) =>
        candidate.type === 'USE_ABILITY' &&
        candidate.abilityId === 'speaker_rally' &&
        Boolean(candidate.targets?.some((target) => target.player === 1))),
    )
    expect(rallied.players[0].field[0]?.speakerArmed).toBe(true)
    expect(rallied.players[0].field[1]?.energy).toBe(1)
    expect(rallied.players[1].field[0]?.energy).toBe(1)
    expect(rallied.players[0].bonusTeamActions ?? 0).toBe(0)

    rallied.players[0].field[0]!.statuses = [{ kind: 'poison', turns: 1, skipNextTick: false, sourcePlayer: 1 }]
    rallied.players[0].field[0]!.hp = 10
    rallied.phase = 'end'
    const slain = applyAction(rallied, { type: 'END_TURN' })
    expect(slain.players[0].field[0]).toBeNull()
    expect(slain.players[0].field[1]?.energy).toBe(2)
    expect(slain.players[0].bonusTeamActions).toBe(1)

    let turn = applyAction(slain, { type: 'CONFIRM_HANDOFF' })
    turn = applyAction(turn, action(turn, (candidate) => candidate.type === 'SKIP_DRAW'))
    turn = applyAction(turn, action(turn, (candidate) => candidate.type === 'SKIP_MAIN'))
    turn = applyAction(turn, action(turn, (candidate) => candidate.type === 'SKIP_MOVE'))
    turn = applyAction(turn, action(turn, (candidate) => candidate.type === 'SKIP_ENERGY'))
    turn = applyAction(turn, action(turn, (candidate) => candidate.type === 'END_TURN'))
    turn = applyAction(turn, { type: 'CONFIRM_HANDOFF' })
    turn = applyAction(turn, action(turn, (candidate) => candidate.type === 'SKIP_DRAW'))
    expect(turn.abilityUsesLeft).toBe(2)
    expect(turn.players[0].bonusTeamActions ?? 0).toBe(0)
  })

  it('does not trigger the speaker when it is unarmed, withdrawn, or slain by its owner', () => {
    const own = main(game())
    put(own.players[0], 0, 'public_speaker', { hp: 10, maxHp: 80, speakerArmed: true, instanceId: 'speaker' })
    put(own.players[0], 1, 'blob', { instanceId: 'ally' })
    own.players[0].field[0]!.statuses = [{ kind: 'poison', turns: 1, skipNextTick: false, sourcePlayer: 0 }]
    own.phase = 'end'
    const selfSlain = applyAction(own, { type: 'END_TURN' })
    expect(selfSlain.players[0].field[1]?.energy ?? 0).toBe(0)
    expect(selfSlain.players[0].bonusTeamActions ?? 0).toBe(0)

    const withdrawn = main(game())
    put(withdrawn.players[0], 0, 'public_speaker', {
      hp: 10, maxHp: 80, stance: 'withdrawn', speakerArmed: true, instanceId: 'speaker',
    })
    put(withdrawn.players[0], 1, 'blob')
    withdrawn.players[0].field[0]!.statuses = [{ kind: 'poison', turns: 1, skipNextTick: false, sourcePlayer: 1 }]
    withdrawn.phase = 'end'
    const hidden = applyAction(withdrawn, { type: 'END_TURN' })
    expect(hidden.players[0].bonusTeamActions ?? 0).toBe(0)
  })

  it('records the player who applied poison', () => {
    const state = main(game())
    state.activePlayer = 1
    put(state.players[1], 0, 'wyvern', { hp: 120, maxHp: 120, energy: 3, instanceId: 'wyvern' })
    put(state.players[0], 0, 'public_speaker', { hp: 80, maxHp: 80, instanceId: 'speaker' })
    const stung = applyAction(
      state,
      action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'tail_sting'),
    )
    expect(stung.players[0].field[0]?.statuses[0]).toMatchObject({ kind: 'poison', sourcePlayer: 1 })
  })

  it('plays Uprising monsters with 1 energy without raising a Wizrobe', () => {
    const state = main(game())
    put(state.players[0], 0, 'public_speaker', { hp: 80, maxHp: 80, energy: 3, instanceId: 'speaker' })
    put(state.players[0], 1, 'wizrobe', { hp: 90, maxHp: 90, instanceId: 'wiz' })
    put(state.players[1], 0, 'blob')
    state.players[0].hand = [
      { instanceId: 'm1', defId: 'blob' },
      { instanceId: 'm2', defId: 'blob' },
    ]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'uprising'))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PLAY_MONSTER' && candidate.handIndex === 0))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PLAY_MONSTER'))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'PORTAL_FINISH'))
    const entered = next.players[0].field.filter((monster) => monster?.defId === 'blob')
    expect(entered).toHaveLength(2)
    expect(entered.every((monster) => monster?.energy === 1)).toBe(true)
    expect(next.cardsPlayedThisTurn).toBe(2)
    expect(next.players[0].field[1]?.attackBonus ?? 0).toBe(0)
  })

  it('lets Pegasus Gift move once without spending the turn move', () => {
    const state = main(game())
    put(state.players[0], 0, 'blob', { equipment: [gift], instanceId: 'rider' })
    put(state.players[1], 0, 'blob')
    const moved = applyAction(state, action(state, (candidate) => candidate.type === 'PEGASUS_MOVE'))
    expect(moved.players[0].field[0]?.stance).toBe('withdrawn')
    expect(moved.movedThisTurn).toBe(false)
    expect(listLegalActions(moved).some((candidate) => candidate.type === 'PEGASUS_MOVE')).toBe(false)

    const late = main(game())
    put(late.players[0], 0, 'blob', { equipment: [gift] })
    put(late.players[1], 0, 'blob')
    late.playedCardThisTurn = true
    expect(listLegalActions(late).some((candidate) => candidate.type === 'PEGASUS_MOVE')).toBe(false)
    late.phase = 'move'
    expect(listLegalActions(late).some((candidate) => candidate.type === 'PEGASUS_MOVE')).toBe(true)
    expect(listLegalActions(late).some((candidate) => candidate.type === 'WITHDRAW')).toBe(true)

    const goo = main(game())
    put(goo.players[0], 0, 'blob', {
      equipment: [gift],
      statuses: [{ kind: 'goo', turns: 1, skipNextTick: false }],
    })
    expect(listLegalActions(goo).some((candidate) => candidate.type === 'PEGASUS_MOVE')).toBe(false)

    const bone = main(game())
    put(bone.players[0], 0, 'boneling', { hp: 40, maxHp: 40, equipment: [gift], instanceId: 'bone' })
    put(bone.players[0], 1, 'blob')
    const died = applyAction(bone, action(bone, (candidate) => candidate.type === 'PEGASUS_MOVE' && candidate.stance === 'withdrawn'))
    expect(died.players[0].field[0]).toBeNull()

    const foeTurn = main(game())
    foeTurn.activePlayer = 1
    put(foeTurn.players[0], 0, 'blob', { equipment: [gift] })
    put(foeTurn.players[1], 0, 'blob')
    expect(listLegalActions(foeTurn).some((candidate) => candidate.type === 'PEGASUS_MOVE')).toBe(false)
  })

  it('requires a discard for Haunted Mists and blocks both players from targeting each other', () => {
    const empty = main(game())
    put(empty.players[0], 0, 'blob')
    put(empty.players[1], 0, 'blob')
    empty.players[0].hand = [{ instanceId: 'mists', defId: 'haunted_mists' }]
    empty.players[0].discard = []
    expect(listLegalActions(empty).some((candidate) => candidate.type === 'PLAY_EFFECT')).toBe(false)

    const state = main(game())
    put(state.players[0], 0, 'veridis_warrior', { hp: 100, maxHp: 100, energy: 1, instanceId: 'warrior' })
    put(state.players[0], 1, 'public_speaker', { hp: 80, maxHp: 80, energy: 1, instanceId: 'speaker' })
    put(state.players[0], 2, 'blob', { instanceId: 'ally' })
    put(state.players[1], 0, 'blob', { instanceId: 'foe' })
    state.players[0].hand = [
      { instanceId: 'mists', defId: 'haunted_mists' },
      { instanceId: 'again', defId: 'recursion' },
    ]
    state.players[0].discard = [{ instanceId: 'old', defId: 'blob' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'HAUNTED_PICK'))
    expect(next.players[0].removed.map((card) => card.instanceId)).toContain('old')
    expect(next.players[0].ethereal?.[0]?.card.defId).toBe('haunted_mists')
    expect(listLegalActions(next).some((candidate) => candidate.type === 'REWIND_USE')).toBe(false)
    expect(listLegalActions(next).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'slash')).toBe(false)
    const rallies = listLegalActions(next).filter((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'speaker_rally')
    expect(rallies.length).toBeGreaterThan(0)
    expect(rallies.every((candidate) => candidate.type === 'USE_ABILITY' && candidate.targets?.every((target) => target.player === 0))).toBe(true)
    expect(listLegalActions(next).some((candidate) => candidate.type === 'PLAY_EFFECT')).toBe(true)

    next.activePlayer = 1
    next.abilityUsesLeft = 1
    next.actedSlots = []
    put(next.players[1], 0, 'veridis_warrior', { hp: 100, maxHp: 100, energy: 1, instanceId: 'enemy-warrior' })
    expect(listLegalActions(next).some((candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'slash')).toBe(false)

    next.activePlayer = 0
    next.phase = 'end'
    next = applyAction(next, { type: 'END_TURN' })
    expect(next.players[0].ethereal?.[0]?.card.defId).toBe('haunted_mists')
    next = applyAction(next, { type: 'CONFIRM_HANDOFF' })
    next.phase = 'end'
    next = applyAction(next, { type: 'END_TURN' })
    expect(next.players[0].ethereal).toBeUndefined()
    expect(next.players[0].discard.some((card) => card.defId === 'haunted_mists')).toBe(true)
  })

  it('spends Veridian Fires in one packet, including a lethal payment, and crafts equipment', () => {
    const state = main(game())
    put(state.players[0], 0, 'veridis_warrior', { hp: 100, maxHp: 100, energy: 1, instanceId: 'warrior' })
    put(state.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'veridian_fires'))
    next = applyAction(next, action(next, (candidate) => candidate.type === 'VERIDIAN_PAY' && candidate.times === 0))
    expect(next.players[0].field[0]?.hp).toBe(100)
    expect(next.players[1].field[0]?.hp).toBe(80)
    expect(next.pending).toBeNull()

    const hit = main(game())
    put(hit.players[0], 0, 'veridis_warrior', { hp: 100, maxHp: 100, energy: 1 })
    put(hit.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    let struck = applyAction(hit, action(hit, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'veridian_fires'))
    struck = applyAction(struck, action(struck, (candidate) => candidate.type === 'VERIDIAN_PAY' && candidate.times === 2))
    struck = applyAction(struck, action(struck, (candidate) => candidate.type === 'VERIDIAN_STRIKE'))
    expect(struck.players[0].field[0]?.hp).toBe(80)
    expect(struck.players[1].field[0]?.hp).toBe(40)

    const lethal = main(game())
    put(lethal.players[0], 0, 'veridis_warrior', { hp: 20, maxHp: 100, energy: 1, instanceId: 'warrior' })
    put(lethal.players[0], 1, 'blob')
    put(lethal.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    let dying = applyAction(lethal, action(lethal, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'veridian_fires'))
    dying = applyAction(dying, action(dying, (candidate) => candidate.type === 'VERIDIAN_PAY' && candidate.times === 2))
    dying = applyAction(dying, action(dying, (candidate) => candidate.type === 'VERIDIAN_STRIKE'))
    expect(dying.players[0].field[0]).toBeNull()
    expect(dying.players[1].field[0]?.hp).toBe(40)
    expect(dying.winner).toBeNull()

    const craft = main(game())
    put(craft.players[0], 0, 'veridis_warrior', { hp: 100, maxHp: 100, energy: 1, instanceId: 'warrior' })
    put(craft.players[1], 0, 'blob')
    let made = applyAction(craft, action(craft, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'veridian_bloodcraft'))
    made = applyAction(made, action(made, (candidate) => candidate.type === 'BLOODCRAFT_PICK' && candidate.defId === 'sword'))
    expect(made.players[0].field[0]?.hp).toBe(80)
    expect(made.players[0].field[0]?.equipment.map((item) => item.defId)).toEqual(['sword'])
    made.actedSlots = []
    made.abilityUsesLeft = 1
    made.pending = null
    made = applyAction(made, action(made, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'veridian_bloodcraft'))
    made = applyAction(made, action(made, (candidate) => candidate.type === 'BLOODCRAFT_PICK' && candidate.defId === 'sword'))
    expect(made.players[0].field[0]?.equipment).toHaveLength(2)

    const fatalCraft = main(game())
    put(fatalCraft.players[0], 0, 'veridis_warrior', { hp: 20, maxHp: 100, energy: 1, instanceId: 'warrior' })
    put(fatalCraft.players[0], 1, 'blob')
    put(fatalCraft.players[1], 0, 'blob')
    let crafted = applyAction(fatalCraft, action(fatalCraft, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'veridian_bloodcraft'))
    crafted = applyAction(crafted, action(crafted, (candidate) => candidate.type === 'BLOODCRAFT_PICK' && candidate.defId === 'lifesteal_blade'))
    expect(crafted.players[0].field[0]).toBeNull()
    expect(crafted.players[0].discard.map((card) => card.defId)).toEqual(expect.arrayContaining(['lifesteal_blade', 'veridis_warrior']))
  })

  it('adds a kept energy cost, 10 damage, 10 healing, and shows the new cost', () => {
    const poor = main(game())
    put(poor.players[0], 0, 'blob', { energy: 1, equipment: [blade], instanceId: 'blob' })
    put(poor.players[1], 0, 'blob', { hp: 50, maxHp: 50 })
    expect(listLegalActions(poor).some((candidate) => candidate.type === 'USE_ABILITY')).toBe(false)

    const state = main(game())
    put(state.players[0], 0, 'blob', { hp: 40, maxHp: 50, energy: 2, equipment: [blade], instanceId: 'blob' })
    put(state.players[1], 0, 'blob', { hp: 50, maxHp: 50 })
    const next = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'wakkle'))
    expect(next.players[1].field[0]?.hp).toBe(20)
    expect(next.players[0].field[0]?.hp).toBe(50)
    expect(next.players[0].field[0]?.energy).toBe(1)

    const lines = withBladeCost(abilityLines(getCard('blob')), state.players[0].field[0]!)
    expect(lines.find((line) => line.id === 'wakkle')?.cost).toEqual({ require: 1, spend: 1 })
  })

  it('searches the top effect, plays any effect as the Wizrobe, and counts that play', () => {
    const state = main(game())
    put(state.players[0], 0, 'wizrobe', {
      hp: 50, maxHp: 90, energy: 3, equipment: [blade], instanceId: 'wiz',
    })
    put(state.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    state.players[0].deck = [
      { instanceId: 'top', defId: 'blob' },
      { instanceId: 'potion', defId: 'health_potion' },
      { instanceId: 'under', defId: 'blob' },
    ]
    state.players[0].hand = [{ instanceId: 'archer', defId: 'long_range_archer' }]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'USE_ABILITY' && candidate.abilityId === 'spell_casting'))
    expect(next.players[0].deck.map((card) => card.instanceId)).toEqual(['top', 'under'])
    expect(next.players[0].hand.map((card) => card.instanceId)).toEqual(['archer', 'potion'])
    next = applyAction(next, action(next, (candidate) =>
      candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0 && candidate.targets[0]?.player === 1))
    expect(next.players[1].field[0]?.hp).toBe(40)
    expect(next.players[0].field[0]?.hp).toBe(60)
    expect(next.players[0].field[0]?.attackBonus).toBe(10)
    expect(next.cardsPlayedThisTurn ?? 0).toBe(0)
  })

  it('counts a Recursion replay toward Wizrobe and ignores a Darklight discard play', () => {
    const state = main(game())
    put(state.players[0], 0, 'wizrobe', { hp: 90, maxHp: 90, energy: 1, instanceId: 'wiz' })
    put(state.players[1], 0, 'blob', { hp: 100, maxHp: 100 })
    state.players[0].hand = [
      { instanceId: 'loop', defId: 'recursion' },
      { instanceId: 'archer', defId: 'long_range_archer' },
    ]
    let next = applyAction(state, action(state, (candidate) => candidate.type === 'PLAY_EFFECT' && candidate.handIndex === 0))
    expect(next.players[0].field[0]?.attackBonus ?? 0).toBe(0)
    next = applyAction(next, action(next, (candidate) =>
      candidate.type === 'PLAY_EFFECT' && candidate.targets[0]?.player === 1))
    expect(next.players[1].field[0]?.hp).toBe(60)
    expect(next.players[0].field[0]?.attackBonus).toBe(20)
    expect(next.cardsPlayedThisTurn).toBe(1)

    const dark = main(game())
    put(dark.players[0], 0, 'wizrobe', { hp: 90, maxHp: 90, instanceId: 'wiz' })
    put(dark.players[1], 0, 'blob', { hp: 80, maxHp: 80 })
    dark.players[0].hand = [{ instanceId: 'portal', defId: 'darklight_portal' }]
    dark.players[0].discard = [{ instanceId: 'archer', defId: 'long_range_archer' }]
    let replay = applyAction(dark, action(dark, (candidate) => candidate.type === 'PLAY_EFFECT'))
    replay = applyAction(replay, action(replay, (candidate) =>
      candidate.type === 'PLAY_EFFECT' && candidate.targets[0]?.player === 1))
    expect(replay.players[1].field[0]?.hp).toBe(60)
    expect(replay.players[0].field[0]?.attackBonus).toBe(10)
    expect(replay.cardsPlayedThisTurn).toBe(1)
  })
})
