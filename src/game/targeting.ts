import { getCard } from './catalog'
import type { AbilityDef, FieldMonster, GameState, PlayerId, PlayerState, TargetRef } from './types'
import { getPlayer, isDamageProtected, otherPlayer } from './helpers'

function opposingMonsters(state: GameState, attackerPlayer: PlayerId) {
  const opp = getPlayer(state, otherPlayer(attackerPlayer))
  const monsters: { slot: number; monster: FieldMonster }[] = []
  for (let i = 0; i < opp.field.length; i++) {
    const m = opp.field[i]
    if (m) monsters.push({ slot: i, monster: m })
  }
  return { opp, monsters }
}

function hasActiveEnemy(monsters: { monster: FieldMonster }[]): boolean {
  return monsters.some(({ monster }) => monster.stance === 'active')
}

/**
 * Normal attack targets: opposing active monsters.
 * If the opponent has no active monsters, withdrawn ones may be attacked as if active.
 */
export function normalAttackTargets(state: GameState, attackerPlayer: PlayerId): TargetRef[] {
  const { opp, monsters } = opposingMonsters(state, attackerPlayer)
  const allowWithdrawn = !hasActiveEnemy(monsters)
  const targets: TargetRef[] = []
  for (const { slot, monster } of monsters) {
    if (monster.stance === 'active' || allowWithdrawn) {
      targets.push({ kind: 'monster', player: opp.id, slot })
    }
  }
  return targets
}

/**
 * Ranged: can be used while withdrawn.
 * May target withdrawn enemies when the attacker is active (frontline),
 * or when the opponent has no active monsters (treated as active for targeting).
 */
export function rangedAttackTargets(
  state: GameState,
  attackerPlayer: PlayerId,
  attacker: FieldMonster,
): TargetRef[] {
  const { opp, monsters } = opposingMonsters(state, attackerPlayer)
  const noActive = !hasActiveEnemy(monsters)
  const targets: TargetRef[] = []
  for (const { slot, monster } of monsters) {
    if (monster.stance === 'active') {
      targets.push({ kind: 'monster', player: opp.id, slot })
    } else if (attacker.stance === 'active' || noActive) {
      targets.push({ kind: 'monster', player: opp.id, slot })
    }
  }
  return targets
}

export function abilityTargets(
  state: GameState,
  attackerPlayer: PlayerId,
  attacker: FieldMonster,
  ability: AbilityDef,
): TargetRef[] {
  if (ability.ranged) {
    return rangedAttackTargets(state, attackerPlayer, attacker)
  }
  const selfOnly =
    ability.effects.length > 0 &&
    ability.effects.every((e) => e.type === 'healSelf' || e.type === 'removeSelf')
  if (selfOnly) return []
  return normalAttackTargets(state, attackerPlayer)
}

/** Effects that say "any card": any monster or equipment on either side. */
export function anyCardTargets(state: GameState): TargetRef[] {
  const targets: TargetRef[] = []
  for (const player of state.players) {
    for (let i = 0; i < player.field.length; i++) {
      const m = player.field[i]
      if (!m) continue
      targets.push({ kind: 'monster', player: player.id, slot: i })
      m.equipment.forEach((_, eqIndex) => {
        targets.push({
          kind: 'equipment',
          player: player.id,
          slot: i,
          equipmentIndex: eqIndex,
        })
      })
    }
  }
  return targets
}

export function withoutProtected(state: GameState, targets: TargetRef[]): TargetRef[] {
  return targets.filter((target) => {
    const monster = state.players[target.player].field[target.slot]
    return !monster || !isDamageProtected(state, monster)
  })
}

const NO_EQUIPMENT_SPECIALS = new Set([
  'bigSplat',
  'burningGoo',
  'cling',
  'imilithiasBrew',
  'collect',
  'supply',
  'transferal',
  'stampede',
  'rocket',
  'groundShaker',
  'bottleToxins',
  'poisonGas',
  'magicDoor',
  'freezeTwo',
  'frostBreath',
  'chillingScreech',
  'eyeFlash',
])

const EQUIPMENT_STRIKE_SPECIALS = new Set([
  'waterClaw',
  'waterGush',
  'swarm',
  'healOther',
  'charge',
  'discharge',
  'mudball',
  'waterJet',
  'hunt',
  'iceyBeak',
  'frostbite',
  'frozenSting',
  'lightningNeedle',
  'flurryOfBlows',
  'lavaClaw',
  'magmaGush',
  'solarFlare',
  'pilfer',
  'zap',
  'guardiansBlade',
  'smash',
  'ironTail',
  'openFourthFloor',
  'underground',
  'chorus',
  'gleam',
  'healingLight',
  'greatAxe',
  'dwarvenSpirit',
  'dragonTalons',
  'scent',
  'burningSpear',
])

/** A chosen single card. Area attacks and adjacency attacks are excluded. */
export function offersEquipmentTargets(ability: AbilityDef): boolean {
  if (ability.special) {
    if (NO_EQUIPMENT_SPECIALS.has(ability.special)) return false
    return EQUIPMENT_STRIKE_SPECIALS.has(ability.special)
  }
  return ability.effects.some(
    (effect) =>
      effect.type === 'damage' ||
      effect.type === 'rollDamage' ||
      effect.type === 'chanceBoostDamage' ||
      effect.type === 'choice',
  )
}

/** Equipment on an already-legal host. Does not invent hosts. */
export function withHostEquipment(state: GameState, targets: TargetRef[]): TargetRef[] {
  const equipment: TargetRef[] = []
  for (const target of targets) {
    if (target.kind !== 'monster') continue
    const monster = state.players[target.player].field[target.slot]
    if (!monster) continue
    monster.equipment.forEach((_, equipmentIndex) => {
      equipment.push({
        kind: 'equipment',
        player: target.player,
        slot: target.slot,
        equipmentIndex,
      })
    })
  }
  return [...targets, ...equipment]
}

export function anyMonsterTargets(state: GameState): TargetRef[] {
  const targets: TargetRef[] = []
  for (const player of state.players) {
    for (let i = 0; i < player.field.length; i++) {
      if (player.field[i]) {
        targets.push({ kind: 'monster', player: player.id, slot: i })
      }
    }
  }
  return targets
}

export function effectTargetOptions(state: GameState, effectId: string): TargetRef[][] {
  switch (effectId) {
    case 'whirlpool':
      return withHostEquipment(
        state,
        withoutProtected(state, normalAttackTargets(state, state.activePlayer)),
      ).map((t) => [t])
    case 'heal_30':
      return anyCardTargets(state).map((t) => [t])
    case 'damage_20_any':
    case 'anvil':
      return withoutProtected(state, anyCardTargets(state)).map((t) => [t])
    case 'energy_3':
      return anyMonsterTargets(state).map((t) => [t])
    case 'daybreak':
      return withHostEquipment(
        state,
        withoutProtected(
          state,
          state.players[otherPlayer(state.activePlayer)].field.flatMap((monster, slot) =>
            monster
              ? [{ kind: 'monster' as const, player: otherPlayer(state.activePlayer), slot }]
              : [],
          ),
        ),
      ).map((target) => [target])
    case 'empower':
      return state.players[state.activePlayer].field.flatMap((monster, slot) =>
        monster
          ? [[{ kind: 'monster' as const, player: state.activePlayer, slot }]]
          : [],
      )
    case 'rally': {
      const monsters = anyMonsterTargets(state)
      const pairs: TargetRef[][] = []
      for (let i = 0; i < monsters.length; i++) {
        for (let j = i + 1; j < monsters.length; j++) {
          pairs.push([monsters[i], monsters[j]])
        }
      }
      return pairs
    }
    default:
      return []
  }
}

export function describeTarget(state: GameState, target: TargetRef): string {
  const player = getPlayer(state, target.player)
  const monster = player.field[target.slot]
  if (!monster) return 'empty'
  const name = getCard(monster.defId).name
  if (target.kind === 'equipment') {
    const eq = monster.equipment[target.equipmentIndex]
    return `${getCard(eq.defId).name} on ${player.name}'s ${name}`
  }
  return `${player.name}'s ${name}`
}

export function canUseAbilityWhileWithdrawn(attacker: FieldMonster, ability: AbilityDef): boolean {
  if (attacker.stance === 'active') return true
  return Boolean(ability.ranged)
}

export function countMonsters(player: PlayerState): number {
  return player.field.filter(Boolean).length
}
