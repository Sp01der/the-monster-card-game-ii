import { controlsGorruk, getCard, getMonster, identityDefId, isBoneling, isPlunderer } from './catalog'
import {
  computeDamage,
  attackBonusFor,
  effectiveDamageTypes,
  guardingGoldDefense,
  knightWindBonus,
  lensSuccessFaces,
  wearsLifestealBlade,
} from './damage'
import {
  applyStatus,
  checkLosses,
  destroyEquipment,
  discardMonster,
  grantEnergy,
  isDamageProtected,
  isStone,
  isThornflower,
  log,
  monsterAt,
  recordHeal,
  releaseProtection,
  resolveTarget,
  wakeAsleep,
} from './helpers'
import {
  BESIDE_SLOT,
  type AbilityChoice,
  type AbilityDef,
  type AbilityEffect,
  type DamageType,
  type FieldMonster,
  type GameState,
  type PlayerId,
  type PlayerState,
  type TargetRef,
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

let lastDealtDamage = 0

/** Damage the last dealDamageToTarget call actually applied. Raid reads this once. */
export function takeLastDealt(): number {
  const dealt = lastDealtDamage
  lastDealtDamage = 0
  return dealt
}

/** Each Ashling grows once after a card actually takes a fire damage packet. */
function growAshlings(state: GameState): void {
  for (const side of state.players) {
    for (const monster of side.field) {
      if (!monster || identityDefId(monster) !== 'ashling') continue
      const before = monster.hp
      monster.maxHp += 10
      monster.hp = Math.min(monster.maxHp, before + 10)
      const gained = Math.max(0, monster.hp - Math.max(0, before))
      recordHeal(state, gained)
      log(
        state,
        gained > 0
          ? `${getMonster(monster.defId).name} gains 10 max HP and heals ${gained} (now ${monster.hp}/${monster.maxHp}).`
          : `${getMonster(monster.defId).name} gains 10 max HP (now ${monster.hp}/${monster.maxHp}).`,
      )
    }
  }
}

function healLifesteal(state: GameState, attacker: FieldMonster | null, dealt: number, stealing: boolean): void {
  if (!stealing || dealt <= 0 || !attacker) return
  const stillThere = state.players.some((player) =>
    player.field.some((monster) => monster?.instanceId === attacker.instanceId),
  )
  if (!stillThere) return
  const before = attacker.hp
  attacker.hp = Math.min(attacker.maxHp, attacker.hp + 10)
  recordHeal(state, attacker.hp - before)
  if (attacker.hp === before) return
  log(state, `${getMonster(attacker.defId).name} heals ${attacker.hp - before} from Lifesteal Blade (now ${attacker.hp} HP).`)
}

function applyHitPoints(monster: FieldMonster, amount: number): boolean {
  if (amount > 0 && monster.unending && monster.hp - amount <= 0) {
    monster.hp = Math.min(monster.maxHp, 10)
    return true
  }
  monster.hp -= amount
  return false
}

/** Horror of the Deep: a survivor rolls after each damaging hit. */
function applyParalyzingFear(
  state: GameState,
  monster: FieldMonster,
  owner: PlayerState,
  slot: number,
  horrorOwner: PlayerId,
): void {
  const roll = rollDie(state)
  const name = getMonster(monster.defId).name
  if (roll >= 5) {
    log(state, `${name} resists Paralyzing Fear (${roll}).`)
    return
  }
  if (monster.stance !== 'withdrawn') {
    if (isBoneling(monster)) {
      log(state, `${name} cannot withdraw and dies instead.`)
      monster.hp = 0
      discardMonster(state, owner, slot, 'slain', horrorOwner)
      return
    }
    if (monster.protectingInstanceId) releaseProtection(state, monster)
    monster.stance = 'withdrawn'
    log(state, `${name} withdraws from Paralyzing Fear (${roll}).`)
  } else {
    log(state, `${name} is already withdrawn (Paralyzing Fear ${roll}).`)
  }
  if (roll <= 2) {
    monster.paralyzedBy = horrorOwner
    log(state, `${name} cannot act or gain energy until your next turn.`)
  }
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
  damageTypes?: DamageType[],
): TargetRef | null {
  lastDealtDamage = 0
  const rogueDouble =
    attacker?.enteredThisTurn === true && identityDefId(attacker) === 'hollow_rogue'
  if (rogueDouble) doubleBeforeDefense = true
  if (attacker && identityDefId(attacker) === 'larrathere_knight') {
    const types = effectiveDamageTypes(attacker, damageType, damageTypes)
    if (types.includes('wind')) {
      const owner = state.players.find((player) =>
        player.field.some((monster) => monster?.instanceId === attacker?.instanceId),
      )
      base += knightWindBonus(owner?.healedLastTurn)
    }
  }
  if (!attacker && state.spellSourceInstanceId) {
    for (const player of state.players) {
      const source = player.field.find((monster) => monster?.instanceId === state.spellSourceInstanceId)
      if (source) attacker = source
    }
  }
  const stealing = attacker !== null && wearsLifestealBlade(attacker)
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
    ? state.players.find(
        (player) =>
          player.field.some((monster) => monster?.instanceId === attacker.instanceId) ||
          player.beside?.instanceId === attacker.instanceId,
      )
    : undefined

  if (
    base > 0 &&
    attacker &&
    identityDefId(attacker) === 'kings_of_the_ocean' &&
    resolved.player.tributeSafe?.[resolved.monster.instanceId]
  ) {
    log(
      state,
      `${getMonster(resolved.monster.defId).name} cannot be harmed by the Kings (Tribute).`,
    )
    return null
  }

  if (
    base > 0 &&
    attacker &&
    attackerOwner &&
    attackerOwner.id !== resolved.player.id &&
    resolved.player.iceMirrorCharges > 0
  ) {
    resolved.player.iceMirrorCharges -= 1
    const attackerSlot =
      attackerOwner.beside?.instanceId === attacker.instanceId
        ? -1
        : attackerOwner.field.findIndex((monster) => monster?.instanceId === attacker.instanceId)
    const amount = computeDamage({
      base,
      damageType,
      damageTypes,
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
    if (amount > 0 && (endured || attacker.hp > 0)) wakeAsleep(state, attacker, amount)
    if (!endured && attacker.hp <= 0) {
      discardMonster(state, attackerOwner, attackerSlot, 'slain', resolved.player.id)
    }
    checkLosses(state)
    return { kind: 'monster', player: attackerOwner.id, slot: attackerSlot }
  }

  if (target.kind === 'equipment') {
    const eq = resolved.monster.equipment[target.equipmentIndex]
    if (!eq) return null
    const eqDef = getCard(eq.defId)
    if (eqDef.kind === 'equipment' && (eqDef.indestructible || eqDef.unbreakable)) {
      log(state, `${eqDef.name} cannot be removed.`)
      return target
    }
    if (eqDef.kind === 'equipment' && eqDef.attackProof) {
      log(state, `${eqDef.name} is not harmed by the attack.`)
      return target
    }
    if (
      base > 0 &&
      attacker &&
      identityDefId(attacker) === 'kings_of_the_ocean' &&
      resolved.player.tributeSafe?.[resolved.monster.instanceId]
    ) {
      log(
        state,
        `${getMonster(resolved.monster.defId).name}'s gear cannot be harmed by the Kings (Tribute).`,
      )
      return null
    }
    const equipmentDamage = rogueDouble ? base * 2 : base
    eq.hp -= equipmentDamage
    lastDealtDamage = equipmentDamage
    if (equipmentDamage > 0) rememberAggressor(state, attacker, resolved.player.id)
    log(
      state,
      `${getCard(eq.defId).name} takes ${equipmentDamage} damage (${Math.max(0, eq.hp)} HP left).`,
    )
    if (
      equipmentDamage > 0 &&
      effectiveDamageTypes(attacker, damageType, damageTypes).includes('fire')
    ) {
      growAshlings(state)
    }
    if (eq.hp <= 0) {
      destroyEquipment(state, resolved.player, resolved.slot, target.equipmentIndex)
    }
    healLifesteal(state, attacker, lastDealtDamage, stealing)
    checkLosses(state)
    return target
  }

  const hitTypes = effectiveDamageTypes(attacker, damageType, damageTypes)
  if (isStone(resolved.monster) && !hitTypes.includes('blast')) {
    log(state, `${getMonster(resolved.monster.defId).name} is Stone and takes no damage.`)
    return null
  }

  const amount = computeDamage({
    base,
    damageType,
    damageTypes,
    piercing,
    requiredEnergy,
    attacker,
    defender: resolved.monster,
    doubleBeforeDefense,
    defenseBonus: guardingGoldDefense(state, resolved.monster),
    bonusBeforeWeakness: bonus,
  })

  const endured = applyHitPoints(resolved.monster, amount)
  lastDealtDamage = amount
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
  if (amount > 0 && isStone(resolved.monster) && hitTypes.includes('blast')) {
    resolved.monster.statuses = resolved.monster.statuses.filter((status) => status.kind !== 'stone')
    log(state, `The blast breaks the Stone on ${getMonster(resolved.monster.defId).name}.`)
  }
  if (amount > 0 && (endured || resolved.monster.hp > 0)) wakeAsleep(state, resolved.monster, amount)
  if (amount > 0 && hitTypes.includes('electric') && resolved.monster.defId === 'lightning_worm') {
    if (grantEnergy(state, resolved.monster, 1) > 0) {
      log(state, 'Lightning Worm gains 1 energy from the electric attack.')
    }
  }
  if (amount > 0 && hitTypes.includes('fire')) growAshlings(state)

  if (!endured && resolved.monster.hp <= 0) {
    const killer = attackerOwner?.id ?? state.activePlayer
    if (
      attacker &&
      identityDefId(attacker) === 'lord_devadian' &&
      attackerOwner &&
      state.pending?.kind !== 'bloodlustChoice'
    ) {
      const points = resolved.monster.pointsOverride ?? getMonster(resolved.monster.defId).points
      const devadianSlot =
        attackerOwner.beside?.instanceId === attacker.instanceId
          ? -1
          : attackerOwner.field.findIndex((m) => m?.instanceId === attacker.instanceId)
      // Nest over multi-hit (Shadow Matter) or any other open interaction.
      if (state.pending) state.pendingStack.push(state.pending)
      state.pending = {
        kind: 'bloodlustChoice',
        owner: attackerOwner.id,
        slot: devadianSlot,
        slainOwner: resolved.player.id,
        slainSlot: resolved.slot,
        points,
      }
      log(state, `${getMonster(attacker.defId).name} may claim Bloodlust.`)
    } else {
      discardMonster(state, resolved.player, resolved.slot, 'slain', killer)
    }
  } else if (
    amount > 0 &&
    attacker &&
    identityDefId(attacker) === 'horror_of_the_deep' &&
    attackerOwner
  ) {
    applyParalyzingFear(state, resolved.monster, resolved.player, resolved.slot, attackerOwner.id)
  }
  if (
    amount > 0 &&
    attacker &&
    attackerOwner &&
    attacker.instanceId !== resolved.monster.instanceId &&
    isPlunderer(identityDefId(attacker)) &&
    controlsGorruk(attackerOwner)
  ) {
    attacker.gold = (attacker.gold ?? 0) + 1
    log(
      state,
      `${getMonster(attacker.defId).name} gains 1 gold from Shinies (now ${attacker.gold}).`,
    )
  }
  healLifesteal(state, attacker, lastDealtDamage, stealing)
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

  if (isThornflower(resolved.monster.defId)) {
    // Nest over fairyHeal (and any other open prompt) so Growth is never skipped.
    if (
      state.pending?.kind === 'thornGrowth' &&
      state.pending.owner === resolved.player.id &&
      state.pending.slot === resolved.slot
    ) {
      state.pending.amount += amount
      return
    }
    if (state.pending) state.pendingStack.push(state.pending)
    state.pending = {
      kind: 'thornGrowth',
      owner: resolved.player.id,
      slot: resolved.slot,
      amount,
    }
    log(state, `${getMonster(resolved.monster.defId).name} may replace the heal with Monstrous Growth.`)
    return
  }

  const before = resolved.monster.hp
  resolved.monster.hp = Math.min(resolved.monster.maxHp, resolved.monster.hp + amount)
  const gained = resolved.monster.hp - before
  recordHeal(state, gained)
  const name = getMonster(resolved.monster.defId).name
  if (gained <= 0) {
    log(state, `${name} is already at full HP.`)
    return
  }
  log(state, `${name} heals ${gained} (now ${resolved.monster.hp} HP).`)
}

function effectsForChoice(choice: AbilityChoice): AbilityEffect[] {
  if (choice === 'firePunchFull') {
    return [{ type: 'damage', amount: 30, damageType: 'fire' }]
  }
  return [
    { type: 'damage', amount: 10, damageType: 'fire' },
    { type: 'status', status: 'burn', turns: 2 },
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
        false,
        effect.damageTypes,
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
      const owner = state.players.find(
        (player) =>
          player.field.some((m) => m?.instanceId === attacker.instanceId) ||
          player.beside?.instanceId === attacker.instanceId,
      )
      if (!owner) return target
      const slot =
        owner.beside?.instanceId === attacker.instanceId
          ? BESIDE_SLOT
          : owner.field.findIndex((m) => m?.instanceId === attacker.instanceId)
      if (slot < 0 && owner.beside?.instanceId !== attacker.instanceId) return target
      healTarget(state, { kind: 'monster', player: owner.id, slot }, effect.amount)
      return target
    }
    case 'status': {
      if (target?.kind === 'equipment') return target
      if (!target || target.kind !== 'monster') throw new Error('Status requires a monster target')
      const resolved = resolveTarget(state, target)
      if (!resolved) return target
      if (
        applyStatus(
          resolved.monster,
          effect.status,
          effect.turns,
          effect.stacks ?? 1,
          undefined,
          resolved.player.id === state.activePlayer,
          state.activePlayer,
        )
      ) {
        log(
          state,
          `${getMonster(resolved.monster.defId).name} gains ${effect.status}${
            (effect.stacks ?? 1) > 1 ? ` x${effect.stacks}` : ''
          }.`,
        )
      }
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
      if (
        applyStatus(
          resolved.monster,
          effect.status,
          effect.turns,
          1,
          undefined,
          resolved.player.id === state.activePlayer,
          state.activePlayer,
        )
      ) {
        log(state, `${getMonster(resolved.monster.defId).name} gains ${effect.status}.`)
      }
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
  const attacker = monsterAt(owner, slot)
  if (!attacker) return

  const repeats = ability.repeats ?? 1
  if (repeats > 1) {
    const damage = ability.effects.find((effect) => effect.type === 'damage')
    if (damage?.type === 'damage') {
      state.pending = {
        kind: 'multiHit',
        sourcePlayer: owner.id,
        sourceSlot: slot,
        remaining: repeats,
        amount: damage.amount,
        damageType: damage.damageType ?? 'untyped',
        piercing: damage.piercing,
        requiredEnergy,
      }
      return
    }
  }
  for (let r = 0; r < repeats; r++) {
    if (!monsterAt(owner, slot)) break
    const source = monsterAt(owner, slot)!
    let effectiveTarget = target
    for (const effect of ability.effects) {
      // Finish remaining effects (e.g. Explode's removeSelf) even if a winner was set.
      if (!monsterAt(owner, slot) && effect.type !== 'removeSelf') continue
      effectiveTarget =
        resolveOneEffect(
          state,
          owner,
          slot,
          monsterAt(owner, slot) ?? source,
          effect,
          effectiveTarget,
          choice,
          requiredEnergy,
        ) ?? effectiveTarget
    }
  }
}

export function abilityNeedsTarget(ability: AbilityDef, choice?: AbilityChoice): boolean {
  if ((ability.repeats ?? 1) > 1) return false
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
