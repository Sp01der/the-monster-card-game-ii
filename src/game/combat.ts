import { getCard, getMonster } from './catalog'
import { computeDamage, attackBonusFor, guardingGoldDefense, lensSuccessFaces } from './damage'
import {
  applyStatus,
  checkLosses,
  destroyEquipment,
  discardMonster,
  grantEnergy,
  isDamageProtected,
  log,
  resolveTarget,
} from './helpers'
import type {
  AbilityChoice,
  AbilityDef,
  AbilityEffect,
  DamageType,
  FieldMonster,
  GameState,
  PlayerState,
  TargetRef,
} from './types'
import { rollDie } from './helpers'

function redirectFatalHonour(
  state: GameState,
  attacker: FieldMonster | null,
  target: TargetRef,
  base: number,
  damageType: DamageType,
  piercing: boolean,
  requiredEnergy: number,
  doubleBeforeDefense = false,
): TargetRef {
  if (target.kind !== 'monster' || base <= 0) return target
  const resolved = resolveTarget(state, target)
  if (!resolved || resolved.monster.honourGuardUntilNextTurn) return target
  const amount = computeDamage({
    base,
    damageType,
    piercing,
    requiredEnergy,
    attacker,
    defender: resolved.monster,
    doubleBeforeDefense,
    defenseBonus: guardingGoldDefense(state, resolved.monster),
    bonusBeforeWeakness: attackBonusFor(state, attacker),
  })
  if (amount < resolved.monster.hp) return target
  for (let slot = 0; slot < resolved.player.field.length; slot++) {
    const knight = resolved.player.field[slot]
    if (!knight?.honourGuardUntilNextTurn) continue
    if (knight.instanceId === resolved.monster.instanceId) continue
    knight.energy = Math.max(0, knight.energy - 1)
    log(
      state,
      `Knight's Honour redirects a fatal hit from ${getMonster(resolved.monster.defId).name} to ${getMonster(knight.defId).name}.`,
    )
    return { kind: 'monster', player: resolved.player.id, slot }
  }
  return target
}

function rememberAggressor(
  state: GameState,
  attacker: FieldMonster | null,
  victimPlayerId: number,
): void {
  if (!attacker) return
  const victim = state.players[victimPlayerId as 0 | 1]
  const ids = victim.damagedByInstanceIds ?? []
  if (ids.includes(attacker.instanceId)) return
  victim.damagedByInstanceIds = [...ids, attacker.instanceId]
}

function applyHitPoints(monster: FieldMonster, amount: number): boolean {
  if (amount > 0 && monster.unending && monster.hp - amount <= 0) {
    monster.hp = Math.min(monster.maxHp, 10)
    return true
  }
  monster.hp -= amount
  return false
}

export function dealDamageToTarget(
  state: GameState,
  attacker: FieldMonster | null,
  target: TargetRef,
  base: number,
  damageType: DamageType = 'untyped',
  piercing = false,
  requiredEnergy = 0,
  doubleBeforeDefense = false,
): TargetRef | null {
  target = redirectFatalHonour(
    state,
    attacker,
    target,
    base,
    damageType,
    piercing,
    requiredEnergy,
    doubleBeforeDefense,
  )
  const resolved = resolveTarget(state, target)
  if (!resolved) return null
  const bonus = attackBonusFor(state, attacker)

  if (base > 0 && isDamageProtected(state, resolved.monster)) {
    log(
      state,
      `${getMonster(resolved.monster.defId).name} is protected and cannot be damaged.`,
    )
    return null
  }

  const attackerOwner = attacker
    ? state.players.find((player) =>
        player.field.some((monster) => monster?.instanceId === attacker.instanceId),
      )
    : undefined
  if (
    base > 0 &&
    attacker &&
    attackerOwner &&
    attackerOwner.id !== resolved.player.id &&
    resolved.player.iceMirrorCharges > 0
  ) {
    resolved.player.iceMirrorCharges -= 1
    const attackerSlot = attackerOwner.field.findIndex(
      (monster) => monster?.instanceId === attacker.instanceId,
    )
    const amount = computeDamage({
      base,
      damageType,
      piercing,
      requiredEnergy,
      attacker,
      defender: attacker,
      doubleBeforeDefense,
      defenseBonus: guardingGoldDefense(state, attacker),
      bonusBeforeWeakness: bonus,
    })
    const endured = applyHitPoints(attacker, amount)
    log(
      state,
      endured
        ? `${resolved.player.name}'s Ice Mirror reflects the attack; ${getMonster(attacker.defId).name} endures at ${attacker.hp} HP.`
        : `${resolved.player.name}'s Ice Mirror reflects the attack; ${getMonster(attacker.defId).name} takes ${amount} damage (${Math.max(0, attacker.hp)} HP left).`,
    )
    if (!endured && attacker.hp <= 0 && attackerSlot >= 0) {
      discardMonster(state, attackerOwner, attackerSlot, 'slain')
    }
    checkLosses(state)
    return attackerSlot >= 0
      ? { kind: 'monster', player: attackerOwner.id, slot: attackerSlot }
      : null
  }

  if (target.kind === 'equipment') {
    const eq = resolved.monster.equipment[target.equipmentIndex]
    if (!eq) return null
    const eqDef = getCard(eq.defId)
    if (eqDef.kind === 'equipment' && eqDef.indestructible) {
      log(state, `${eqDef.name} cannot be destroyed.`)
      return target
    }
    eq.hp -= base
    if (base > 0) rememberAggressor(state, attacker, resolved.player.id)
    log(
      state,
      `${getCard(eq.defId).name} takes ${base} damage (${Math.max(0, eq.hp)} HP left).`,
    )
    if (eq.hp <= 0) {
      destroyEquipment(state, resolved.player, resolved.slot, target.equipmentIndex)
    }
    checkLosses(state)
    return target
  }

  const amount = computeDamage({
    base,
    damageType,
    piercing,
    requiredEnergy,
    attacker,
    defender: resolved.monster,
    doubleBeforeDefense,
    defenseBonus: guardingGoldDefense(state, resolved.monster),
    bonusBeforeWeakness: bonus,
  })

  const endured = applyHitPoints(resolved.monster, amount)
  if (amount > 0) rememberAggressor(state, attacker, resolved.player.id)
  const def = getMonster(resolved.monster.defId)
  log(
    state,
    endured
      ? `${def.name} takes ${amount} damage but endures at ${resolved.monster.hp} HP.`
      : `${resolved.player.name}'s ${def.name} takes ${amount} damage (${Math.max(0, resolved.monster.hp)} HP left).`,
  )
  if (amount > 0 && (resolved.monster.fortifyHitsLeft ?? 0) > 0) {
    resolved.monster.fortifyHitsLeft = (resolved.monster.fortifyHitsLeft ?? 0) - 1
    if (resolved.monster.fortifyHitsLeft <= 0) {
      log(state, `${def.name}'s Fortify fades.`)
    }
  }
  if (amount > 0 && damageType === 'electric' && resolved.monster.defId === 'lightning_worm') {
    if (grantEnergy(state, resolved.monster, 1) > 0) {
      log(state, 'Lightning Worm gains 1 energy from the electric attack.')
    }
  }

  if (!endured && resolved.monster.hp <= 0) {
    discardMonster(state, resolved.player, resolved.slot, 'slain')
  }
  checkLosses(state)
  return target
}

export function healTarget(state: GameState, target: TargetRef, amount: number): void {
  const resolved = resolveTarget(state, target)
  if (!resolved) return

  if (target.kind === 'equipment') {
    const eq = resolved.monster.equipment[target.equipmentIndex]
    if (!eq) return
    eq.hp = Math.min(eq.maxHp, eq.hp + amount)
    log(state, `${getCard(eq.defId).name} heals ${amount} (now ${eq.hp} HP).`)
    return
  }

  resolved.monster.hp = Math.min(resolved.monster.maxHp, resolved.monster.hp + amount)
  log(
    state,
    `${getMonster(resolved.monster.defId).name} heals ${amount} (now ${resolved.monster.hp} HP).`,
  )
}

function effectsForChoice(choice: AbilityChoice): AbilityEffect[] {
  if (choice === 'firePunchFull') {
    return [{ type: 'damage', amount: 30, damageType: 'fire' }]
  }
  return [
    { type: 'damage', amount: 10, damageType: 'fire' },
    { type: 'status', status: 'burn', turns: 3 },
  ]
}

function resolveOneEffect(
  state: GameState,
  owner: PlayerState,
  attackerSlot: number,
  attacker: FieldMonster,
  effect: AbilityEffect,
  target: TargetRef | undefined,
  choice: AbilityChoice | undefined,
  requiredEnergy: number,
): TargetRef | null | undefined {
  switch (effect.type) {
    case 'choice': {
      if (!choice || !effect.options.includes(choice)) {
        throw new Error('Ability choice required')
      }
      let effectiveTarget = target
      for (const e of effectsForChoice(choice)) {
        effectiveTarget =
          resolveOneEffect(
            state,
            owner,
            attackerSlot,
            attacker,
            e,
            effectiveTarget,
            choice,
            requiredEnergy,
          ) ?? effectiveTarget
      }
      return effectiveTarget
    }
    case 'damage': {
      if (!target) throw new Error('Damage requires a target')
      return dealDamageToTarget(
        state,
        attacker,
        target,
        effect.amount,
        effect.damageType ?? 'untyped',
        effect.piercing,
        requiredEnergy,
      )
    }
    case 'rollDamage': {
      if (!target) throw new Error('Damage requires a target')
      const roll = rollDie(state)
      const amount = effect.table[roll] ?? 0
      return dealDamageToTarget(
        state,
        attacker,
        target,
        amount,
        effect.damageType ?? 'untyped',
        false,
        requiredEnergy,
      )
    }
    case 'chanceBoostDamage': {
      if (!target) throw new Error('Damage requires a target')
      const roll = rollDie(state)
      const amount = lensSuccessFaces(attacker, effect.successFaces).includes(roll)
        ? effect.boosted
        : effect.base
      return dealDamageToTarget(
        state,
        attacker,
        target,
        amount,
        effect.damageType ?? 'untyped',
        false,
        requiredEnergy,
      )
    }
    case 'healSelf': {
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + effect.amount)
      log(
        state,
        `${getMonster(attacker.defId).name} heals ${effect.amount} (now ${attacker.hp} HP).`,
      )
      return target
    }
    case 'status': {
      if (target?.kind === 'equipment') return target
      if (!target || target.kind !== 'monster') throw new Error('Status requires a monster target')
      const resolved = resolveTarget(state, target)
      if (!resolved) return target
      applyStatus(
        resolved.monster,
        effect.status,
        effect.turns,
        effect.stacks ?? 1,
        undefined,
        resolved.player.id === state.activePlayer,
      )
      log(
        state,
        `${getMonster(resolved.monster.defId).name} gains ${effect.status}${
          (effect.stacks ?? 1) > 1 ? ` x${effect.stacks}` : ''
        }.`,
      )
      return target
    }
    case 'chanceStatus': {
      if (target?.kind === 'equipment') return target
      if (!target || target.kind !== 'monster') throw new Error('Status requires a monster target')
      const roll = rollDie(state)
      if (!lensSuccessFaces(attacker, effect.successFaces).includes(roll)) {
        log(state, `${effect.status} chance failed.`)
        return target
      }
      const resolved = resolveTarget(state, target)
      if (!resolved) return target
      applyStatus(
        resolved.monster,
        effect.status,
        effect.turns,
        1,
        undefined,
        resolved.player.id === state.activePlayer,
      )
      log(state, `${getMonster(resolved.monster.defId).name} gains ${effect.status}.`)
      return target
    }
    case 'removeSelf': {
      discardMonster(state, owner, attackerSlot, 'removed')
      checkLosses(state)
      return target
    }
  }
}

export function resolveAbility(
  state: GameState,
  owner: PlayerState,
  slot: number,
  ability: AbilityDef,
  target: TargetRef | undefined,
  choice: AbilityChoice | undefined,
  requiredEnergy = ability.cost.require,
): void {
  const attacker = owner.field[slot]
  if (!attacker) return

  const repeats = ability.repeats ?? 1
  for (let r = 0; r < repeats; r++) {
    if (!owner.field[slot]) break
    const source = owner.field[slot]!
    let effectiveTarget = target
    for (const effect of ability.effects) {
      // Finish remaining effects (e.g. Explode's removeSelf) even if a winner was set.
      if (!owner.field[slot] && effect.type !== 'removeSelf') continue
      effectiveTarget =
        resolveOneEffect(
          state,
          owner,
          slot,
          owner.field[slot] ?? source,
          effect,
          effectiveTarget,
          choice,
          requiredEnergy,
        ) ?? effectiveTarget
    }
  }
}

export function abilityNeedsTarget(ability: AbilityDef, choice?: AbilityChoice): boolean {
  const effects =
    ability.effects[0]?.type === 'choice' && choice
      ? effectsForChoice(choice)
      : ability.effects
  return effects.some(
    (e) =>
      e.type === 'damage' ||
      e.type === 'rollDamage' ||
      e.type === 'chanceBoostDamage' ||
      e.type === 'status' ||
      e.type === 'chanceStatus' ||
      e.type === 'choice',
  )
}

export function abilityNeedsChoice(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'choice')
}
