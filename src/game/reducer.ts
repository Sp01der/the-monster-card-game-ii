import { actionsEqual, listLegalActions } from './actions'
import {
  chaosFireworksSpend,
  countElectricCardsInPlay,
  countOtherStormlings,
  countPoisonCardsInPlay,
  countWoodySpears,
  countsAsElementalCard,
  getCard,
  getMonster,
  getWeaknesses,
  canUseDarkCharge,
  hasDarkCharge,
  isBlobMonster,
  isFireMonster,
  isOrcOrGoblin,
  isPlant,
  monsterAbilities,
} from './catalog'
import {
  abilityNeedsChoice,
  dealDamageToTarget,
  healTarget,
  resolveAbility,
} from './combat'
import {
  abilityCostsTeamAction,
  getCircleAdjacent,
  hasFishingRod,
  hasSpareEnergy,
  lensSuccessFaces,
} from './damage'
import {
  allocId,
  applyStatus,
  activePlayer,
  beginProtection,
  canReceiveEnergy,
  checkLosses,
  cloneState,
  collapseEmptyExtraSlots,
  discardMonster,
  grantEnergy,
  hasKeystone,
  isGooed,
  log,
  releaseProtection,
  otherPlayer,
  resolveTarget,
  rollDie,
  spendEnergy,
  targetFromInstanceId,
  targetInstanceId,
} from './helpers'
import {
  anyCardTargets,
  withoutProtected,
} from './targeting'
import type {
  DamageType,
  FieldMonster,
  GameAction,
  GameState,
  HandCard,
  PlayerId,
  PlayerState,
  TargetRef,
} from './types'

function assertLegal(state: GameState, action: GameAction): void {
  const legal = listLegalActions(state)
  if (!legal.some((a) => actionsEqual(a, action))) {
    throw new Error(`Illegal action: ${JSON.stringify(action)}`)
  }
}

function clearPending(state: GameState): void {
  state.pending = state.pendingStack.pop() ?? null
}

function destroyPermanently(state: GameState, player: PlayerState, card: HandCard): void {
  player.removed.push(card)
  log(state, `${player.name} destroys ${getCard(card.defId).name} permanently.`)
}

function takeCard(pile: HandCard[], instanceId: string): HandCard | undefined {
  const index = pile.findIndex((card) => card.instanceId === instanceId)
  if (index < 0) return undefined
  const [card] = pile.splice(index, 1)
  return card
}

function beginForcedDiscard(
  state: GameState,
  playerId: PlayerId,
  remaining: number,
  thenPlayers: PlayerId[] = [],
): void {
  const count = Math.min(remaining, state.players[playerId].hand.length)
  if (count > 0) {
    state.pending = {
      kind: 'handDiscard',
      player: playerId,
      remaining: count,
      thenPlayers: thenPlayers.length > 0 ? thenPlayers : undefined,
    }
    return
  }
  if (thenPlayers.length > 0) {
    beginForcedDiscard(state, thenPlayers[0], 1, thenPlayers.slice(1))
    return
  }
  if (state.pending?.kind === 'handDiscard') clearPending(state)
}

function resumePlayCardsAfter(state: GameState, before: GameState['pending']): void {
  if (before?.kind !== 'playCards') return
  const resumed = { ...before, played: before.played + 1 }
  if (state.pending === null || state.pending === before) {
    state.pending = resumed
  } else {
    state.pendingStack.push(resumed)
  }
}

function beginMainPhase(state: GameState): void {
  state.phase = 'main'
  state.drewThisTurn = true
  const player = activePlayer(state)
  // One paid team action; free abilities / Ruby Ring do not spend it.
  // Each card may still only act once (tracked in actedSlots).
  state.abilityUsesLeft = player.isFirstTurn ? 0 : 1
  state.actedSlots = []
  state.movedSlots = []
  state.skipEnergyPhase = false
  state.endStepResolved = false
  player.attackBonus = 0
  for (const monster of player.field) {
    if (monster) {
      monster.sparkedThisTurn = false
      monster.freeActionThisTurn = false
      monster.extraAbilityUses = 0
      monster.unending = false
      monster.illuminatedThisTurn = false
      monster.honourGuardUntilNextTurn = false
    }
  }
}

function beginEnergyPhase(state: GameState): void {
  const player = activePlayer(state)
  if (player.skipEnergyPhases > 0) {
    player.skipEnergyPhases -= 1
    state.phase = 'end'
    state.energyPool = 0
    state.blobEnergyPool = 0
    state.bannerEnergyPool = 0
    state.skipEnergyPhase = false
    log(state, `${player.name}'s energy phase is skipped.`)
    return
  }
  if (state.skipEnergyPhase) {
    state.phase = 'end'
    state.energyPool = 0
    state.blobEnergyPool = 0
    state.bannerEnergyPool = 0
    log(state, `${player.name}'s energy phase is skipped.`)
    return
  }
  state.phase = 'energy'
  const sparkSucceeded = player.field.some((m) => m?.sparkedThisTurn)
  const fairies = player.field.filter((m) => m?.defId === 'yellow_fairy').length
  state.energyPool = (sparkSucceeded ? 3 : 1) + fairies
  state.blobEnergyPool = player.field.filter((m) => m?.defId === 'yellow_blob').length
  state.bannerEnergyPool = player.field.filter((m) => m?.defId === 'unending_bannerman').length
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (!monster) continue
    const crystals = monster.equipment.filter((e) => e.defId === 'energy_crystal').length
    if (crystals > 0 && grantEnergy(state, monster, crystals) > 0) {
      log(state, `${getMonster(monster.defId).name} gains ${crystals} energy from Energy Crystal.`)
    }
    if (hasKeystone(monster) && grantEnergy(state, monster, 1) > 0) {
      log(state, `${getMonster(monster.defId).name} gains 1 energy from Colossus Keystone.`)
    }
    if (
      getMonster(monster.defId).idleEnergy &&
      !state.actedSlots.includes(slot) &&
      !state.movedSlots.includes(slot) &&
      grantEnergy(state, monster, 1) > 0
    ) {
      log(state, `${getMonster(monster.defId).name} gains 1 energy for remaining unused.`)
    }
  }
}

function resolveEndStep(state: GameState): void {
  const player = activePlayer(state)

  for (const monster of player.field) {
    if (!monster) continue
    const rings = monster.equipment.filter((eq) => eq.defId === 'emerald_ring').length
    if (rings === 0) continue
    const heal = 10 * rings
    const nextHp = Math.min(monster.maxHp, monster.hp + heal)
    if (nextHp !== monster.hp) {
      monster.hp = nextHp
      log(state, `${getMonster(monster.defId).name} heals ${heal} from Emerald Ring (now ${monster.hp} HP).`)
    }
  }

  // Cling damage triggers at the end of the Rarkling owner's turn.
  for (const source of player.field) {
    if (!source || source.defId !== 'rarkling' || !source.clingTargetInstanceId) continue
    if (source.energy <= 0) {
      for (const p of state.players) {
        for (const m of p.field) {
          if (!m) continue
          m.statuses = m.statuses.filter(
            (s) => s.kind !== 'cling' || s.sourceInstanceId !== source.instanceId,
          )
        }
      }
      source.clingTargetInstanceId = undefined
      continue
    }
    for (const targetPlayer of state.players) {
      const targetSlot = targetPlayer.field.findIndex(
        (m) => m?.instanceId === source.clingTargetInstanceId,
      )
      if (targetSlot >= 0) {
        dealDamageToTarget(
          state,
          source,
          { kind: 'monster', player: targetPlayer.id, slot: targetSlot },
          10,
        )
      }
    }
  }

  const fairies = player.field.filter((monster) => monster?.defId === 'green_fairy').length
  if (fairies > 0) {
    state.pending = { kind: 'fairyHeal', owner: player.id, remaining: fairies }
    log(state, `Green Fairy: choose a card to heal 10 HP (${fairies} remaining).`)
    return
  }
  tickStatuses(state)
}

function tickStatuses(state: GameState): void {
  const player = activePlayer(state)
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (!monster) continue

    const nextStatuses = []
    for (const status of [...monster.statuses]) {
      if (status.kind === 'goo' || status.kind === 'cling') {
        nextStatuses.push(status)
        continue
      }

      if (status.skipNextTick) {
        nextStatuses.push({ ...status, skipNextTick: false })
        continue
      }

      if (status.kind === 'burn') {
        const endured = monster.unending && monster.hp - 20 <= 0
        if (endured) monster.hp = Math.min(monster.maxHp, 10)
        else monster.hp -= 20
        log(
          state,
          endured
            ? `${getMonster(monster.defId).name} takes 20 burn damage but endures at ${monster.hp} HP.`
            : `${getMonster(monster.defId).name} takes 20 burn damage (${Math.max(0, monster.hp)} HP left).`,
        )
      }
      if (status.kind === 'poison') {
        const acted = state.actedSlots.includes(slot) || state.movedSlots.includes(slot)
        const damage = acted ? 30 : 10
        const endured = monster.unending && monster.hp - damage <= 0
        if (endured) monster.hp = Math.min(monster.maxHp, 10)
        else monster.hp -= damage
        log(
          state,
          endured
            ? `${getMonster(monster.defId).name} takes ${damage} poison damage but endures at ${monster.hp} HP.`
            : `${getMonster(monster.defId).name} takes ${damage} poison damage (${Math.max(0, monster.hp)} HP left).`,
        )
      }

      const turnsLeft = status.turns - 1
      if (turnsLeft > 0) {
        nextStatuses.push({ ...status, turns: turnsLeft, skipNextTick: false })
      } else {
        log(state, `${status.kind} wore off on ${getMonster(monster.defId).name}.`)
      }
    }
    monster.statuses = nextStatuses

    if (monster.hp <= 0) {
      discardMonster(state, player, slot, 'slain')
    }
  }
  checkLosses(state)
}

function passTurn(state: GameState): void {
  const player = activePlayer(state)
  player.isFirstTurn = false
  player.hasFinishedFirstTurn = true

  player.attackBonus = 0

  const nextId = otherPlayer(state.activePlayer)
  state.activePlayer = nextId
  state.playedCardThisTurn = false
  state.movedThisTurn = false
  state.movedSlots = []
  state.attachedEnergyThisTurn = false
  state.energyPool = 0
  state.blobEnergyPool = 0
  state.bannerEnergyPool = 0
  state.endStepResolved = false
  state.awaitingHandoff = true

  const nextPlayer = activePlayer(state)
  if (nextPlayer.isFirstTurn) {
    beginMainPhase(state)
  } else {
    state.phase = 'draw'
    state.drewThisTurn = false
    state.abilityUsesLeft = 0
    state.actedSlots = []
  }
  log(state, `Pass the device to ${nextPlayer.name}.`)
}

function targetMonster(state: GameState, target: TargetRef | undefined): FieldMonster | null {
  if (!target || target.kind !== 'monster') return null
  return resolveTarget(state, target)?.monster ?? null
}

function dealsIceDamage(defId: string): boolean {
  return getMonster(defId).abilities.some(
    (ability) =>
      ability.effects.some(
        (effect) =>
          (effect.type === 'damage' ||
            effect.type === 'rollDamage' ||
            effect.type === 'chanceBoostDamage') &&
          effect.damageType === 'ice',
      ) ||
      ['iceyBeak', 'frostbite', 'frozenSting'].includes(ability.special ?? ''),
  )
}

function resolveSpecialAbility(
  state: GameState,
  player: PlayerState,
  slot: number,
  special: string,
  action: Extract<GameAction, { type: 'USE_ABILITY' }>,
  energyBeforeSpend: number,
  requiredEnergy: number,
  skipSpend = false,
): void {
  const attacker = player.field[slot]
  if (!attacker) return
  const target = action.target
  switch (special) {
    case 'waterClaw':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 30 : 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'waterGush':
      if (lensSuccessFaces(attacker, [1, 2, 3, 4, 5]).includes(rollDie(state)) && target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 20, 'water', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(monster, 'wet', 3, 1, undefined, hitTarget.player === state.activePlayer)
        }
      } else log(state, 'Water Gush missed.')
      break
    case 'spark':
      if (lensSuccessFaces(attacker, [1, 2, 3]).includes(rollDie(state))) {
        attacker.sparkedThisTurn = true
        log(state, 'Spark succeeds: base energy pool becomes 3.')
      } else log(state, 'Spark failed.')
      break
    case 'trickery': {
      const opponent = state.players[otherPlayer(player.id)]
      if (opponent.hand.length === 0) break
      const index = Math.floor(state.random() * opponent.hand.length)
      const [card] = opponent.hand.splice(index, 1)
      state.pending = { kind: 'trickery', owner: player.id, opponent: opponent.id, card }
      break
    }
    case 'bigSplat': {
      const monster = targetMonster(state, target)
      if (monster) {
        applyStatus(
          monster,
          'goo',
          1,
          1,
          undefined,
          target?.player === state.activePlayer,
        )
      }
      if (lensSuccessFaces(attacker, [1]).includes(rollDie(state))) {
        state.pending = { kind: 'repeatGoo', sourcePlayer: player.id, sourceSlot: slot }
      }
      break
    }
    case 'burningGoo': {
      const monster = targetMonster(state, target)
      if (!monster) break
      applyStatus(monster, 'goo', 1, 1, undefined, target?.player === state.activePlayer)
      if (getWeaknesses(monster.defId).includes('fire')) {
        applyStatus(monster, 'burn', 1, 1, undefined, target?.player === state.activePlayer)
      }
      break
    }
    case 'swarm': {
      let amount = 0
      for (const m of player.field) {
        if (!m || !getMonster(m.defId).name.toLowerCase().includes('blob')) continue
        amount += m.defId === 'big_blob' ? 20 : 10
      }
      if (target) {
        dealDamageToTarget(state, attacker, target, amount, 'untyped', false, requiredEnergy)
      }
      break
    }
    case 'cling': {
      for (const p of state.players) {
        for (const m of p.field) {
          if (!m) continue
          m.statuses = m.statuses.filter(
            (s) => s.kind !== 'cling' || s.sourceInstanceId !== attacker.instanceId,
          )
        }
      }
      attacker.clingTargetInstanceId = undefined
      const monster = targetMonster(state, target)
      if (monster && attacker.energy > 0) {
        applyStatus(monster, 'cling', 999, 1, attacker.instanceId)
        attacker.clingTargetInstanceId = monster.instanceId
      }
      break
    }
    case 'plasmaVolley': {
      const roll = rollDie(state)
      const hits = roll <= 2 ? 1 : roll <= 4 ? 2 : 3
      state.pending = {
        kind: 'multiHit', sourcePlayer: player.id, sourceSlot: slot,
        remaining: hits, amount: 20, damageType: 'electric',
        requiredEnergy,
      }
      break
    }
    case 'sizzlingShell':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        amount: 20,
        damageType: 'fire',
        requiredEnergy,
        statusChanceFaces: lensSuccessFaces(attacker, [1, 2]),
        status: 'burn',
        statusTurns: 2,
      }
      break
    case 'healOther':
      if (target) healTarget(state, target, 20)
      break
    case 'energize':
      for (const m of player.field) if (m) grantEnergy(state, m, 1)
      state.skipEnergyPhase = true
      log(state, `All of ${player.name}'s monsters gain 1 energy.`)
      break
    case 'charge': {
      const extra = action.extraEnergy ?? 0
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20 + extra * 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'transferal': {
      const [sourceRef, destinationRef] = action.targets ?? []
      const source = targetMonster(state, sourceRef)
      const destination = targetMonster(state, destinationRef)
      if (source && destination && canReceiveEnergy(destination)) {
        const amount = Math.min(2, source.energy)
        source.energy -= amount
        grantEnergy(state, destination, amount)
        log(state, `Transferred ${amount} energy.`)
      }
      state.skipEnergyPhase = true
      break
    }
    case 'discharge':
      if (lensSuccessFaces(attacker, [1, 2, 3, 4]).includes(rollDie(state)) && target) {
        dealDamageToTarget(state, attacker, target, 30, 'electric', false, requiredEnergy)
      }
      else log(state, 'Discharge missed.')
      break
    case 'drawOne': {
      const card = player.deck.shift()
      if (card) {
        player.hand.push(card)
        log(state, `${player.name} draws a card.`)
      }
      break
    }
    case 'mudball': {
      const roll = rollDie(state)
      const amount = roll <= 3 ? 10 : roll <= 5 ? 20 : 10
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, amount, 'water', false, requiredEnergy) ??
          target
        if (roll === 6) {
          const monster = targetMonster(state, hitTarget)
          if (monster) {
            applyStatus(monster, 'wet', 3, 1, undefined, hitTarget.player === state.activePlayer)
          }
        }
      }
      break
    }
    case 'waterJet':
      if (lensSuccessFaces(attacker, [1, 2, 3, 4, 5]).includes(rollDie(state)) && target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 40, 'water', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(monster, 'wet', 3, 1, undefined, hitTarget.player === state.activePlayer)
        }
      } else {
        log(state, 'Water Jet missed.')
      }
      break
    case 'lostTreasure':
      state.pending = { kind: 'discardPick', owner: player.id, pileOwner: player.id }
      break
    case 'sunkenPlunder':
      state.pending = {
        kind: 'discardPick',
        owner: player.id,
        pileOwner: otherPlayer(player.id),
      }
      break
    case 'tentacleAttack':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 3,
        amount: 20,
        damageType: 'untyped',
        requiredEnergy,
      }
      break
    case 'absorb':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'absorb',
        sourceSlot: slot,
        requiredEnergy,
      }
      break
    case 'hunt':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'hunt',
        sourceSlot: slot,
        requiredEnergy,
        target,
      }
      break
    case 'iceyBeak':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 30 : 20,
          'ice',
          false,
          requiredEnergy,
        )
      }
      break
    case 'chillingScreech': {
      const count = player.field.filter((monster) => monster && dealsIceDamage(monster.defId)).length
      const legalTargets = state.players[otherPlayer(player.id)].field.filter(
        (monster) => monster?.stance === 'active',
      ).length || state.players[otherPlayer(player.id)].field.filter(Boolean).length
      const remaining = Math.min(count, legalTargets)
      if (remaining > 0) {
        state.pending = {
          kind: 'freezeTargets',
          sourcePlayer: player.id,
          sourceSlot: slot,
          remaining,
          turns: 2,
          chosenInstanceIds: [],
        }
      }
      break
    }
    case 'chill':
      for (const targetPlayer of state.players) {
        for (const monster of targetPlayer.field) {
          const frozen = monster?.statuses.find((status) => status.kind === 'frozen')
          if (frozen) frozen.turns += 1
        }
      }
      log(state, 'Every Frozen monster remains Frozen for one additional turn.')
      break
    case 'skipOpponentEnergy': {
      const opponent = state.players[otherPlayer(player.id)]
      opponent.skipEnergyPhases += 1
      log(state, `${opponent.name} will skip their next energy phase.`)
      break
    }
    case 'frostbite':
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 20, 'ice', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(
            monster,
            'frozen',
            energyBeforeSpend,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      break
    case 'frozenSting': {
      const roll = rollDie(state)
      const amount = roll === 1 ? 10 : roll <= 3 ? 20 : roll <= 5 ? 30 : 20
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, amount, 'ice', false, requiredEnergy) ?? target
        if (roll === 6) {
          const monster = targetMonster(state, hitTarget)
          if (monster) {
            applyStatus(
              monster,
              'frozen',
              2,
              1,
              undefined,
              hitTarget.player === state.activePlayer,
            )
          }
        }
      }
      break
    }
    case 'lightningNeedle': {
      const extra = Math.min(3, action.extraEnergy ?? 0)
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20 + extra * 20,
          'electric',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'hauntingCry':
      for (const monster of player.field) {
        if (!monster) continue
        if (getMonster(monster.defId).abilities.filter((ability) => ability.ice).length >= 2) {
          grantEnergy(state, monster, 1)
        }
      }
      log(state, 'Monsters with at least two ice abilities gain 1 energy.')
      break
    case 'freezeTwo':
      state.pending = {
        kind: 'freezeTargets',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        turns: 2,
        chosenInstanceIds: [],
      }
      break
    case 'frostBreath':
      state.pending = {
        kind: 'freezeTargets',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        turns: 2,
        chosenInstanceIds: [],
        discardPlayer: otherPlayer(player.id),
      }
      break
    case 'gleam': {
      if (target) {
        healTarget(state, target, 10)
        const ally = targetMonster(state, target)
        if (ally) {
          ally.illuminatedThisTurn = true
          log(state, `${getMonster(ally.defId).name} is illuminated.`)
        }
      }
      break
    }
    case 'healingLight': {
      if (target?.kind === 'equipment') {
        healTarget(state, target, 20)
        break
      }
      const ally = target ? targetMonster(state, target) : undefined
      if (ally && target) {
        const clingSources = ally.statuses
          .filter((status) => status.kind === 'cling' && status.sourceInstanceId)
          .map((status) => status.sourceInstanceId!)
        ally.statuses = []
        for (const sourceId of clingSources) {
          for (const owner of state.players) {
            for (const monster of owner.field) {
              if (monster?.instanceId === sourceId) monster.clingTargetInstanceId = undefined
            }
          }
        }
        healTarget(state, target, 20)
        log(state, `${getMonster(ally.defId).name} is cleansed.`)
      }
      break
    }
    case 'chorus': {
      const others = player.field.filter((monster, index) => monster && index !== slot).length
      if (target) {
        dealDamageToTarget(state, attacker, target, 20 + others * 10, 'light', false, requiredEnergy)
      }
      break
    }
    case 'flurryOfBlows': {
      const hits = Math.min(3, Math.max(0, action.extraEnergy ?? 0))
      if (!skipSpend) attacker.energy -= hits
      if (target && hits > 0) {
        dealDamageToTarget(state, attacker, target, hits * 30, 'untyped', false, requiredEnergy)
      }
      break
    }
    case 'knightsHonour':
      attacker.honourGuardUntilNextTurn = true
      log(state, `${getMonster(attacker.defId).name} swears Knight's Honour.`)
      break
    case 'lavaClaw':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 30 : 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'magmaGush':
      if (lensSuccessFaces(attacker, [1, 2, 3, 4, 5]).includes(rollDie(state)) && target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 40, 'fire', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(monster, 'burn', 3, 1, undefined, hitTarget.player === state.activePlayer)
        }
      } else log(state, 'Magma Gush missed.')
      break
    case 'solarFlare': {
      const extra = Math.min(1, action.extraEnergy ?? 0)
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          extra > 0 ? 30 : 20,
          'light',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'sunburn':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: energyBeforeSpend >= 2 ? 4 : 3,
        amount: 10,
        damageType: 'fire',
        requiredEnergy,
      }
      break
    case 'overheat':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 3,
        amount: 10,
        damageType: 'fire',
        requiredEnergy,
        status: 'burn',
        statusTurns: 3,
      }
      break
    case 'eyeFlash':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        amount: 0,
        damageType: 'fire',
        requiredEnergy,
        status: 'burn',
        statusTurns: 2,
      }
      break
    case 'stampede':
      if (target?.kind === 'monster') {
        dealDamageToTarget(state, attacker, target, 30, 'fire', false, requiredEnergy)
        const splash =
          action.targets?.[1] ??
          getCircleAdjacent(state, target.player, target.slot).find((candidate) => {
            const monster = targetMonster(state, candidate)
            return Boolean(monster && monster.stance === 'withdrawn')
          })
        if (splash) {
          dealDamageToTarget(state, attacker, splash, 30, 'fire', false, requiredEnergy)
        }
      }
      break
    case 'rocket':
      resolveRocket(state, attacker, target, requiredEnergy)
      break
    case 'chaosFireworks': {
      const opponent = state.players[otherPlayer(player.id)]
      for (let i = 0; i < 3; i++) {
        const enemies = opponent.field
          .map((monster, enemySlot) => (monster ? enemySlot : -1))
          .filter((enemySlot) => enemySlot >= 0)
        if (enemies.length === 0) break
        const pick = enemies[Math.floor(state.random() * enemies.length)]
        log(state, `Chaos of Fireworks rockets slot ${pick + 1}.`)
        resolveRocket(
          state,
          attacker,
          { kind: 'monster', player: opponent.id, slot: pick },
          requiredEnergy,
        )
      }
      break
    }
    case 'pilfer':
      if (target) {
        dealDamageToTarget(state, attacker, target, 10, 'shadow', false, requiredEnergy)
      }
      beginForcedDiscard(state, otherPlayer(player.id), 1)
      break
    case 'spy':
      state.pending = { kind: 'spy', owner: player.id }
      break
    case 'griefBolt':
      state.pending = { kind: 'griefDestroy', owner: player.id, chosenInstanceIds: [] }
      break
    case 'bottleToxins': {
      const turns = countPoisonCardsInPlay(player)
      for (const ref of action.targets ?? []) {
        if (ref.kind !== 'monster') continue
        const hitTarget =
          dealDamageToTarget(state, attacker, ref, 10, 'poison', false, requiredEnergy) ?? ref
        const monster = targetMonster(state, hitTarget)
        if (monster && turns > 0) {
          applyStatus(
            monster,
            'poison',
            turns,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      break
    }
    case 'transmutation':
      state.pending = { kind: 'transmuteHand', owner: player.id }
      break
    case 'imilithiasBrew':
      if (target) {
        state.pending = { kind: 'brewWeakness', owner: player.id, target }
      }
      break
    case 'zap': {
      const extra = Math.min(1, action.extraEnergy ?? 0)
      if (!skipSpend) attacker.energy -= extra
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          extra > 0 ? 40 : 20,
          'electric',
          false,
          requiredEnergy,
        )
      }
      break
    }
    case 'storm':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 4,
        amount: 10,
        damageType: 'electric',
        requiredEnergy,
        piercing: true,
      }
      break
    case 'plasmaCannon': {
      state.pending = {
        kind: 'plasmaCannon',
        sourcePlayer: player.id,
        sourceSlot: slot,
        hits: 0,
        misses: 0,
        requiredEnergy,
      }
      applyPlasmaRoll(state)
      break
    }
    case 'lingeringEnergy':
      player.lingeringEnergy = true
      log(state, `${player.name}'s next ability treats + as 0.`)
      break
    case 'soundWave':
      state.pending = {
        kind: 'soundWave',
        sourcePlayer: player.id,
        sourceSlot: slot,
        chosenInstanceIds: [],
        requiredEnergy,
      }
      break
    case 'collect': {
      const source = targetMonster(state, target)
      const amount = Math.min(action.extraEnergy ?? 0, source?.energy ?? 0)
      if (source && amount > 0 && canReceiveEnergy(attacker)) {
        source.energy -= amount
        grantEnergy(state, attacker, amount)
        log(state, `Collected ${amount} energy.`)
      }
      break
    }
    case 'supply': {
      const destination = targetMonster(state, target)
      const amount = Math.min(action.extraEnergy ?? 0, attacker.energy)
      if (destination && amount > 0 && canReceiveEnergy(destination)) {
        attacker.energy -= amount
        grantEnergy(state, destination, amount)
        log(state, `Supplied ${amount} energy.`)
      }
      break
    }
    case 'channel': {
      const gained = countElectricCardsInPlay(player, attacker.instanceId)
      const attached = grantEnergy(state, attacker, gained)
      log(state, `${getMonster(attacker.defId).name} Channels ${attached} energy.`)
      break
    }
    case 'guardiansBlade':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 2 ? 40 : 20,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'eldersEye': {
      const count = Math.min(3, player.deck.length)
      if (count === 0) {
        log(state, `${player.name}'s deck is empty.`)
        break
      }
      const cards = player.deck.splice(0, count)
      state.pending = { kind: 'eldersEye', owner: player.id, cards, order: [] }
      log(state, `${player.name} looks at the top ${count} card${count === 1 ? '' : 's'}.`)
      break
    }
    case 'groundShaker':
      if (target && target.kind === 'monster') {
        const neighbors = getCircleAdjacent(state, target.player, target.slot)
        if (neighbors.length >= 2) {
          for (const hit of [target, ...neighbors]) {
            dealDamageToTarget(state, attacker, hit, 20, 'earth', false, requiredEnergy)
          }
        }
      }
      break
    case 'meatShield':
    case 'guard':
    case 'ancientGuardian':
    case 'treasureKeepers': {
      const ward = targetMonster(state, target)
      if (!ward || !target || target.kind !== 'monster' || target.player !== player.id) break
      if (special === 'meatShield' && !isOrcOrGoblin(ward.defId)) break
      beginProtection(state, attacker, ward)
      break
    }
    case 'burrow':
      if (!isGooed(attacker) && !attacker.statuses.some((status) => status.kind === 'cling')) {
        const nextStance = attacker.stance === 'active' ? 'withdrawn' : 'active'
        attacker.stance = nextStance
        if (nextStance === 'withdrawn') releaseProtection(state, attacker)
        if (!state.movedSlots.includes(slot)) state.movedSlots.push(slot)
        log(state, `${getMonster(attacker.defId).name} ${nextStance === 'active' ? 'advances' : 'withdraws'} with Burrow.`)
      }
      break
    case 'underground':
      if (target) dealDamageToTarget(state, attacker, target, 20, 'earth', false, requiredEnergy)
      break
    case 'ironTail':
      if (lensSuccessFaces(attacker, [1, 2, 3, 4]).includes(rollDie(state)) && target) {
        const hit = dealDamageToTarget(state, attacker, target, 40, 'untyped', false, requiredEnergy)
        const monster = hit ? targetMonster(state, hit) : null
        if (monster && hit) {
          applyStatus(monster, 'weakened', 1, 1, undefined, hit.player === state.activePlayer)
          log(state, `${getMonster(monster.defId).name} is Weakened.`)
        }
      } else log(state, 'Iron Tail Lash missed.')
      break
    case 'smash':
      if (target) {
        const roll = rollDie(state)
        const amount = roll <= 2 ? 30 : roll <= 4 ? 40 : 50
        const hit = dealDamageToTarget(state, attacker, target, amount, 'untyped', false, requiredEnergy)
        const monster = hit ? targetMonster(state, hit) : null
        if (monster && hit) {
          applyStatus(monster, 'weakened', 1, 1, undefined, hit.player === state.activePlayer)
          log(state, `${getMonster(monster.defId).name} is Weakened.`)
        }
      }
      break
    case 'fortify':
      if ((attacker.fortifyHitsLeft ?? 0) > 0) {
        log(state, `${getMonster(attacker.defId).name}'s Fortify is already active.`)
      } else {
        attacker.fortifyHitsLeft = 2
        log(state, `${getMonster(attacker.defId).name} fortifies until it is hit twice.`)
      }
      break
    case 'quake':
      for (let oppSlot = 0; oppSlot < state.players[otherPlayer(player.id)].field.length; oppSlot++) {
        const monster = state.players[otherPlayer(player.id)].field[oppSlot]
        if (!monster) continue
        dealDamageToTarget(
          state,
          attacker,
          { kind: 'monster', player: otherPlayer(player.id), slot: oppSlot },
          10,
          'earth',
          false,
          requiredEnergy,
        )
      }
      break
    case 'openFourthFloor':
      if (target) {
        dealDamageToTarget(state, attacker, target, 20, 'untyped', false, requiredEnergy)
        const drawn = player.deck.shift()
        if (drawn) {
          player.hand.push(drawn)
          log(state, `${player.name} draws a card.`)
        }
      }
      break
    case 'magicDoor': {
      const moved = targetMonster(state, target)
      if (
        moved &&
        target &&
        target.kind === 'monster' &&
        target.player === player.id &&
        !isGooed(moved) &&
        !moved.statuses.some((status) => status.kind === 'cling')
      ) {
        const nextStance = moved.stance === 'active' ? 'withdrawn' : 'active'
        moved.stance = nextStance
        if (nextStance === 'withdrawn') releaseProtection(state, moved)
        if (!state.movedSlots.includes(target.slot)) state.movedSlots.push(target.slot)
        log(
          state,
          `${getMonster(moved.defId).name} ${nextStance === 'active' ? 'advances' : 'withdraws'} through Magic Door.`,
        )
      }
      break
    }
    case 'wormStorm':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 3,
        amount: 70,
        damageType: 'electric',
        requiredEnergy,
      }
      break
    case 'greatAxe':
      if (target) {
        const doubled = lensSuccessFaces(attacker, [1, 2, 3, 4]).includes(rollDie(state))
        dealDamageToTarget(
          state,
          attacker,
          target,
          20,
          'untyped',
          false,
          requiredEnergy,
          doubled,
        )
      }
      break
    case 'dwarvenSpirit':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          20 + (attacker.gold ?? 0) * 10,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'gainGold':
      beginAssignGold(state, player, 1)
      break
    case 'theft': {
      if (!target || target.kind !== 'equipment') break
      const host = resolveTarget(state, target)
      const equipment = host?.monster.equipment[target.equipmentIndex]
      if (!host || !equipment) break
      if (attacker.equipment.some((held) => held.defId === equipment.defId)) break
      host.monster.equipment.splice(target.equipmentIndex, 1)
      attacker.equipment.push(equipment)
      log(
        state,
        `${getMonster(attacker.defId).name} steals ${getCard(equipment.defId).name} from ${getMonster(host.monster.defId).name}.`,
      )
      break
    }
    case 'dragonTalons':
      if (target) {
        dealDamageToTarget(
          state,
          attacker,
          target,
          energyBeforeSpend >= 3 ? 60 : 40,
          'untyped',
          false,
          requiredEnergy,
        )
      }
      break
    case 'burningBreath':
      for (const breathTarget of action.targets ?? []) {
        if (breathTarget.kind !== 'monster') continue
        const hit = dealDamageToTarget(
          state,
          attacker,
          breathTarget,
          60,
          'fire',
          false,
          requiredEnergy,
        )
        const burned = hit ? targetMonster(state, hit) : null
        if (burned) applyStatus(burned, 'burn', 3)
      }
      break
    case 'archersKeep': {
      const marked = new Set(player.damagedByInstanceIds ?? [])
      let hits = 0
      for (const owner of state.players) {
        for (let fieldSlot = 0; fieldSlot < owner.field.length; fieldSlot++) {
          const markedMonster = owner.field[fieldSlot]
          if (!markedMonster || !marked.has(markedMonster.instanceId)) continue
          hits += 1
          dealDamageToTarget(
            state,
            attacker,
            { kind: 'monster', player: owner.id, slot: fieldSlot },
            20,
          )
        }
      }
      if (hits === 0) log(state, 'No card has damaged your cards.')
      break
    }
    case 'poisonGas': {
      for (const ref of action.targets ?? []) {
        if (ref.kind !== 'monster') continue
        const hitTarget =
          dealDamageToTarget(state, attacker, ref, 20, 'poison', false, requiredEnergy) ?? ref
        const monster = targetMonster(state, hitTarget)
        if (
          monster &&
          lensSuccessFaces(attacker, [1, 2, 3, 4]).includes(rollDie(state))
        ) {
          applyStatus(
            monster,
            'poison',
            3,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      break
    }
    case 'greenHeal':
      if (target?.kind === 'monster') healTarget(state, target, 30)
      break
    case 'teamAttack': {
      const remaining = countWoodySpears(state.players, player.hand)
      if (remaining <= 0) break
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining,
        amount: 0,
        damageType: 'untyped',
        requiredEnergy,
        strike: 'spear',
      }
      break
    }
    case 'multiply':
      state.pending = { kind: 'placeWeed', owner: player.id }
      log(state, "Choose where to place Lovni's Weed.")
      break
    case 'scent': {
      if (!target) break
      const others = player.field.filter(
        (monster) =>
          monster &&
          monster.defId === 'lovnis_weed' &&
          monster.instanceId !== attacker.instanceId,
      ).length
      dealDamageToTarget(state, attacker, target, 20 + others * 10, 'poison', false, requiredEnergy)
      break
    }
    case 'tripleChomp':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: attacker.hp < 70 ? 1 : attacker.hp < 130 ? 2 : 3,
        amount: 0,
        damageType: 'untyped',
        requiredEnergy,
        strike: 'chomp',
      }
      break
    case 'healingHands': {
      const host = target ? state.players[target.player].field[target.slot] : null
      if (target && host && !isFireMonster(host.defId)) healTarget(state, target, 30)
      break
    }
    case 'growth': {
      const monster = targetMonster(state, target)
      if (!monster || !isPlant(monster.defId) || target?.player !== player.id) break
      monster.maxHp += 20
      monster.hp += 20
      log(
        state,
        `${getMonster(monster.defId).name} grows to ${monster.hp}/${monster.maxHp} HP.`,
      )
      break
    }
    case 'vineWhip': {
      if (!target || target.kind !== 'monster') break
      dealDamageToTarget(state, attacker, target, 20, 'untyped', false, requiredEnergy)
      const monster = targetMonster(state, target)
      if (!monster || monster.stance !== 'withdrawn') break
      if (isGooed(monster) || monster.statuses.some((status) => status.kind === 'cling')) {
        log(state, `${getMonster(monster.defId).name} is stuck and does not advance.`)
        break
      }
      monster.stance = 'active'
      if (target.player === state.activePlayer && !state.movedSlots.includes(target.slot)) {
        state.movedSlots.push(target.slot)
      }
      log(state, `${getMonster(monster.defId).name} advances.`)
      break
    }
    case 'burningSpear': {
      if (target) {
        const hitTarget =
          dealDamageToTarget(state, attacker, target, 30, 'fire', false, requiredEnergy) ?? target
        const monster = targetMonster(state, hitTarget)
        if (monster) {
          applyStatus(
            monster,
            'burn',
            3,
            1,
            undefined,
            hitTarget.player === state.activePlayer,
          )
        }
      }
      const self = player.field[slot]
      if (self && lensSuccessFaces(self, [1, 2]).includes(rollDie(state))) {
        dealDamageToTarget(
          state,
          null,
          { kind: 'monster', player: player.id, slot },
          20,
        )
      }
      break
    }
    case 'downpour': {
      const targets = withoutProtected(state, anyCardTargets(state))
      if (targets.length === 0) break
      const hits = Math.min(3, targets.length)
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: hits,
        amount: 10,
        damageType: 'water',
        requiredEnergy,
        status: 'wet',
        statusTurns: 3,
        scope: 'any',
        excludeInstanceIds: [],
      }
      log(state, `Downpour: choose ${hits} different card${hits === 1 ? '' : 's'}.`)
      break
    }
    case 'gale': {
      if (!target) break
      dealDamageToTarget(state, attacker, target, 30, 'wind', false, requiredEnergy)
      offerWithdraw(state, target, true)
      break
    }
    case 'tailGale': {
      if (!target) break
      dealDamageToTarget(state, attacker, target, 30, 'untyped', false, requiredEnergy)
      offerWithdraw(state, target, false)
      break
    }
    case 'stormCommand': {
      const ally = target?.kind === 'monster' ? state.players[target.player].field[target.slot] : null
      if (!ally || target?.player !== player.id || !countsAsElementalCard(ally.defId)) break
      ally.extraAbilityUses = (ally.extraAbilityUses ?? 0) + 1
      log(state, `${getMonster(ally.defId).name} may take an additional action.`)
      break
    }
    case 'bringTheStorm': {
      const amount = 40 + countOtherStormlings(player, attacker.instanceId) * 10
      state.pending = {
        kind: 'stormType',
        sourcePlayer: player.id,
        sourceSlot: slot,
        amount,
        requiredEnergy,
      }
      log(state, `Bring the STORM will deal ${amount} damage. Choose electric or water.`)
      break
    }
    case 'relentless':
      attacker.extraAbilityUses = (attacker.extraAbilityUses ?? 0) + 1
      attacker.unending = true
      log(state, `${getMonster(attacker.defId).name} can act once more, and endures until its next turn.`)
      break
    case 'attack':
      state.abilityUsesLeft += 2
      player.attackBonus = (player.attackBonus ?? 0) + 10
      log(state, `${player.name}'s attacks deal +10 damage this turn.`)
      break
    case 'drawTwo': {
      let drawn = 0
      for (let i = 0; i < 2; i++) {
        const card = player.deck.shift()
        if (!card) break
        player.hand.push(card)
        drawn++
      }
      log(state, `${player.name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`)
      break
    }
    case 'magicMusic':
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: player.id,
        sourceSlot: slot,
        remaining: 2,
        amount: 20,
        damageType: 'sound',
        requiredEnergy,
      }
      break
  }
}

function monsterIsStuck(monster: FieldMonster): boolean {
  return isGooed(monster) || monster.statuses.some((status) => status.kind === 'cling')
}

function forceWithdraw(state: GameState, playerId: PlayerId, slot: number): void {
  const monster = state.players[playerId].field[slot]
  if (!monster || monster.stance === 'withdrawn') return
  if (monsterIsStuck(monster)) {
    log(state, `${getMonster(monster.defId).name} is stuck and does not withdraw.`)
    return
  }
  monster.stance = 'withdrawn'
  if (monster.protectingInstanceId) releaseProtection(state, monster)
  if (playerId === state.activePlayer && !state.movedSlots.includes(slot)) {
    state.movedSlots.push(slot)
  }
  log(state, `${getMonster(monster.defId).name} withdraws.`)
}

function offerWithdraw(state: GameState, target: TargetRef, optional: boolean): void {
  const monster = state.players[target.player].field[target.slot]
  if (!monster || monster.stance === 'withdrawn') return
  if (monsterIsStuck(monster)) {
    log(state, `${getMonster(monster.defId).name} is stuck and does not withdraw.`)
    return
  }
  if (!optional) {
    forceWithdraw(state, target.player, target.slot)
    return
  }
  state.pending = { kind: 'forceWithdraw', player: target.player, slot: target.slot }
  log(state, `Choose whether ${getMonster(monster.defId).name} withdraws.`)
}

function applyPlasmaRoll(state: GameState): void {
  const pending = state.pending
  if (!pending || pending.kind !== 'plasmaCannon') return
  const roll = rollDie(state)
  if (roll <= 2) {
    pending.misses += 1
    log(state, `Plasma Cannon miss (${pending.misses}/2).`)
    if (pending.misses >= 2) {
      log(state, 'Plasma Cannon fails.')
      clearPending(state)
    }
  } else {
    pending.hits += 1
    log(state, `Plasma Cannon hit (${pending.hits} × 20 = ${pending.hits * 20} electric).`)
  }
}

function resolveRocket(
  state: GameState,
  attacker: FieldMonster,
  target: TargetRef | undefined,
  requiredEnergy: number,
): void {
  if (!target || target.kind !== 'monster') return
  const adjacent = getCircleAdjacent(state, target.player, target.slot)
  dealDamageToTarget(state, attacker, target, 40, 'blast', false, requiredEnergy)
  for (const splash of adjacent) {
    if (!targetMonster(state, splash)) continue
    dealDamageToTarget(state, attacker, splash, 20, 'blast', false, requiredEnergy)
  }
}

function affinitySlots(player: PlayerState): number[] {
  const slots: number[] = []
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (monster && getMonster(monster.defId).goldAffinity) slots.push(slot)
  }
  return slots
}

function drawOne(state: GameState, player: PlayerState): void {
  const card = player.deck.shift()
  if (!card) {
    log(state, `${player.name} has no cards to draw.`)
    return
  }
  player.hand.push(card)
  log(state, `${player.name} draws a card.`)
}

function beginAssignGold(
  state: GameState,
  player: PlayerState,
  count: number,
  drawAfter = false,
): void {
  if (count <= 0) return
  if (affinitySlots(player).length === 0) {
    log(state, `${player.name} gains ${count} gold, but no Gold Affinity card can hold it.`)
    if (drawAfter) drawOne(state, player)
    return
  }
  state.pending = { kind: 'assignGold', owner: player.id, remaining: count, drawAfter }
  log(state, `${player.name} gains ${count} gold. Choose a Gold Affinity card.`)
}

function playEffect(state: GameState, handIndex: number, targets: TargetRef[]): void {
  const player = activePlayer(state)
  const card = player.hand[handIndex]
  const def = getCard(card.defId)
  if (def.kind !== 'effect') throw new Error('Not an effect')

  player.hand.splice(handIndex, 1)
  player.discard.push(card)
  log(state, `${player.name} plays ${def.name}.`)

  switch (def.effectId) {
    case 'heal_30':
      healTarget(state, targets[0], 30)
      break
    case 'energy_3': {
      const resolved = resolveTarget(state, targets[0])
      if (resolved && targets[0].kind === 'monster' && grantEnergy(state, resolved.monster, 3) > 0) {
        log(state, `${getMonster(resolved.monster.defId).name} gains 3 energy.`)
      }
      break
    }
    case 'damage_20_any':
      dealDamageToTarget(state, null, targets[0], 20)
      break
    case 'anvil': {
      const roll = rollDie(state)
      if (roll <= 4) {
        dealDamageToTarget(state, null, targets[0], 40)
      } else {
        log(state, 'Falling Anvil missed.')
      }
      break
    }
    case 'rally': {
      for (const t of targets) {
        const resolved = resolveTarget(state, t)
        if (resolved && t.kind === 'monster' && grantEnergy(state, resolved.monster, 1) > 0) {
          log(state, `${getMonster(resolved.monster.defId).name} gains 1 energy.`)
        }
      }
      break
    }
    case 'stormBolts': {
      for (const targetPlayer of state.players) {
        const chance = targetPlayer.id === player.id ? 3 : 4
        const damage = targetPlayer.id === player.id ? 20 : 30
        for (let slot = 0; slot < targetPlayer.field.length; slot++) {
          if (!targetPlayer.field[slot]) continue
          if (rollDie(state) <= chance) {
            dealDamageToTarget(
              state,
              null,
              { kind: 'monster', player: targetPlayer.id, slot },
              damage,
              'electric',
            )
          }
        }
      }
      break
    }
    case 'rainOfGoo':
      state.pending = { kind: 'rainChoice', owner: player.id }
      break
    case 'treasureHoard':
      state.pending = { kind: 'hoardChoice', owner: player.id }
      break
    case 'magicFertilizer':
      for (const monster of player.field) {
        if (!monster || !isPlant(monster.defId)) continue
        if (grantEnergy(state, monster, 1) > 0) {
          log(state, `${getMonster(monster.defId).name} gains 1 energy from Magic Fertilizer.`)
        }
      }
      break
    case 'whirlpool':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'whirlpool',
        target: targets[0],
      }
      break
    case 'churnWaters':
      state.pending = {
        kind: 'bury',
        owner: player.id,
        chosenInstanceIds: [],
        purpose: 'churn',
      }
      break
    case 'blizzard':
      for (const targetPlayer of state.players) targetPlayer.skipEnergyPhases += 1
      log(state, 'All players will skip their next energy phase.')
      break
    case 'iceMirror':
      player.iceMirrorCharges += 1
      log(state, `${player.name} prepares an Ice Mirror.`)
      break
    case 'quickMarch':
      state.pending = { kind: 'march', owner: player.id, chosenSlots: [] }
      break
    case 'starlightPortal':
      state.pending = { kind: 'playCards', owner: player.id, played: 0 }
      break
    case 'command':
      state.abilityUsesLeft += 1
      log(state, `${player.name} gains an extra action.`)
      break
    case 'scrollWisdom': {
      let drawn = 0
      for (let i = 0; i < 3; i++) {
        const nextCard = player.deck.shift()
        if (!nextCard) break
        player.hand.push(nextCard)
        drawn++
      }
      log(state, `${player.name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`)
      break
    }
    case 'empower': {
      const resolved = resolveTarget(state, targets[0])
      if (resolved && targets[0].kind === 'monster') {
        grantEnergy(state, resolved.monster, 2)
        resolved.monster.freeActionThisTurn = true
        log(
          state,
          `${getMonster(resolved.monster.defId).name} gains 2 energy and may take a free action this turn.`,
        )
      }
      break
    }
    case 'daybreak': {
      dealDamageToTarget(state, null, targets[0], 20, 'light')
      const resolved = resolveTarget(state, targets[0])
      if (
        resolved &&
        targets[0].kind === 'monster' &&
        resolved.monster.stance === 'withdrawn' &&
        !isGooed(resolved.monster) &&
        !resolved.monster.statuses.some((status) => status.kind === 'cling')
      ) {
        resolved.monster.stance = 'active'
        log(state, `${getMonster(resolved.monster.defId).name} is forced into the open.`)
      }
      break
    }
    case 'famine': {
      const opponentId = otherPlayer(player.id)
      if (player.hand.length > 0) {
        beginForcedDiscard(
          state,
          player.id,
          1,
          state.players[opponentId].hand.length > 0 ? [opponentId] : [],
        )
      } else {
        beginForcedDiscard(state, opponentId, 1)
      }
      break
    }
  }

  state.playedCardThisTurn = true
}

export function applyAction(state: GameState, action: GameAction): GameState {
  const next = cloneState(state)
  assertLegal(next, action)

  const player = activePlayer(next)

  switch (action.type) {
    case 'CONFIRM_HANDOFF': {
      next.awaitingHandoff = false
      log(next, `${player.name}'s turn begins.`)
      break
    }
    case 'DRAW': {
      const card = player.deck.shift()
      if (card) {
        player.hand.push(card)
        log(next, `${player.name} draws a card.`)
      }
      next.drewThisTurn = true
      beginMainPhase(next)
      break
    }
    case 'SKIP_DRAW': {
      next.drewThisTurn = true
      log(next, `${player.name} skips draw.`)
      beginMainPhase(next)
      break
    }
    case 'USE_ABILITY': {
      const monster = player.field[action.slot]
      if (!monster) throw new Error('No monster')
      const def = getMonster(monster.defId)
      const ability = monsterAbilities(monster).find((a) => a.id === action.abilityId)
      if (!ability) throw new Error('No ability')

      if (abilityNeedsChoice(ability) && !action.choice) {
        throw new Error('Choice required')
      }

      const printedSpend =
        ability.special === 'chaosFireworks'
          ? chaosFireworksSpend(player, action.slot)
          : ability.cost.spend
      const extra = action.extraEnergy ?? 0
      const extraIsCost = ['charge', 'lightningNeedle', 'flurryOfBlows', 'solarFlare', 'zap'].includes(
        ability.special ?? '',
      )
      const convertPlus = player.lingeringEnergy && ability.special !== 'lingeringEnergy'
      const extraCost = extraIsCost ? extra : 0
      const require = convertPlus
        ? ability.cost.require + printedSpend + extraCost
        : ability.cost.require
      const spend = convertPlus ? 0 : printedSpend + extraCost
      const goldRequire = action.goldRequire ?? 0
      const goldSpend = action.goldSpend ?? 0
      const gold = monster.gold ?? 0
      if (
        goldRequire + goldSpend > gold ||
        goldRequire > require ||
        goldSpend > spend ||
        monster.energy < require - goldRequire + (spend - goldSpend)
      ) {
        throw new Error('Cannot afford')
      }
      if (convertPlus) player.lingeringEnergy = false
      const energyBeforeSpend = monster.energy + gold
      monster.gold = gold - goldSpend
      if (!convertPlus) spendEnergy(monster, spend - goldSpend)
      const requiredEnergy = convertPlus
        ? ability.cost.require + printedSpend + extra
        : ability.cost.require

      log(
        next,
        `${player.name}'s ${def.name} uses ${ability.name}${
          action.choice === 'firePunchFull'
            ? ' (30 fire)'
            : action.choice === 'firePunchBurn'
              ? ' (10 fire + burn)'
              : convertPlus
                ? ' (Lingering Energy)'
                : ''
        }.`,
      )

      if (ability.special) {
        resolveSpecialAbility(
          next,
          player,
          action.slot,
          ability.special,
          action,
          energyBeforeSpend,
          requiredEnergy,
          convertPlus || extraIsCost,
        )
      } else {
        resolveAbility(next, player, action.slot, ability, action.target, action.choice, requiredEnergy)
      }

      const alreadyActed = next.actedSlots.includes(action.slot)
      const extraLeft = monster.extraAbilityUses ?? 0
      const costsTeam = abilityCostsTeamAction(monster, ability)
      const useNormal = !alreadyActed && (!costsTeam || next.abilityUsesLeft > 0)
      if (useNormal) {
        next.actedSlots.push(action.slot)
        if (costsTeam) next.abilityUsesLeft = Math.max(0, next.abilityUsesLeft - 1)
      } else if (extraLeft > 0) {
        monster.extraAbilityUses = extraLeft - 1
      } else if (!alreadyActed) {
        next.actedSlots.push(action.slot)
      }
      if (hasFishingRod(monster) && hasSpareEnergy(monster, requiredEnergy)) {
        const drawn = player.deck.shift()
        if (drawn) {
          player.hand.push(drawn)
          log(next, `${player.name} draws a card from Fishing Rod.`)
        }
      }
      break
    }
    case 'PLAY_MONSTER': {
      const card = player.hand[action.handIndex]
      const def = getCard(card.defId)
      if (def.kind !== 'monster') throw new Error('Not a monster')
      player.hand.splice(action.handIndex, 1)
      player.field[action.slot] = {
        instanceId: card.instanceId,
        defId: card.defId,
        hp: def.maxHp,
        maxHp: def.maxHp,
        stance: action.stance,
        energy: 0,
        pendingEnergy: 0,
        statuses: [],
        equipment: [],
      }
      next.playedCardThisTurn = true
      log(
        next,
        `${player.name} plays ${def.name} ${action.stance} in slot ${action.slot + 1}.`,
      )
      resumePlayCardsAfter(next, next.pending)
      break
    }
    case 'PLAY_EFFECT': {
      const beforePending = next.pending
      playEffect(next, action.handIndex, action.targets)
      resumePlayCardsAfter(next, beforePending)
      break
    }
    case 'PLAY_EQUIPMENT': {
      const card = player.hand[action.handIndex]
      const def = getCard(card.defId)
      if (def.kind !== 'equipment') throw new Error('Not equipment')
      const monster = player.field[action.slot]
      if (!monster) throw new Error('No monster')
      player.hand.splice(action.handIndex, 1)
      monster.equipment.push({
        instanceId: card.instanceId,
        defId: card.defId,
        hp: def.maxHp,
        maxHp: def.maxHp,
      })
      next.playedCardThisTurn = true
      log(next, `${player.name} attaches ${def.name} to ${getMonster(monster.defId).name}.`)
      resumePlayCardsAfter(next, next.pending)
      break
    }
    case 'SKIP_MAIN': {
      next.phase = 'move'
      log(next, `${player.name} proceeds to withdraw/advance.`)
      break
    }
    case 'WITHDRAW': {
      const m = player.field[action.slot]
      if (m) {
        m.stance = 'withdrawn'
        if (m.protectingInstanceId) releaseProtection(next, m)
        next.movedThisTurn = true
        if (!next.movedSlots.includes(action.slot)) next.movedSlots.push(action.slot)
        log(next, `${getMonster(m.defId).name} withdraws.`)
      }
      beginEnergyPhase(next)
      break
    }
    case 'ADVANCE': {
      const m = player.field[action.slot]
      if (m) {
        m.stance = 'active'
        next.movedThisTurn = true
        if (!next.movedSlots.includes(action.slot)) next.movedSlots.push(action.slot)
        log(next, `${getMonster(m.defId).name} advances.`)
      }
      beginEnergyPhase(next)
      break
    }
    case 'SKIP_MOVE': {
      beginEnergyPhase(next)
      log(next, `${player.name} skips withdraw/advance.`)
      break
    }
    case 'ATTACH_ENERGY': {
      const m = player.field[action.slot]
      const useBanner = Boolean(m && next.bannerEnergyPool > 0 && getMonster(m.defId).points <= 2)
      const useBlob = Boolean(m && !useBanner && isBlobMonster(m.defId) && next.blobEnergyPool > 0)
      if (m && canReceiveEnergy(m) && (useBanner || useBlob || next.energyPool > 0)) {
        if (useBanner) next.bannerEnergyPool -= 1
        else if (useBlob) next.blobEnergyPool -= 1
        else next.energyPool -= 1
        grantEnergy(next, m, 1)
        next.attachedEnergyThisTurn = true
        log(next, `${player.name} attaches energy to ${getMonster(m.defId).name}.`)
      }
      if (
        next.energyPool <= 0 &&
        next.blobEnergyPool <= 0 &&
        next.bannerEnergyPool <= 0 &&
        !canUseDarkCharge(player)
      ) {
        next.phase = 'end'
      }
      break
    }
    case 'FINISH_ENERGY': {
      next.blobEnergyPool = 0
      next.bannerEnergyPool = 0
      next.phase = 'end'
      break
    }
    case 'SKIP_ENERGY': {
      next.energyPool = 0
      next.blobEnergyPool = 0
      next.bannerEnergyPool = 0
      if (!canUseDarkCharge(player)) next.phase = 'end'
      log(next, `${player.name} skips energy attach.`)
      break
    }
    case 'UNGOO': {
      const m = player.field[action.slot]
      if (m && isGooed(m) && m.energy >= 1) {
        m.energy -= 1
        m.statuses = m.statuses.filter((s) => s.kind !== 'goo')
        log(next, `${getMonster(m.defId).name} spends 1 energy to ungoo.`)
      }
      break
    }
    case 'RESIST_CLING': {
      const target = player.field[action.slot]
      const cling = target?.statuses.find((s) => s.kind === 'cling')
      if (target && cling && target.energy > 0) {
        target.energy -= 1
        for (const p of next.players) {
          const source = p.field.find((m) => m?.instanceId === cling.sourceInstanceId)
          if (!source) continue
          source.energy = Math.max(0, source.energy - 1)
          if (source.energy === 0) {
            source.clingTargetInstanceId = undefined
            target.statuses = target.statuses.filter((s) => s !== cling)
          }
        }
      }
      break
    }
    case 'PENDING_TARGET': {
      const pending = next.pending
      if (!pending || (pending.kind !== 'multiHit' && pending.kind !== 'repeatGoo')) break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (!source) {
        clearPending(next)
        break
      }
      if (pending.kind === 'repeatGoo') {
        const target = targetMonster(next, action.target)
        if (target) {
          applyStatus(
            target,
            'goo',
            1,
            1,
            undefined,
            action.target.player === next.activePlayer,
          )
        }
        clearPending(next)
      } else {
        let amount = pending.amount
        let damageType = pending.damageType
        if (pending.strike === 'spear') {
          const roll = rollDie(next)
          amount = lensSuccessFaces(source, [1, 2]).includes(roll) ? 30 : 20
          damageType = 'untyped'
        } else if (pending.strike === 'chomp') {
          const roll = rollDie(next)
          amount = roll <= 3 ? 30 : 40
          damageType = 'untyped'
        }
        const hitTarget =
          amount > 0
            ? (dealDamageToTarget(
                next,
                source,
                action.target,
                amount,
                damageType,
                pending.piercing ?? false,
                pending.requiredEnergy,
              ) ?? action.target)
            : action.target
        const apply =
          pending.status !== undefined &&
          (pending.statusChanceFaces
            ? pending.statusChanceFaces.includes(rollDie(next))
            : true)
        if (apply && pending.status) {
          const target = targetMonster(next, hitTarget)
          if (target) {
            applyStatus(
              target,
              pending.status,
              pending.statusTurns ?? 1,
              1,
              undefined,
              hitTarget.player === next.activePlayer,
            )
          }
        }
        const chosenId = targetInstanceId(next, action.target)
        if (pending.excludeInstanceIds && chosenId && !pending.excludeInstanceIds.includes(chosenId)) {
          pending.excludeInstanceIds.push(chosenId)
        }
        pending.remaining -= 1
        if (pending.remaining <= 0 || !listLegalActions(next).some((candidate) => candidate.type === 'PENDING_TARGET')) {
          clearPending(next)
        }
      }
      break
    }
    case 'TRICKERY_PLACE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'trickery') break
      next.players[pending.opponent].deck.splice(action.deckIndex, 0, pending.card)
      log(next, `${getCard(pending.card.defId).name} was placed into the opponent's deck.`)
      clearPending(next)
      break
    }
    case 'SPAWN_BLOB': {
      const pending = next.pending
      if (!pending || pending.kind !== 'spawnBlobs') break
      const owner = next.players[pending.owner]
      const def = getMonster('blob')
      owner.field[action.slot] = {
        instanceId: allocId(next), defId: 'blob', hp: def.maxHp, maxHp: def.maxHp,
        stance: action.stance, energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
      }
      pending.remaining -= 1
      if (pending.remaining <= 0 || owner.field.every(Boolean)) {
        const queued = pending.queue.shift()
        if (queued) {
          next.pending = {
            kind: 'spawnBlobs',
            owner: queued.owner,
            remaining: queued.remaining,
            queue: pending.queue,
          }
        } else {
          clearPending(next)
          if (!next.pending) checkLosses(next)
        }
      }
      break
    }
    case 'RAIN_CHOOSE_MODE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rainChoice') break
      next.pending =
        action.mode === 'blobs'
          ? { kind: 'rainBlobs', owner: pending.owner, played: 0 }
          : { kind: 'rainGoo', owner: pending.owner, remaining: 3, chosenInstanceIds: [] }
      break
    }
    case 'RAIN_PLAY_BLOB': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rainBlobs') break
      const owner = next.players[pending.owner]
      const card = owner.hand[action.handIndex]
      const def = card && getCard(card.defId)
      if (!card || def.kind !== 'monster' || !def.name.toLowerCase().includes('blob')) break
      owner.hand.splice(action.handIndex, 1)
      owner.field[action.slot] = {
        instanceId: card.instanceId, defId: card.defId, hp: def.maxHp, maxHp: def.maxHp,
        stance: action.stance, energy: 0, pendingEnergy: 0, statuses: [], equipment: [],
      }
      pending.played += 1
      break
    }
    case 'RAIN_FINISH_BLOBS':
      clearPending(next)
      break
    case 'RAIN_GOO_TARGET': {
      const pending = next.pending
      if (!pending || pending.kind !== 'rainGoo') break
      const target = targetMonster(next, action.target)
      if (!target || pending.chosenInstanceIds.includes(target.instanceId)) break
      applyStatus(
        target,
        'goo',
        1,
        1,
        undefined,
        action.target.player === next.activePlayer,
      )
      pending.chosenInstanceIds.push(target.instanceId)
      pending.remaining -= 1
      if (pending.remaining <= 0) clearPending(next)
      break
    }
    case 'BURY_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'bury') break
      const chosen = pending.chosenInstanceIds
      const index = chosen.indexOf(action.instanceId)
      if (index >= 0) {
        chosen.splice(index, 1)
      } else {
        chosen.push(action.instanceId)
      }
      break
    }
    case 'BURY_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'bury') break
      const owner = next.players[pending.owner]
      const chosen = pending.chosenInstanceIds
        .map((id) => owner.hand.find((card) => card.instanceId === id))
        .filter((card): card is NonNullable<typeof card> => Boolean(card))
      const chosenIds = new Set(chosen.map((card) => card.instanceId))
      owner.hand = owner.hand.filter((card) => !chosenIds.has(card.instanceId))
      for (const card of chosen) {
        const deckIndex = Math.floor(next.random() * (owner.deck.length + 1))
        owner.deck.splice(deckIndex, 0, card)
      }
      log(next, `${owner.name} buries ${chosen.length} card${chosen.length === 1 ? '' : 's'}.`)

      if (pending.purpose === 'absorb' && chosen.length > 0 && pending.sourceSlot !== undefined) {
        next.pending = {
          kind: 'multiHit',
          sourcePlayer: pending.owner,
          sourceSlot: pending.sourceSlot,
          remaining: chosen.length,
          amount: 20,
          damageType: 'poison',
          requiredEnergy: pending.requiredEnergy ?? 0,
        }
      } else {
        if (pending.purpose === 'hunt' && pending.sourceSlot !== undefined && pending.target) {
          const source = owner.field[pending.sourceSlot]
          if (source) {
            dealDamageToTarget(
              next,
              source,
              pending.target,
              10 + chosen.length * 30,
              'untyped',
              false,
              pending.requiredEnergy ?? 0,
            )
          }
        } else if (pending.purpose === 'whirlpool' && pending.target && chosen.length > 0) {
          dealDamageToTarget(next, null, pending.target, chosen.length * 20, 'water')
        } else if (pending.purpose === 'churn') {
          for (let i = 0; i < chosen.length; i++) {
            const card = owner.deck.shift()
            if (card) owner.hand.push(card)
          }
          log(next, `${owner.name} draws ${chosen.length} card${chosen.length === 1 ? '' : 's'}.`)
        }
        clearPending(next)
      }
      break
    }
    case 'PICK_DISCARD': {
      const pending = next.pending
      if (!pending || pending.kind !== 'discardPick') break
      const pile = next.players[pending.pileOwner].discard
      const index = pile.findIndex((card) => card.instanceId === action.instanceId)
      if (index < 0) break
      const [card] = pile.splice(index, 1)
      next.players[pending.owner].hand.push(card)
      log(next, `${next.players[pending.owner].name} takes ${getCard(card.defId).name} from discard.`)
      clearPending(next)
      break
    }
    case 'FREEZE_TARGET': {
      const pending = next.pending
      if (!pending || pending.kind !== 'freezeTargets' || action.target.kind !== 'monster') break
      const target = targetMonster(next, action.target)
      if (!target || pending.chosenInstanceIds.includes(target.instanceId)) break
      applyStatus(
        target,
        'frozen',
        pending.turns,
        1,
        undefined,
        action.target.player === next.activePlayer,
      )
      pending.chosenInstanceIds.push(target.instanceId)
      pending.remaining -= 1
      if (pending.remaining <= 0) {
        const discardPlayer = pending.discardPlayer
        if (discardPlayer !== undefined && next.players[discardPlayer].hand.length > 0) {
          next.pending = { kind: 'handDiscard', player: discardPlayer, remaining: 1 }
        } else {
          clearPending(next)
        }
      }
      break
    }
    case 'DISCARD_FROM_HAND': {
      const pending = next.pending
      if (!pending || pending.kind !== 'handDiscard') break
      const discardPlayer = next.players[pending.player]
      const card = takeCard(discardPlayer.hand, action.instanceId)
      if (!card) break
      discardPlayer.discard.push(card)
      log(next, `${discardPlayer.name} discards ${getCard(card.defId).name}.`)
      if (discardPlayer.spyMarkInstanceId === card.instanceId) {
        discardPlayer.spyMarkInstanceId = undefined
      }
      pending.remaining -= 1
      if (pending.remaining > 0 && discardPlayer.hand.length > 0) break
      const rest = pending.thenPlayers ?? []
      if (rest.length > 0) beginForcedDiscard(next, rest[0], 1, rest.slice(1))
      else clearPending(next)
      break
    }
    case 'SPY_MARK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'spy') break
      const opponent = next.players[otherPlayer(pending.owner)]
      opponent.spyMarkInstanceId = action.instanceId
      log(next, `${player.name} marks a card in ${opponent.name}'s hand.`)
      clearPending(next)
      break
    }
    case 'SPY_SKIP':
      clearPending(next)
      break
    case 'GRIEF_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'griefDestroy') break
      const index = pending.chosenInstanceIds.indexOf(action.instanceId)
      if (index >= 0) pending.chosenInstanceIds.splice(index, 1)
      else if (pending.chosenInstanceIds.length < 2) pending.chosenInstanceIds.push(action.instanceId)
      break
    }
    case 'GRIEF_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'griefDestroy') break
      const owner = next.players[pending.owner]
      const destroyed: HandCard[] = []
      for (const instanceId of pending.chosenInstanceIds) {
        const card = takeCard(owner.discard, instanceId)
        if (card) destroyed.push(card)
      }
      for (const card of destroyed) destroyPermanently(next, owner, card)
      const count = destroyed.length
      if (count > 0) beginForcedDiscard(next, otherPlayer(pending.owner), count)
      else clearPending(next)
      break
    }
    case 'TRANSMUTE_DESTROY': {
      const pending = next.pending
      if (!pending || pending.kind !== 'transmuteHand') break
      const owner = next.players[pending.owner]
      const card = takeCard(owner.hand, action.instanceId)
      if (!card) break
      destroyPermanently(next, owner, card)
      next.pending = { kind: 'transmuteFetch', owner: pending.owner }
      break
    }
    case 'TRANSMUTE_FETCH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'transmuteFetch') break
      const owner = next.players[pending.owner]
      const card = takeCard(owner.discard, action.instanceId) ?? takeCard(owner.deck, action.instanceId)
      if (!card) break
      owner.hand.push(card)
      log(next, `${owner.name} transmutes ${getCard(card.defId).name} into their hand.`)
      clearPending(next)
      break
    }
    case 'BREW_WEAKNESS': {
      const pending = next.pending
      if (!pending || pending.kind !== 'brewWeakness') break
      const monster = targetMonster(next, pending.target)
      if (monster) {
        monster.weaknessOverride = action.damageType as DamageType
        log(
          next,
          `${getMonster(monster.defId).name}'s weakness becomes ${action.damageType}.`,
        )
      }
      clearPending(next)
      break
    }
    case 'DARK_CHARGE': {
      const charged = player.field[action.slot]
      const card = takeCard(player.discard, action.discardInstanceId)
      if (charged && card && hasDarkCharge(charged)) {
        if (!canReceiveEnergy(charged)) {
          player.discard.push(card)
          log(next, `${getMonster(charged.defId).name} cannot gain energy without a Colossus Keystone.`)
        } else {
          destroyPermanently(next, player, card)
          grantEnergy(next, charged, 1)
          next.attachedEnergyThisTurn = true
          log(next, `${player.name} Dark Charges ${getMonster(charged.defId).name}.`)
        }
      }
      break
    }
    case 'PLASMA_ROLL':
      applyPlasmaRoll(next)
      break
    case 'PLASMA_FIRE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'plasmaCannon' || pending.hits < 1) break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      if (source) {
        dealDamageToTarget(
          next,
          source,
          action.target,
          pending.hits * 20,
          'electric',
          false,
          pending.requiredEnergy,
        )
      }
      clearPending(next)
      break
    }
    case 'SOUND_WAVE_TARGET': {
      const pending = next.pending
      if (!pending || pending.kind !== 'soundWave') break
      const instanceId = targetInstanceId(next, action.target)
      if (!instanceId || pending.chosenInstanceIds.includes(instanceId)) break
      if (pending.chosenInstanceIds.length >= 3) break
      pending.chosenInstanceIds.push(instanceId)
      break
    }
    case 'SOUND_WAVE_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'soundWave') break
      const source = next.players[pending.sourcePlayer].field[pending.sourceSlot]
      for (const instanceId of pending.chosenInstanceIds) {
        const target = targetFromInstanceId(next, instanceId)
        if (!target) continue
        dealDamageToTarget(
          next,
          source,
          target,
          20,
          'sound',
          false,
          pending.requiredEnergy,
        )
      }
      clearPending(next)
      break
    }
    case 'MARCH_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'march') break
      const index = pending.chosenSlots.indexOf(action.slot)
      if (index >= 0) pending.chosenSlots.splice(index, 1)
      else pending.chosenSlots.push(action.slot)
      break
    }
    case 'MARCH_FINISH': {
      const pending = next.pending
      if (!pending || pending.kind !== 'march') break
      const owner = next.players[pending.owner]
      for (const slot of pending.chosenSlots) {
        const monster = owner.field[slot]
        if (!monster) continue
        monster.stance = monster.stance === 'active' ? 'withdrawn' : 'active'
        if (monster.stance === 'withdrawn' && monster.protectingInstanceId) {
          releaseProtection(next, monster)
        }
        if (!next.movedSlots.includes(slot)) next.movedSlots.push(slot)
        log(next, `${getMonster(monster.defId).name} ${monster.stance === 'withdrawn' ? 'withdraws' : 'advances'}.`)
      }
      clearPending(next)
      break
    }
    case 'PORTAL_FINISH':
      clearPending(next)
      break
    case 'ELDERS_PICK': {
      const pending = next.pending
      if (!pending || pending.kind !== 'eldersEye') break
      if (pending.order.includes(action.instanceId)) break
      if (!pending.cards.some((card) => card.instanceId === action.instanceId)) break
      pending.order.push(action.instanceId)
      if (pending.order.length === pending.cards.length) {
        const ordered = pending.order.map(
          (id) => pending.cards.find((card) => card.instanceId === id)!,
        )
        player.deck.unshift(...ordered)
        const drawn = player.deck.shift()
        if (drawn) {
          player.hand.push(drawn)
          log(next, `${player.name} draws a card.`)
        }
        clearPending(next)
      }
      break
    }
    case 'BEGIN_KEYSTONE': {
      next.pending = { kind: 'keystone', owner: player.id, chosenInstanceIds: [] }
      log(next, `${player.name} begins forging a Colossus Keystone.`)
      break
    }
    case 'KEYSTONE_TOGGLE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'keystone') break
      const index = pending.chosenInstanceIds.indexOf(action.instanceId)
      if (index >= 0) pending.chosenInstanceIds.splice(index, 1)
      else if (pending.chosenInstanceIds.length < 3) pending.chosenInstanceIds.push(action.instanceId)
      break
    }
    case 'KEYSTONE_CANCEL': {
      if (next.pending?.kind === 'keystone') {
        clearPending(next)
        log(next, `${player.name} stops forging a Colossus Keystone.`)
      }
      break
    }
    case 'KEYSTONE_ATTACH': {
      const pending = next.pending
      const colossus = player.field[action.slot]
      if (
        !pending ||
        pending.kind !== 'keystone' ||
        pending.chosenInstanceIds.length !== 3 ||
        !colossus ||
        colossus.defId !== 'colossus' ||
        hasKeystone(colossus)
      ) {
        break
      }
      for (const instanceId of [...pending.chosenInstanceIds]) {
        const card = takeCard(player.hand, instanceId)
        if (card) destroyPermanently(next, player, card)
      }
      colossus.equipment.push({
        instanceId: allocId(next),
        defId: 'colossus_keystone',
        hp: 1,
        maxHp: 1,
      })
      log(next, `${player.name} attaches a Colossus Keystone to Colossus.`)
      clearPending(next)
      break
    }
    case 'HOARD_CHOICE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'hoardChoice' || pending.owner !== player.id) break
      clearPending(next)
      if (action.mode === 'gold') beginAssignGold(next, player, 3)
      else beginAssignGold(next, player, 1, true)
      break
    }
    case 'ASSIGN_GOLD': {
      const pending = next.pending
      if (!pending || pending.kind !== 'assignGold' || pending.owner !== player.id) break
      const monster = player.field[action.slot]
      if (!monster || !getMonster(monster.defId).goldAffinity) break
      monster.gold = (monster.gold ?? 0) + 1
      log(next, `${getMonster(monster.defId).name} receives 1 gold (now ${monster.gold}).`)
      pending.remaining -= 1
      if (pending.remaining <= 0) {
        const drawAfter = pending.drawAfter === true
        clearPending(next)
        if (drawAfter) drawOne(next, player)
      }
      break
    }
    case 'FAIRY_HEAL': {
      const pending = next.pending
      if (!pending || pending.kind !== 'fairyHeal') break
      healTarget(next, action.target, 10)
      pending.remaining -= 1
      if (pending.remaining <= 0) {
        clearPending(next)
        tickStatuses(next)
        if (next.winner === null && next.pending === null) passTurn(next)
      }
      break
    }
    case 'PLACE_WEED': {
      const pending = next.pending
      if (!pending || pending.kind !== 'placeWeed') break
      const owner = next.players[pending.owner]
      const grows = action.slot === owner.field.length
      if (grows) owner.field.push(null)
      if (owner.field[action.slot]) break
      const def = getMonster('lovnis_weed')
      owner.field[action.slot] = {
        instanceId: allocId(next),
        defId: 'lovnis_weed',
        hp: def.maxHp,
        maxHp: def.maxHp,
        stance: action.stance,
        energy: 0,
        pendingEnergy: 0,
        statuses: [],
        equipment: [],
        ownsExtraSlot: grows ? true : undefined,
      }
      log(next, `${owner.name} places a Lovni's Weed (${action.stance}).`)
      clearPending(next)
      break
    }
    case 'STORM_TYPE': {
      const pending = next.pending
      if (!pending || pending.kind !== 'stormType') break
      next.pending = {
        kind: 'multiHit',
        sourcePlayer: pending.sourcePlayer,
        sourceSlot: pending.sourceSlot,
        remaining: 1,
        amount: pending.amount,
        damageType: action.damageType,
        requiredEnergy: pending.requiredEnergy,
      }
      log(next, `Bring the STORM is ${action.damageType}. Choose a target.`)
      break
    }
    case 'FORCE_WITHDRAW': {
      const pending = next.pending
      if (!pending || pending.kind !== 'forceWithdraw') break
      if (action.accept) forceWithdraw(next, pending.player, pending.slot)
      else {
        const staying = next.players[pending.player].field[pending.slot]
        log(next, staying ? `${getMonster(staying.defId).name} stays where it is.` : 'The target stays where it is.')
      }
      clearPending(next)
      break
    }
    case 'END_TURN': {
      if (!next.endStepResolved) {
        resolveEndStep(next)
        next.endStepResolved = true
      }
      if (next.winner !== null) break
      if (next.pending !== null) break
      passTurn(next)
      break
    }
  }

  collapseEmptyExtraSlots(next)
  return next
}
