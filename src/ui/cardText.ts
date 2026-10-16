import { formatDamageType, getCard, getWeaknesses } from '../game/catalog'
import type { AbilityDef, CardDef, EnergyCost } from '../game/types'

export function formatCost(cost: EnergyCost): string {
  return `${'0'.repeat(cost.require)}${'+'.repeat(cost.spend)}` || '—'
}

const ABILITY_TEXT: Record<string, string> = {
  wakkle: '20 damage',
  splat: 'Goo a target. A Gooed card cannot use abilities.',
  elder_punch: '20 damage',
  elders_eye: 'View the top three cards of your deck, rearrange them, and draw a card.',
  breaker_bash: '30 earth damage',
  ground_shaker: '20 earth damage to a monster and both of its circle neighbors.',
  break: '40 earth damage. Piercing.',
  troll_bash: '30 damage',
  boulder_toss: '4/6 chance of 60 earth damage.',
  meat_shield: 'Protect an orc or goblin you control.',
  burrow: 'Withdraw or advance this card. Does not spend your move.',
  claw_bash: '10 damage',
  underground: '20 earth damage to any card.',
  guardians_blade: '20 damage.',
  guard: 'Protect one of your cards.',
  iron_tail: '4/6 chance of 40 damage and Weakened for 1 turn.',
  smash: 'Roll 1–2 = 30, 3–4 = 40, 5–6 = 50. The target is Weakened.',
  fortify: 'Defense +1 until this card is hit twice. Does not stack.',
  quake: "10 earth damage to each of the opponent's monsters.",
  ancient_guardian: 'Protect one of your cards.',
  open_fourth_floor: '20 damage and draw a card.',
  magic_door: 'Withdraw or advance an adjacent card you own. Does not spend your move.',
  yellow_wakkle: '20 electric damage',
  yellow_splat: 'Goo a target. A Gooed card cannot use abilities.',
  shard: '20 ice damage',
  frozen_mist: '10 ice damage + freeze',
  chomp: 'Roll: 1–3 = 30, 4–6 = 40',
  regrow: 'Heal 10 HP',
  arrow_volley: '20 damage',
  snipe: '40 damage',
  fire_punch: '30 fire, or 10 fire + burn',
  overheat: '10 fire and Burn (3 turns) ×3, separately targeted',
  poke: '10 damage',
  explode: '100 blast. This card is removed.',
  // Ember Tortoise also has chomp — override by checking in helper if needed
  sizzling_shell: '20 fire; 2/6 burn (2 turns) ×2',
  claw: '20 damage',
  water_gush: '5/6: 20 water damage + Wet',
  magic_missile: '20 damage',
  spark: '3/6: base energy pool becomes 3 this turn',
  trickery: 'Random opponent hand card → anywhere in their deck',
  swoop_scratch: 'Roll: 1–2 = 0; 3–4 = 30; 5–6 = 50 poison',
  tail_sting: '20 poison damage + Poison',
  big_splat: 'Goo; 1/6 chance to Goo another target',
  red_wakkle: '30 fire damage',
  burning_goo: 'Goo; fire-weak target also Burns 1 turn',
  swarm: '10 per Blob; 20 per Big Blob in your field',
  claw_rake: '20 damage; 3/6 = 30 instead',
  cling: 'Immobilize and deal 10 each turn while energized',
  scratch: '20 damage',
  vampiric_suck: '10 poison damage; heal self 10',
  rusty_claw: '4/6 chance of 30 damage',
  plasma_volley: 'Roll: deal 1–3 separate 20 electric hits',
  light_beam: '10 light damage; 3/6 = 20 instead',
  heal: 'Heal another monster 20 HP',
  energize: 'All your monsters gain 1; skip energy phase',
  bolt: '50 electric damage',
  horn_stab: 'Roll: 0/10/20/20/20/30 damage',
  charge: '20 damage; spend extra energy for +20 each',
  transferal: 'Move up to 2 energy between monsters; skip energy',
  discharge: '4/6 chance of 30 electric damage',
  cruel_scimitar: '5/6 chance of 40 damage',
  poisoned_shaft: '10 poison damage + Poison',
  blood_thirsty: '10 damage',
  fish: 'Draw a card',
  mudball: 'Roll: 1–3 = 10 water; 4–5 = 20 water; 6 = 10 water + Wet',
  rusty_cutlass: '4/6 chance of 30 damage',
  lost_treasure: 'Choose a card from your discard and add it to your hand',
  sunken_plunder: "Choose a card from your opponent's discard and add it to your hand",
  splash: '10 water damage + Wet',
  water_jet: '5/6 chance of 40 water damage + Wet',
  treasures_waves: 'Draw a card',
  sting: '20 poison damage',
  tentacle_attack: 'Three separately targeted hits of 20 damage',
  absorb: 'Bury any number of cards; use Sting once per card',
  snap: '30 damage; 2/6 chance of 40 instead',
  hunt: '10 damage; bury any number for +30 each',
  icey_beak: '20 ice damage',
  chilling_screech: 'Freeze one target per friendly ice-damage monster',
  wizard_freeze: '20 ice damage + Frozen',
  chill: 'Add one turn to every Frozen monster',
  wizard_winter_winds: "Opponent skips their next energy phase",
  winters_talons: '30 ice damage; 3/6 chance of 40 instead',
  frostbite: "20 ice damage; Frozen duration equals this card's energy",
  frozen_sting: 'Roll: 10/20/20/30/30/20 ice; 6 also Freezes',
  lightning_needle: '20 electric; spend up to 3 extra energy for +20 each',
  haunting_cry: 'Your monsters with 2+ ice abilities gain 1 energy',
  freezing_mist: 'Freeze two distinct targets',
  frost_punch: '20 ice damage; 2/6 chance of 30 instead',
  glacier_frost_punch: '40 ice damage + Frozen',
  frost_breath: 'Freeze two distinct targets; opponent discards a card',
  golem_winter_winds: '20 damage + Frozen',
  spear: '20 damage; 3/6 chance of 30 instead',
  gleam: 'Heal one of your monsters 10. It is illuminated this turn.',
  flicker: '10 light damage',
  healing_light: 'Remove all statuses from a monster and heal it 20.',
  chorus: '20 light damage, plus 10 for each other monster you control',
  fire_sword: '40 fire damage + Burn',
  flurry_of_blows: 'Spend 1–3 energy: 30 damage per energy spent',
  knights_honour:
    'Until your next turn, fatal hits on your other monsters redirect here. Each redirect costs this card 1 energy.',
  lava_claw: '20 damage; 30 with an extra 0',
  magma_gush: '5/6: 40 fire damage + Burn',
  solar_flare: '20 light damage; spend 1 more for 30 instead',
  sunburn: '10 fire damage ×3, separately targeted; ×4 with an extra 0',
  zap: '20 electric damage; spend 1 more for 40 instead',
  storm: '10 piercing electric damage ×4, separately targeted',
  robotic_stab: '10 damage; 5/6 chance of 30 instead',
  plasma_cannon:
    'Roll any number of times (1–2 miss, 3–6 hit). Each hit is +20 electric. Two misses fail the attack.',
  phantom_bolt: '20 piercing electric damage',
  lingering_energy: 'The next ability you use treats + as 0 (energy stays attached).',
  sonic_blast: '60 sonic damage to any target',
  sound_wave: '20 sonic damage to up to three monsters',
  collect: 'Move any amount of energy from one of your other monsters to this card',
  supply: 'Move any amount of energy from this card to another of your monsters',
  crush: '50 damage',
  channel: 'Gain 1 energy for each other electric card you have in play',
  worm_storm: '70 electric damage ×3, separately targeted',
  acid_spew: '10 poison damage; 4/6 chance of 50 instead',
  gladin_sting: '10 poison damage and Poison for 5 turns',
  big_club: '40 damage',
  cyclops_laser: '30 light + Burn; 3/6 chance of 40 light + Burn instead',
  eye_flash: 'Burn for 2 turns, twice, separately targeted',
  burning_buck: '30 fire damage + Burn',
  stampede: '30 fire. Also 30 fire to one adjacent withdrawn card.',
  rocket: '40 blast to a target. 20 blast to every adjacent monster.',
  chaos_of_fireworks:
    'Rocket a random enemy three times. Costs one fewer + per other fire/blast attacker you control.',
  pilfer: '10 shadow damage. The opponent discards a card.',
  spy: "View the opponent's hand. You may mark a card; they must discard it next time they are forced to discard if they still have it.",
  black_blade: '30 shadow damage',
  grief_bolt: 'Destroy up to two cards in your discard. Your opponent discards that many cards.',
  bottle_toxins:
    'Deal 10 poison damage to two adjacent cards and Poison them for turns equal to the poison cards you have in play.',
  transmutation: 'Destroy a card in your hand and replace it with any card in your discard or deck.',
  imilithias_brew: "Change the target's weakness to any weakness.",
  great_axe: '20 damage. 4/6 chance of doubling that damage after bonuses, before defense.',
  dwarven_spirit: '20 damage, plus 10 for each Gold on this card.',
  miner_spirit: '20 damage, plus 10 for each Gold on this card.',
  smithwork: 'Gain a Gold.',
  miner_smithwork: 'Gain a Gold.',
  down_in_the_mines: 'Gain 1 gold.',
  goblin_scratch: '10 damage.',
  theft: 'Take an equipment from any active monster and attach it to this card.',
  loot_collect: 'Gain 1 gold.',
  dragon_talons: '40 damage.',
  scorch: '50 fire damage and Burn.',
  burning_breath: '60 fire damage and Burn to two adjacent cards.',
  iron_fists: '20 damage.',
  archers_of_the_keep:
    'Every monster that has damaged one of your cards this game takes 20 damage.',
  treasure_keepers:
    'Protect a card. While the protected card has gold, this card gains +1 defense.',
  poison_gas: '20 poison damage to two adjacent cards. 4/6 chance of Poison.',
  pixie_dust: '10 damage.',
  green_heal: 'Heal another monster 30 HP.',
  woody_spear: '20 damage. 2/6 chance of 30 instead.',
  ambush: 'Roll: 1–3 = 10, 4–6 = 40.',
  team_attack: 'Spear once for every Woody in play and every Woody in your hand. Each hit chooses its own target.',
  multiply: "Create a Lovni's Weed. If you have no empty slot, add one that leaves when that weed does.",
  scent: "20 poison damage, plus 10 for each other Lovni's Weed you have in play.",
  snap_trap: '30 damage.',
  triple_chomp: 'Roll: 1–3 = 30, 4–6 = 40. Twice at 70–120 HP, three times at 130+ HP. Each chomp rolls and targets separately.',
  thornbark_stick: '10 damage. 1/6 chance of 20 instead.',
  healing_hands: 'Heal any card 30 HP. Cannot heal a fire monster or the equipment on one.',
  growth: 'A plant you control gains 20 HP and 20 max HP.',
  vine_whip: '20 damage to a withdrawn card, then it advances. Does not spend your move.',
  thorn: '30 damage.',
  poisoned_spear: '20 poison damage and Poison.',
  burning_spear: '30 fire damage and Burn. 2/6 chance this card takes 20 damage.',
  stab: '20 damage.',
  downpour: '10 water damage and Wet to up to three different cards.',
  gale: '30 wind damage. You may force the target to withdraw.',
  storm_command: 'One of your electric, water, or wind cards may use one more ability this turn. It does not spend the team action.',
  bring_the_storm: '40 electric or water damage, plus 10 for each other Stormling you control.',
  legion_spear: '20 damage. 3/6 chance of 30 instead.',
  improvised_weapon: '40 damage. This card must have equipment.',
  relentless: 'This card may use one more ability this turn, without spending the team action. Until your next turn, a hit that would slay it leaves it at 10 HP.',
  attack: 'Take two more actions. Your attacks deal +10 damage this turn.',
  overdramatic_solo: 'Roll: 1 = 10 sonic, 2–5 = 20 sonic, 6 = 30 sonic.',
  attracting_melody: 'Draw two cards.',
  magic_music: '20 sonic damage, twice. Each hit chooses its own target.',
  serpents_fang: '20 poison damage and Poison for 1 turn.',
  tail_gale: '30 damage and withdraw the target.',
}

const EFFECT_TEXT: Record<string, string> = {
  heal_30: 'Heal 30 HP to any card.',
  energy_3: '+3 energy to any card.',
  damage_20_any: '20 damage to any card.',
  anvil: '4/6 chance of 40 damage to any card.',
  rally: 'Give two cards 1 energy each.',
  stormBolts:
    'Each enemy monster: 4/6 for 30 electric. Each friendly monster: 3/6 for 20 electric.',
  rainOfGoo: 'Play any number of Blob cards, or Goo three distinct monsters.',
  whirlpool: 'Bury any number of cards; deal 20 water damage per card.',
  churnWaters: 'Bury any number of cards, then draw that many.',
  blizzard: 'All players skip their next energy phase.',
  iceMirror:
    'Prevent the next damaging monster ability against one of your cards; recalculate its damage and status against the attacker.',
  quickMarch: 'Withdraw or advance any number of your cards.',
  starlightPortal: 'Play any number of cards from your hand.',
  command: 'Take an extra action this turn.',
  scrollWisdom: 'Draw 3 cards.',
  empower: 'Give one of your monsters 2 energy. It may take a free action this turn (still only one ability per card).',
  daybreak:
    'Deal 20 light damage to an enemy monster. If it is withdrawn and survives, it advances.',
  famine: 'Both you and your opponent discard a card of their choice.',
  treasureHoard: 'Gain 3 gold, or gain 1 gold and draw a card.',
  magicFertilizer: 'Each plant you control gains 1 energy.',
}

const EQUIPMENT_TEXT: Record<string, string> = {
  sword:
    "Attacks deal +10. If attached energy exceeds all energy used or required by the ability, +20 instead.",
  ruby_ring:
    'May take a free action each turn (does not spend the team action). Still only one ability per card.',
  shield: 'The attached monster has +1 defence.',
  energy_crystal: 'The attached monster gains +1 energy each energy phase.',
  spear:
    'Attacks deal +10. The attached card gains 0 Spear — 20 damage, 3/6 chance of 30 instead.',
  emerald_ring: 'The attached card heals 10 HP at the end of its owner’s turn (cannot exceed max HP).',
  fishing_rod:
    'When the attached card uses an ability, if it has spare energy (same rule as Sword), draw a card.',
  prism_lens:
    "The attached card's abilities have +1/6 chance to succeed and are illuminated.",
  colossusKeystone:
    'Cannot be destroyed. Only a Colossus can hold it. The attached card gains +1 energy each energy phase. Created by destroying 3 cards in your hand.',
}

/** Ember Tortoise Chomp differs from Snapatrap Chomp. */
export function abilityBody(defId: string, ability: AbilityDef): string {
  if (defId === 'ember_tortoise' && ability.id === 'chomp') {
    return '10 damage; 2/6 chance 20'
  }
  if (defId === 'big_blob' && ability.id === 'wakkle') {
    return '30 damage'
  }
  if (defId === 'gladin_tunneller' && ability.id === 'chomp') {
    return '40 damage'
  }
  if (defId === 'supply_construct' && ability.id === 'claw') {
    return '20 damage; 3/6 chance of 30 instead'
  }
  return ABILITY_TEXT[ability.id] ?? ''
}

export function abilityFlags(ability: AbilityDef): string {
  return [
    ability.free ? 'Free' : null,
    ability.ranged ? 'Ranged' : null,
    ability.repeats && ability.repeats > 1 ? `×${ability.repeats}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function cardSummary(defId: string): string {
  const card = getCard(defId)
  if (card.kind === 'monster') {
    const weaknesses = getWeaknesses(defId)
    const weak =
      weaknesses.length > 0
        ? ` · ${card.extremeWeakness ? 'extremely weak' : 'weak'} ${weaknesses.map(formatDamageType).join('/')}`
        : ''
    const def = card.defense ? ` · def ${card.defense}` : ''
    const charge = card.darkCharge ? ' · Dark Charge' : ''
    const gold = card.goldAffinity ? ' · Gold Affinity' : ''
    const families = [
      card.families?.includes('plant') ? 'Plant' : null,
      card.families?.includes('woody') ? 'Woody' : null,
      card.families?.includes('stormling') ? 'Stormling' : null,
    ].filter(Boolean)
    const family = families.length > 0 ? ` · ${families.join(' · ')}` : ''
    return `${card.points}pt · ${card.maxHp} HP${weak}${def}${family}${charge}${gold}`
  }
  if (card.kind === 'equipment') {
    return `Equipment · ${card.maxHp} HP`
  }
  return 'Effect'
}

export function cardBodyText(defId: string): string {
  const card = getCard(defId)
  if (card.kind === 'effect') return EFFECT_TEXT[card.effectId] ?? ''
  if (card.kind === 'equipment') return EQUIPMENT_TEXT[card.equipmentId] ?? ''
  return ''
}

export type AbilityLine = {
  id: string
  cost: EnergyCost
  name: string
  flags: string
  body: string
  upgradeCost?: EnergyCost
  upgradeText?: string
}

export function abilityLines(def: CardDef, extras: AbilityDef[] = []): AbilityLine[] {
  if (def.kind !== 'monster') return []
  return [...def.abilities, ...extras].map((a) => ({
    id: a.id,
    cost: a.cost,
    name: a.name,
    flags: abilityFlags(a),
    body: abilityBody(def.id, a),
    upgradeCost: a.upgradeCost,
    upgradeText: a.upgradeText,
  }))
}

export function cardAbilities(def: CardDef): string[] {
  return abilityLines(def).map((a) => {
    const flags = a.flags ? ` (${a.flags})` : ''
    return `${formatCost(a.cost)} ${a.name}${flags} — ${a.body}`
  })
}
