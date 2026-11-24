import { describe, expect, it } from 'vitest'
import { listLegalActions } from './actions'
import { getMonster } from './catalog'
import { checkLosses, grantEnergy } from './helpers'
import { applyAction } from './reducer'
import { createGame } from './setup'
import { BESIDE_SLOT, type GameState, type PlayerState } from './types'

function game(): GameState {
  return createGame(
    [
      {
        name: 'P1',
        cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'],
        topMonsterIndex: 0,
      },
      {
        name: 'P2',
        cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'],
        topMonsterIndex: 0,
      },
    ],
    { skipHandoff: true },
  )
}

function put(player: PlayerState, slot: number, defId: string, extra: Partial<PlayerState['field'][0]> = {}) {
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
  let next = state
  next.players[0]!.isFirstTurn = false
  next.players[0]!.hasFinishedFirstTurn = true
  next.players[1]!.isFirstTurn = false
  next.players[1]!.hasFinishedFirstTurn = true
  next.phase = 'main'
  next.abilityUsesLeft = 1
  next.actedSlots = []
  next.playedCardThisTurn = false
  return next
}

describe('unique cards', () => {
  it('prints the Unique batch and pirate tags', () => {
    expect(getMonster('kings_of_the_ocean')).toMatchObject({
      points: 6,
      maxHp: 300,
      unique: true,
      besideRow: true,
      goldOnly: true,
      goldAffinity: true,
    })
    expect(getMonster('kings_of_the_ocean').families).toContain('pirate')
    expect(getMonster('drowned_pirate').families).toContain('pirate')
    expect(getMonster('corsair_of_wildersel').families).toContain('pirate')
    expect(getMonster('hollow_rogue').families).toContain('pirate')
    expect(getMonster('lord_kalung_firefist').unique).toBe(true)
    expect(getMonster('relkar_goldflame').unique).toBe(true)
    expect(getMonster('relkar_goldflame').families).toContain('unending_legion')
    expect(getMonster('lord_devadian').unique).toBe(true)
    expect(getMonster('thornflower_monstrosity').unique).toBe(true)
    expect(getMonster('thornflower_monstrosity').families).toContain('plant')
  })

  it('sets a Unique aside at game start and offers it during the energy phase', () => {
    const state = createGame(
      [
        {
          name: 'P1',
          cardIds: [
            'blob',
            'blob',
            'blob',
            'blob',
            'lord_kalung_firefist',
            'coffee',
          ],
          topMonsterIndex: 0,
          setAsideIndex: 4,
        },
        {
          name: 'P2',
          cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'],
          topMonsterIndex: 0,
        },
      ],
      { skipHandoff: true },
    )
    expect(state.players[0]!.setAside?.defId).toBe('lord_kalung_firefist')
    expect(state.players[0]!.hand.concat(state.players[0]!.deck).map((c) => c.defId)).not.toContain(
      'lord_kalung_firefist',
    )

    let next = main(state)
    put(next.players[0]!, 0, 'blob')
    next = applyAction(next, { type: 'SKIP_MAIN' })
    next = applyAction(next, { type: 'SKIP_MOVE' })
    expect(next.phase).toBe('energy')
    expect(next.pending).toBeNull()
    expect(listLegalActions(next).some((a) => a.type === 'PLAY_SET_ASIDE')).toBe(true)
    expect(listLegalActions(next).some((a) => a.type === 'ATTACH_ENERGY' || a.type === 'SKIP_ENERGY')).toBe(
      true,
    )

    const skipped = applyAction(next, { type: 'SKIP_ENERGY' })
    expect(skipped.phase).toBe('end')
    expect(skipped.players[0]!.setAside?.defId).toBe('lord_kalung_firefist')
  })

  it('plays the set-aside Unique during energy and ends the phase', () => {
    const state = createGame(
      [
        {
          name: 'P1',
          cardIds: ['blob', 'blob', 'blob', 'blob', 'lord_kalung_firefist', 'coffee'],
          topMonsterIndex: 0,
          setAsideIndex: 4,
        },
        {
          name: 'P2',
          cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'],
          topMonsterIndex: 0,
        },
      ],
      { skipHandoff: true },
    )
    let next = main(state)
    put(next.players[0]!, 0, 'blob')
    next = applyAction(next, { type: 'SKIP_MAIN' })
    next = applyAction(next, { type: 'SKIP_MOVE' })
    expect(next.phase).toBe('energy')
    const play = listLegalActions(next).find(
      (a) => a.type === 'PLAY_SET_ASIDE' && a.stance === 'active',
    )
    expect(play).toBeTruthy()
    next = applyAction(next, play!)
    expect(next.players[0]!.setAside).toBeNull()
    expect(next.players[0]!.field.some((m) => m?.defId === 'lord_kalung_firefist')).toBe(true)
    expect(next.phase).toBe('end')
    const kalung = next.players[0]!.field.find((m) => m?.defId === 'lord_kalung_firefist')
    expect(kalung?.energy).toBe(2)
  })

  it('does not offer the set-aside when the energy phase is already skipped', () => {
    const state = createGame(
      [
        {
          name: 'P1',
          cardIds: ['blob', 'blob', 'blob', 'blob', 'lord_kalung_firefist', 'coffee'],
          topMonsterIndex: 0,
          setAsideIndex: 4,
        },
        {
          name: 'P2',
          cardIds: ['blob', 'blob', 'blob', 'blob', 'blob', 'blob'],
          topMonsterIndex: 0,
        },
      ],
      { skipHandoff: true },
    )
    let next = main(state)
    put(next.players[0]!, 0, 'blob')
    next.skipEnergyPhase = true
    next = applyAction(next, { type: 'SKIP_MAIN' })
    next = applyAction(next, { type: 'SKIP_MOVE' })
    expect(next.phase).toBe('end')
    expect(listLegalActions(next).some((a) => a.type === 'PLAY_SET_ASIDE')).toBe(false)
  })

  it('places the Kings beside the row and pays costs with gold only', () => {
    let state = main(game())
    state.players[0]!.beside = {
      instanceId: 'kings',
      defId: 'kings_of_the_ocean',
      hp: 300,
      maxHp: 300,
      stance: 'active',
      energy: 5,
      pendingEnergy: 0,
      statuses: [],
      equipment: [],
      gold: 2,
      pirate: true,
    }
    put(state.players[1]!, 0, 'blob')
    const hurricane = listLegalActions(state).find(
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.slot === BESIDE_SLOT &&
        a.abilityId === 'hurricane' &&
        a.goldSpend === 2 &&
        a.target?.player === 1 &&
        a.target.slot === 0,
    )
    expect(hurricane).toBeTruthy()
    put(state.players[1]!, 0, 'blob', { hp: 200, maxHp: 200 })
    state = applyAction(state, hurricane!)
    expect(state.players[0]!.beside?.gold).toBe(0)
    expect(state.players[0]!.beside?.energy).toBe(5)
    expect(state.players[1]!.field[0]).toMatchObject({ defId: 'blob', hp: 150 })
  })

  it('shields Relkar\'s controller from losing on points', () => {
    const state = main(game())
    put(state.players[0]!, 0, 'relkar_goldflame')
    put(state.players[1]!, 0, 'blob')
    state.players[0]!.points = 0
    checkLosses(state)
    expect(state.winner).toBeNull()

    state.players[0]!.field[0] = null
    checkLosses(state)
    expect(state.winner).toBe(1)
  })

  it('lets Incineration choose one for 70 fire and hit the rest for 20', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_kalung_firefist', { energy: 4 })
    put(state.players[1]!, 0, 'blob', { hp: 100, maxHp: 100, instanceId: 'a' })
    put(state.players[1]!, 1, 'blob', { hp: 100, maxHp: 100, instanceId: 'b' })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'incineration',
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'incinerationPick' })
    expect(state.players[1]!.field[0]?.hp).toBe(100)
    expect(listLegalActions(state).filter((a) => a.type === 'INCINERATION_PICK')).toHaveLength(2)
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) =>
          a.type === 'INCINERATION_PICK' &&
          a.target.player === 1 &&
          a.target.kind === 'monster' &&
          a.target.slot === 0,
      )!,
    )
    expect(state.players[1]!.field[0]?.hp).toBe(30)
    expect(state.players[1]!.field[1]?.hp).toBe(80)
    expect(state.pending).toBeNull()
  })

  it('lets Kalung Fireball discard, then shoot blast and burn', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_kalung_firefist', { energy: 2 })
    put(state.players[1]!, 0, 'blob', { hp: 80, maxHp: 80 })
    state.players[0]!.hand = [{ instanceId: 'spare', defId: 'blob' }]
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'kalung_fireball',
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'fireballDiscard' })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'FIREBALL_DISCARD')!,
    )
    expect(state.pending).toMatchObject({ kind: 'fireballShot' })
    expect(listLegalActions(state).some((a) => a.type === 'FIREBALL_SHOT')).toBe(true)
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) =>
          a.type === 'FIREBALL_SHOT' &&
          a.target.player === 1 &&
          a.target.kind === 'monster' &&
          a.target.slot === 0,
      )!,
    )
    expect(state.players[1]!.field[0]?.hp).toBe(40)
    expect(state.players[1]!.field[0]?.statuses.some((status) => status.kind === 'burn')).toBe(true)
    expect(state.pending).toBeNull()
  })

  it('raises Fury damage and remembers it on the instance', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'relkar_goldflame', { energy: 1 })
    put(state.players[1]!, 0, 'blob', { hp: 200, maxHp: 200 })
    const fury = listLegalActions(state).find(
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.abilityId === 'fury' &&
        a.target?.player === 1 &&
        a.target.slot === 0,
    )
    expect(fury).toBeTruthy()
    state = applyAction(state, fury!)
    expect(state.players[0]!.field[0]?.furyDamage).toBe(30)
    expect(state.cardMemory?.[state.players[0]!.field[0]!.instanceId]?.furyDamage).toBe(30)
    expect(state.players[1]!.field[0]?.hp).toBe(180)
  })

  it('lets The Legion Grows destroy a hand monster and place a Legionary', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'relkar_goldflame', { energy: 1 })
    put(state.players[1]!, 0, 'blob')
    state.players[0]!.hand.push({ instanceId: 'fodder', defId: 'blob' })
    state.players[0]!.hand.push({ instanceId: 'sword', defId: 'sword' })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'legion_grows')!,
    )
    expect(state.pending).toMatchObject({ kind: 'legionGrows' })
    const picks = listLegalActions(state).filter((a) => a.type === 'LEGION_GROWS_DISCARD')
    expect(picks.some((a) => a.type === 'LEGION_GROWS_DISCARD' && a.instanceId === 'fodder')).toBe(
      true,
    )
    expect(picks.some((a) => a.type === 'LEGION_GROWS_DISCARD' && a.instanceId === 'sword')).toBe(
      false,
    )
    state = applyAction(state, { type: 'LEGION_GROWS_DISCARD', instanceId: 'fodder' })
    expect(state.pending).toBeNull()
    expect(state.players[0]!.hand.some((card) => card.instanceId === 'fodder')).toBe(false)
    expect(state.players[0]!.removed.some((card) => card.instanceId === 'fodder')).toBe(true)
    expect(state.players[0]!.field.some((monster) => monster?.defId === 'unending_legionary')).toBe(
      true,
    )
  })

  it('shares Thornflower energy once without chaining', () => {
    const state = main(game())
    put(state.players[0]!, 0, 'thornflower_monstrosity')
    put(state.players[0]!, 1, 'thornflower_monstrosity', {
      pointsOverride: 0,
      instanceId: 'sprout',
    })
    grantEnergy(state, state.players[0]!.field[0]!, 1)
    expect(state.players[0]!.field[0]?.energy).toBe(1)
    expect(state.players[0]!.field[1]?.energy).toBe(1)
  })

  it('lets Feed choose an active damaged monster and heal Devadian', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_devadian', { energy: 2, hp: 160, maxHp: 200 })
    put(state.players[1]!, 0, 'blob', { hp: 40, maxHp: 50 })
    put(state.players[1]!, 1, 'blob', { hp: 50, maxHp: 50, stance: 'withdrawn' })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'feed')!,
    )
    expect(state.pending).toMatchObject({ kind: 'feedTarget' })
    const targets = listLegalActions(state).filter((a) => a.type === 'FEED_TARGET')
    // Devadian (damaged) and the active enemy Blob; withdrawn full-HP Blob is illegal.
    expect(targets).toHaveLength(2)
    const enemy = targets.find(
      (a) =>
        a.type === 'FEED_TARGET' &&
        a.target.player === 1 &&
        a.target.kind === 'monster' &&
        a.target.slot === 0,
    )
    expect(enemy).toBeTruthy()
    state = applyAction(state, enemy!)
    expect(state.players[1]!.field[0]?.hp).toBe(20)
    expect(state.players[0]!.field[0]?.hp).toBe(180)
    expect(state.pending).toBeNull()
  })

  it('lets Wings of Night Feed ignore stance on damaged monsters', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_devadian', {
      energy: 5,
      wingsAnyTarget: true,
      extraAbilityUses: 1,
    })
    put(state.players[1]!, 0, 'blob', {
      hp: 40,
      maxHp: 50,
      stance: 'withdrawn',
    })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'feed')!,
    )
    expect(state.pending).toMatchObject({ kind: 'feedTarget', ignoreStance: true })
    const feed = listLegalActions(state).find(
      (a) =>
        a.type === 'FEED_TARGET' &&
        a.target.player === 1 &&
        a.target.kind === 'monster' &&
        a.target.slot === 0,
    )
    expect(feed).toBeTruthy()
    state = applyAction(state, feed!)
    expect(state.players[1]!.field[0]?.hp).toBe(20)
    expect(state.players[0]!.field[0]?.wingsAnyTarget).toBeUndefined()
  })

  it('lets Wings expand Vicious Claws to withdrawn cards and past Boneling locks', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_devadian', {
      energy: 1,
      wingsAnyTarget: true,
      extraAbilityUses: 1,
    })
    put(state.players[1]!, 0, 'boneling')
    put(state.players[1]!, 1, 'blob', { hp: 50, maxHp: 50, stance: 'withdrawn' })

    const withoutWings = main(game())
    put(withoutWings.players[0]!, 0, 'lord_devadian', { energy: 1 })
    put(withoutWings.players[1]!, 0, 'boneling')
    put(withoutWings.players[1]!, 1, 'blob', { hp: 50, maxHp: 50, stance: 'withdrawn' })
    const locked = listLegalActions(withoutWings).filter(
      (a) => a.type === 'USE_ABILITY' && a.abilityId === 'vicious_claws',
    )
    expect(
      locked.every(
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.target?.kind === 'monster' &&
          a.target.slot === 0,
      ),
    ).toBe(true)

    const claws = listLegalActions(state).find(
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.abilityId === 'vicious_claws' &&
        a.target?.kind === 'monster' &&
        a.target.player === 1 &&
        a.target.slot === 1,
    )
    expect(claws).toBeTruthy()
    state = applyAction(state, claws!)
    expect(state.players[1]!.field[1]?.hp).toBe(30)
    expect(state.players[0]!.field[0]?.wingsAnyTarget).toBeUndefined()
  })

  it('lets Wings expand Shadow Matter to any-card multi-hits', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_devadian', {
      energy: 2,
      wingsAnyTarget: true,
      extraAbilityUses: 1,
    })
    put(state.players[1]!, 0, 'boneling')
    put(state.players[1]!, 1, 'blob', { stance: 'withdrawn', hp: 50, maxHp: 50 })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'shadow_matter')!,
    )
    expect(state.pending).toMatchObject({ kind: 'multiHit', scope: 'any' })
    const shot = listLegalActions(state).find(
      (a) =>
        a.type === 'PENDING_TARGET' &&
        a.target.player === 1 &&
        a.target.kind === 'monster' &&
        a.target.slot === 1,
    )
    expect(shot).toBeTruthy()
    state = applyAction(state, shot!)
    expect(state.players[1]!.field[1]?.hp).toBe(20)
  })

  it('lets Hail To The Kings mark an owned card as pirate from the beside zone', () => {
    let state = main(game())
    state.players[0]!.beside = {
      instanceId: 'kings',
      defId: 'kings_of_the_ocean',
      hp: 300,
      maxHp: 300,
      stance: 'active',
      energy: 0,
      pendingEnergy: 0,
      statuses: [],
      equipment: [],
      gold: 2,
    }
    put(state.players[0]!, 0, 'blob')
    const hail = listLegalActions(state).find(
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.slot === BESIDE_SLOT &&
        a.abilityId === 'hail_to_the_kings' &&
        a.target?.kind === 'monster' &&
        a.target.player === 0 &&
        a.target.slot === 0 &&
        (a.goldRequire ?? 0) + (a.goldSpend ?? 0) > 0,
    )
    expect(hail).toBeTruthy()
    state = applyAction(state, hail!)
    expect(state.players[0]!.field[0]?.pirate).toBe(true)
    expect(state.pirateTags).toContain(state.players[0]!.field[0]!.instanceId)
  })

  it('offers Bloodlust when Feed kills, without resuming Feed on the corpse', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_devadian', { energy: 2, hp: 160, maxHp: 200 })
    put(state.players[1]!, 0, 'blob', { hp: 20, maxHp: 100 })
    state = applyAction(
      state,
      listLegalActions(state).find((a) => a.type === 'USE_ABILITY' && a.abilityId === 'feed')!,
    )
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) =>
          a.type === 'FEED_TARGET' &&
          a.target.player === 1 &&
          a.target.kind === 'monster' &&
          a.target.slot === 0,
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'bloodlustChoice' })
    expect(state.pendingStack.some((p) => p.kind === 'feedTarget')).toBe(false)
    expect(state.players[1]!.field[0]?.hp).toBeLessThanOrEqual(0)
    expect(state.players[0]!.field[0]?.hp).toBe(180)
    expect(listLegalActions(state).some((a) => a.type === 'FEED_TARGET')).toBe(false)
    expect(listLegalActions(state).some((a) => a.type === 'BLOODLUST_ACCEPT')).toBe(true)

    const beforePoints = state.players[1]!.points
    state = applyAction(state, { type: 'BLOODLUST_ACCEPT' })
    expect(state.players[1]!.field[0]).toBeNull()
    expect(state.players[1]!.points).toBe(beforePoints)
    expect(state.players[0]!.field[0]?.bloodlustStacks).toBe(1)
    expect(state.pending).toBeNull()
  })

  it('lets Green Fairy end-of-turn heal offer Monstrous Growth on Thornflower', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'green_fairy')
    put(state.players[0]!, 1, 'thornflower_monstrosity', { hp: 80, maxHp: 100 })
    put(state.players[1]!, 0, 'blob')
    state.phase = 'end'
    state = applyAction(state, { type: 'END_TURN' })
    expect(state.pending).toMatchObject({ kind: 'fairyHeal', remaining: 1 })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) =>
          a.type === 'FAIRY_HEAL' &&
          a.target.kind === 'monster' &&
          a.target.slot === 1,
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'thornGrowth', amount: 10 })
    expect(state.pendingStack.some((p) => p.kind === 'fairyHeal')).toBe(true)
    expect(state.players[0]!.field[1]?.hp).toBe(80)

    state = applyAction(state, {
      type: 'THORN_GROWTH_ACCEPT',
      besideSlot: 1,
    })
    expect(state.players[0]!.field.some((m) => m?.pointsOverride === 0)).toBe(true)
    expect(state.players[0]!.field[1]?.hp).toBe(80)
    expect(state.pending).toBeNull()
    expect(state.activePlayer).toBe(1)
    expect(state.awaitingHandoff).toBe(true)
  })

  it('offers Bloodlust when Shadow Matter kills through a multi-hit (including with Yentir)', () => {
    let state = main(game())
    put(state.players[0]!, 0, 'lord_devadian', {
      energy: 2,
      equipment: [{ instanceId: 'yentir', defId: 'yentir_starforged', hp: 0, maxHp: 0 }],
    })
    put(state.players[1]!, 0, 'wavebrewer')
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) => a.type === 'USE_ABILITY' && a.abilityId === 'shadow_matter',
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'multiHit' })
    state = applyAction(
      state,
      listLegalActions(state).find(
        (a) =>
          a.type === 'PENDING_TARGET' &&
          a.target.player === 1 &&
          a.target.kind === 'monster' &&
          a.target.slot === 0,
      )!,
    )
    expect(state.pending).toMatchObject({ kind: 'bloodlustChoice' })
    expect(state.players[1]!.field[0]?.defId).toBe('wavebrewer')
    expect(state.players[1]!.field[0]!.hp).toBeLessThanOrEqual(0)
    expect(listLegalActions(state).some((a) => a.type === 'BLOODLUST_ACCEPT')).toBe(true)

    const beforePoints = state.players[1]!.points
    state = applyAction(state, { type: 'BLOODLUST_ACCEPT' })
    expect(state.players[1]!.field[0]).toBeNull()
    expect(state.players[1]!.points).toBe(beforePoints)
    expect(state.players[0]!.field[0]?.bloodlustStacks).toBe(1)
    expect(state.players[0]!.field[0]?.maxHp).toBe(240)
    expect(state.pending).toBeNull()
  })
})
