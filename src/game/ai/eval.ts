import { getMonster, monsterAbilities } from '../catalog'
import { computeDamage } from '../damage'
import { isLivingPlayer, isTwoPlayer, livingOpponents, otherPlayer } from '../helpers'
import type {
  AbilityDef,
  AbilityEffect,
  DamageType,
  FieldMonster,
  GameState,
  PlayerId,
  PlayerState,
} from '../types'

function expectedEffectDamage(effect: AbilityEffect): number {
  if (effect.type === 'damage') return effect.amount
  if (effect.type === 'rollDamage') {
    const faces = Object.values(effect.table)
    if (faces.length === 0) return 0
    return faces.reduce((sum, n) => sum + n, 0) / faces.length
  }
  if (effect.type === 'chanceBoostDamage') {
    const p = effect.successFaces.length / 6
    return effect.base * (1 - p) + effect.boosted * p
  }
  return 0
}

function abilityExpectedBase(ability: AbilityDef): {
  amount: number
  damageType?: DamageType
  piercing?: boolean
} {
  let amount = 0
  let damageType: DamageType | undefined
  let piercing = false
  for (const effect of ability.effects) {
    const part = expectedEffectDamage(effect)
    if (part <= 0) continue
    amount += part
    if (effect.type === 'damage' || effect.type === 'rollDamage' || effect.type === 'chanceBoostDamage') {
      damageType = effect.damageType
      if (effect.type === 'damage' && effect.piercing) piercing = true
    }
  }
  const repeats = ability.repeats ?? 1
  return { amount: amount * repeats, damageType, piercing }
}

function readyDamage(state: GameState, attackerOwner: PlayerId, attacker: FieldMonster): number {
  const abilities = monsterAbilities(attacker)
  let best = 0
  const foes = isTwoPlayer(state)
    ? [state.players[otherPlayer(attackerOwner)]!]
    : livingOpponents(state, attackerOwner)
  const targets = foes.flatMap((foe) => foe.field.filter((m): m is FieldMonster => Boolean(m)))
  if (targets.length === 0) return 0

  for (const ability of abilities) {
    const cost = ability.cost.require + ability.cost.spend
    if (attacker.energy + (attacker.gold ?? 0) < cost) continue
    const { amount, damageType, piercing } = abilityExpectedBase(ability)
    if (amount <= 0) continue
    const base = Math.max(10, Math.round(amount / 10) * 10)
    for (const defender of targets) {
      const dealt = computeDamage({
        base,
        damageType,
        piercing,
        requiredEnergy: ability.cost.require,
        attacker,
        defender,
        bonusBeforeWeakness: state.players[attackerOwner].attackBonus ?? 0,
      })
      if (dealt > best) best = dealt
    }
  }
  return best
}

function sideScore(state: GameState, player: PlayerState, seat: PlayerId): number {
  let score = player.points * 1200

  for (const monster of player.field) {
    if (!monster) continue
    const def = getMonster(monster.defId)
    const hpRatio = monster.hp / Math.max(1, monster.maxHp)
    score += def.points * 180 + monster.hp * 1.2 + hpRatio * 40
    score += monster.energy * 35
    score += (monster.gold ?? 0) * 40
    score += monster.equipment.length * 50
    if (monster.stance === 'active') score += 25
    for (const status of monster.statuses) {
      if (status.kind === 'burn' || status.kind === 'poison') score -= 30 * status.turns
      if (status.kind === 'goo' || status.kind === 'frozen') score -= 45
      if (status.kind === 'weakened') score -= 20
      if (status.kind === 'cling') score -= 25
    }
    score += readyDamage(state, seat, monster) * 0.85
  }

  score += player.hand.length * 55
  score += Math.min(player.deck.length, 8) * 8
  if (player.hasFinishedFirstTurn && player.field.every((m) => !m)) score -= 5000
  return score
}

/** Higher is better for `seat`. */
export function evaluate(state: GameState, seat: PlayerId): number {
  if (state.winner === seat) return 1_000_000
  if (state.winner !== null) return -1_000_000
  if (state.players[seat] && !isLivingPlayer(state.players[seat]!)) return -1_000_000

  const me = state.players[seat]!
  if (isTwoPlayer(state)) {
    const foe = state.players[otherPlayer(seat)]!
    return sideScore(state, me, seat) - sideScore(state, foe, otherPlayer(seat))
  }

  const foes = livingOpponents(state, seat)
  if (foes.length === 0) return 1_000_000
  let bestFoe = -Infinity
  for (const foe of foes) {
    const score = sideScore(state, foe, foe.id)
    if (score > bestFoe) bestFoe = score
  }
  return sideScore(state, me, seat) - bestFoe
}
