import { highFaces } from './dice'
import type {
  AbilityDef,
  AbilityEffect,
  CardDef,
  DamageType,
  FieldMonster,
  GameState,
  PlayerState,
  SummonElement,
} from './types'

/** One hit of these types. Sonic and blast are not elemental. */
export const ELEMENTAL_TYPES: Exclude<SummonElement, 'plant'>[] = [
  'fire',
  'water',
  'ice',
  'electric',
  'earth',
  'wind',
  'poison',
  'shadow',
  'light',
]

/** Elemental Summoner may also search for a plant. */
export const SUMMON_ELEMENTS: SummonElement[] = [...ELEMENTAL_TYPES, 'plant']

const REPLACEMENT_HOSTS: Record<string, string> = {
  big_blob: 'blob',
  big_red_blob: 'red_blob',
  big_blue_blob: 'blue_blob',
  big_yellow_blob: 'yellow_blob',
  big_black_blob: 'black_blob',
}

/** Small blob that must be replaced to play this card. */
export function replacementBlobHost(defId: string): string | null {
  return REPLACEMENT_HOSTS[defId] ?? null
}

/** Card created when this big blob is slain. */
export function deathSpawnDefId(defId: string): string | null {
  if (defId === 'big_blob') return 'blob'
  if (defId === 'big_red_blob') return 'red_blob'
  if (defId === 'big_blue_blob') return 'blue_blob'
  if (defId === 'big_yellow_blob') return 'yellow_blob'
  if (defId === 'big_black_blob') return 'black_blob'
  return null
}

/** Parse energy notation: 0 = require, + = spend. Total needed = require + spend. */
export function parseCost(dots: string): { require: number; spend: number } {
  let require = 0
  let spend = 0
  for (const ch of dots) {
    if (ch === '0') require++
    else if (ch === '+') spend++
  }
  return { require, spend }
}

export const CATALOG: Record<string, CardDef> = {
  blob: {
    kind: 'monster',
    id: 'blob',
    name: 'Blob',
    points: 1,
    maxHp: 50,
    weakness: 'water',
    abilities: [
      {
        id: 'wakkle',
        name: 'Wakkle',
        cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 20 }],
      },
      {
        id: 'splat',
        name: 'Splat',
        cost: parseCost('00'),
        effects: [{ type: 'status', status: 'goo', turns: 1 }],
      },
    ],
  },
  ice_core: {
    kind: 'monster',
    id: 'ice_core',
    name: 'Ice Core',
    points: 2,
    maxHp: 80,
    weakness: 'fire',
    abilities: [
      {
        id: 'shard',
        name: 'Shard',
        cost: parseCost('0'),
        ice: true,
        effects: [{ type: 'damage', amount: 20, damageType: 'ice' }],
      },
      {
        id: 'frozen_mist',
        name: 'Frozen Mist',
        cost: parseCost('++'),
        ice: true,
        effects: [
          { type: 'damage', amount: 10, damageType: 'ice' },
          { type: 'status', status: 'frozen', turns: 2 },
        ],
      },
    ],
  },
  snapatrap: {
    kind: 'monster',
    id: 'snapatrap',
    name: 'Snapatrap',
    points: 2,
    maxHp: 70,
    weakness: 'fire',
    families: ['plant'],
    abilities: [
      {
        id: 'chomp',
        name: 'Chomp',
        cost: parseCost('+'),
        effects: [
          {
            type: 'rollDamage',
            table: { 1: 30, 2: 30, 3: 30, 4: 40, 5: 40, 6: 40 },
          },
        ],
      },
      {
        id: 'regrow',
        name: 'Regrow',
        cost: parseCost('0'),
        free: true,
        effects: [{ type: 'healSelf', amount: 10 }],
      },
    ],
  },
  veyan_archer: {
    kind: 'monster',
    id: 'veyan_archer',
    name: 'Veyan Archer',
    points: 2,
    maxHp: 90,
    abilities: [
      {
        id: 'arrow_volley',
        name: 'Arrow Volley',
        cost: parseCost('0+'),
        ranged: true,
        effects: [{ type: 'damage', amount: 20 }],
      },
      {
        id: 'snipe',
        name: 'Snipe',
        cost: parseCost('0++'),
        ranged: true,
        effects: [{ type: 'damage', amount: 40 }],
      },
    ],
  },
  fire_sprite: {
    kind: 'monster',
    id: 'fire_sprite',
    name: 'Fire Sprite',
    points: 2,
    maxHp: 90,
    abilities: [
      {
        id: 'fire_punch',
        name: 'Fire Punch',
        cost: parseCost('+'),
        effects: [
          {
            type: 'choice',
            options: ['firePunchFull', 'firePunchBurn'],
          },
        ],
      },
      {
        id: 'overheat',
        name: 'Overheat',
        cost: parseCost('00'),
        special: 'overheat',
        effects: [],
      },
    ],
  },
  bomber_beetle: {
    kind: 'monster',
    id: 'bomber_beetle',
    name: 'Bomber Beetle',
    points: 2,
    maxHp: 70,
    weakness: 'fire',
    abilities: [
      {
        id: 'poke',
        name: 'Poke',
        cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 10 }],
      },
      {
        id: 'explode',
        name: 'Explode',
        cost: parseCost('000'),
        effects: [
          { type: 'damage', amount: 100, damageType: 'blast' },
          { type: 'removeSelf' },
        ],
      },
    ],
  },
  ember_tortoise: {
    kind: 'monster',
    id: 'ember_tortoise',
    name: 'Ember Tortoise',
    points: 2,
    maxHp: 80,
    weakness: 'ice',
    defense: 2,
    abilities: [
      {
        id: 'chomp',
        name: 'Chomp',
        cost: parseCost('+'),
        effects: [
          {
            type: 'chanceBoostDamage',
            base: 10,
            boosted: 20,
            successFaces: highFaces(2),
          },
        ],
      },
      {
        id: 'sizzling_shell',
        name: 'Sizzling Shell',
        cost: parseCost('00'),
        special: 'sizzlingShell',
        effects: [],
      },
    ],
  },
  water_lizel: {
    kind: 'monster', id: 'water_lizel', name: 'Water Lizel', points: 2, maxHp: 100,
    weakness: 'ice',
    abilities: [
      { id: 'claw', name: 'Claw', cost: parseCost('+'), special: 'waterClaw',
        upgradeCost: parseCost('0'), upgradeText: '30 damage', effects: [] },
      { id: 'water_gush', name: 'Water Gush', cost: parseCost('0'), special: 'waterGush', effects: [] },
    ],
  },
  goblin_magician: {
    kind: 'monster', id: 'goblin_magician', name: 'Goblin Magician', points: 2, maxHp: 80,
    families: ['goblin'],
    weakness: 'poison',
    abilities: [
      { id: 'magic_missile', name: 'Magic Missile', cost: parseCost('00'), ranged: true,
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'spark', name: 'Spark', cost: parseCost('+'), special: 'spark', effects: [] },
      { id: 'trickery', name: 'Trickery', cost: parseCost('00'), special: 'trickery', effects: [] },
    ],
  },
  wyvern: {
    kind: 'monster', id: 'wyvern', name: 'Wyvern', points: 3, maxHp: 120, weakness: 'ice',
    abilities: [
      { id: 'swoop_scratch', name: "Swoop 'n' Scratch", cost: parseCost('0+'),
        effects: [{ type: 'rollDamage', table: { 1: 0, 2: 0, 3: 30, 4: 30, 5: 50, 6: 50 }, damageType: 'poison' }] },
      { id: 'tail_sting', name: 'Tail Sting', cost: parseCost('000'),
        effects: [{ type: 'damage', amount: 20, damageType: 'poison' }, { type: 'status', status: 'poison', turns: 2 }] },
    ],
  },
  big_blob: {
    kind: 'monster', id: 'big_blob', name: 'Big Blob', points: 2, maxHp: 100,
    weakness: 'water', families: ['blob'],
    passiveText: 'If this card is slain, create and place two Blobs.',
    abilities: [
      { id: 'wakkle', name: 'Wakkle', cost: parseCost('0+'), effects: [{ type: 'damage', amount: 30 }] },
      { id: 'big_splat', name: 'Splat', cost: parseCost('00'), special: 'bigSplat', effects: [] },
    ],
  },
  red_blob: {
    kind: 'monster', id: 'red_blob', name: 'Red Blob', points: 2, maxHp: 70,
    weakness: 'water', families: ['blob'],
    abilities: [
      { id: 'red_wakkle', name: 'Red Wakkle', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 30, damageType: 'fire' }] },
      { id: 'burning_goo', name: 'Burning Goo', cost: parseCost('00'), special: 'burningGoo', effects: [] },
    ],
  },
  purple_blob: {
    kind: 'monster', id: 'purple_blob', name: 'Purple Blob', points: 2, maxHp: 70,
    weakness: 'water', families: ['blob'],
    abilities: [
      { id: 'wakkle', name: 'Wakkle', cost: parseCost('+'), effects: [{ type: 'damage', amount: 20 }] },
      { id: 'swarm', name: 'Swarm', cost: parseCost('00'), free: true, special: 'swarm', effects: [] },
    ],
  },
  rarkling: {
    kind: 'monster', id: 'rarkling', name: 'Rarkling', points: 2, maxHp: 100, weakness: 'ice',
    abilities: [
      { id: 'claw_rake', name: 'Claw Rake', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(3) }] },
      { id: 'cling', name: 'Cling', cost: parseCost('++'), special: 'cling', effects: [] },
    ],
  },
  leecher: {
    kind: 'monster', id: 'leecher', name: 'Leecher', points: 2, maxHp: 70,
    abilities: [
      { id: 'scratch', name: 'Scratch', cost: parseCost('0'), effects: [{ type: 'damage', amount: 20 }] },
      { id: 'vampiric_suck', name: 'Vampiric Suck', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 10, damageType: 'poison' }, { type: 'healSelf', amount: 10 }] },
    ],
  },
  rusted_construct: {
    kind: 'monster', id: 'rusted_construct', name: 'Rusted Construct', points: 2, maxHp: 90,
    weakness: 'water', defense: 1,
    idleEnergy: true,
    passiveText: 'Energy phase: if unused this turn, gain 1 energy.',
    abilities: [
      { id: 'rusty_claw', name: 'Rusty Claw', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 0, boosted: 30, successFaces: highFaces(4) }] },
      { id: 'plasma_volley', name: 'Plasma Volley', cost: parseCost('+++'), special: 'plasmaVolley', effects: [] },
    ],
  },
  yellow_fairy: {
    kind: 'monster', id: 'yellow_fairy', name: 'Yellow Fairy', points: 2, maxHp: 90,
    weakness: 'electric',
    passiveText: 'While in play, add 1 distributable energy each energy phase.',
    abilities: [
      { id: 'light_beam', name: 'Light Beam', cost: parseCost('00'),
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 20, successFaces: highFaces(3), damageType: 'light' }] },
      { id: 'heal', name: 'Heal', cost: parseCost('+'), ranged: true,
        targetMode: 'otherMonster', special: 'healOther', effects: [] },
    ],
  },
  gazit: {
    kind: 'monster', id: 'gazit', name: 'Gazit', points: 2, maxHp: 80, weakness: 'water',
    abilities: [
      { id: 'energize', name: 'Energize', cost: parseCost('0'), special: 'energize', effects: [] },
      { id: 'bolt', name: 'Bolt', cost: parseCost('+++'), effects: [{ type: 'damage', amount: 50, damageType: 'electric' }] },
    ],
  },
  horned: {
    kind: 'monster', id: 'horned', name: 'Horned', points: 2, maxHp: 90, weakness: 'electric',
    abilities: [
      { id: 'horn_stab', name: 'Horn Stab', cost: parseCost('0'),
        effects: [{ type: 'rollDamage', table: { 1: 0, 2: 10, 3: 20, 4: 20, 5: 20, 6: 30 } }] },
      { id: 'charge', name: 'CHARGE', cost: parseCost('+'), special: 'charge', effects: [] },
    ],
  },
  malvistra: {
    kind: 'monster', id: 'malvistra', name: 'Malvistra', points: 2, maxHp: 90, weakness: 'poison',
    abilities: [
      { id: 'transferal', name: 'Transferal', cost: parseCost('0'), targetMode: 'twoAnyMonsters', special: 'transferal', effects: [] },
      { id: 'discharge', name: 'Discharge', cost: parseCost('0'), special: 'discharge', effects: [] },
    ],
  },
  orc: {
    kind: 'monster', id: 'orc', name: 'Orc', points: 2, maxHp: 80, defense: 1,
    families: ['orc'],
    abilities: [
      { id: 'cruel_scimitar', name: 'Cruel Scimitar', cost: parseCost('0+'),
        effects: [{ type: 'chanceBoostDamage', base: 0, boosted: 40, successFaces: highFaces(5) }] },
      { id: 'poisoned_shaft', name: 'Poisoned Shaft', cost: parseCost('0+'), ranged: true,
        effects: [
          { type: 'damage', amount: 10, damageType: 'poison' },
          { type: 'status', status: 'poison', turns: 2 },
        ] },
      { id: 'blood_thirsty', name: 'Blood Thirsty', cost: parseCost('+'), free: true,
        effects: [{ type: 'damage', amount: 10 }] },
    ],
  },
  fisher_mirel: {
    kind: 'monster', id: 'fisher_mirel', name: 'Fisher Mirel', points: 2, maxHp: 80,
    abilities: [
      { id: 'fish', name: 'Fish', cost: parseCost('00'), free: true,
        special: 'drawOne', effects: [] },
      { id: 'mudball', name: 'Mudball', cost: parseCost('+'),
        special: 'mudball', effects: [] },
    ],
  },
  drowned_pirate: {
    kind: 'monster', id: 'drowned_pirate', name: 'Drowned Pirate', points: 2, maxHp: 80,
    weakness: 'light', goldAffinity: true, families: ['pirate'],
    abilities: [
      { id: 'rusty_cutlass', name: 'Rusty Cutlass', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 0, boosted: 30, successFaces: highFaces(4) }] },
      { id: 'lost_treasure', name: 'Lost Treasure', cost: parseCost('000'), ranged: true,
        special: 'lostTreasure', effects: [] },
      { id: 'sunken_plunder', name: 'Sunken Plunder', cost: parseCost('0++'), ranged: true,
        special: 'sunkenPlunder', effects: [] },
    ],
  },
  hydro_core: {
    kind: 'monster', id: 'hydro_core', name: 'Hydro Core', points: 2, maxHp: 80,
    weakness: 'ice',
    abilities: [
      { id: 'splash', name: 'Splash', cost: parseCost('0'),
        effects: [
          { type: 'damage', amount: 10, damageType: 'water' },
          { type: 'status', status: 'wet', turns: 3 },
        ] },
      { id: 'water_jet', name: 'Water Jet', cost: parseCost('++'),
        special: 'waterJet', effects: [] },
      { id: 'treasures_waves', name: 'Treasures from the Waves', cost: parseCost('0'),
        ranged: true, special: 'drawOne', effects: [] },
    ],
  },
  navit_gel: {
    kind: 'monster', id: 'navit_gel', name: 'Navit Gel', points: 2, maxHp: 80,
    weakness: 'fire',
    abilities: [
      { id: 'sting', name: 'Sting', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageType: 'poison' }] },
      { id: 'tentacle_attack', name: 'Tentacle Attack', cost: parseCost('+++'),
        special: 'tentacleAttack', effects: [] },
      { id: 'absorb', name: 'Absorb', cost: parseCost('0'),
        special: 'absorb', effects: [] },
    ],
  },
  blubis_eel: {
    kind: 'monster', id: 'blubis_eel', name: 'Blubis Eel', points: 4, maxHp: 160,
    weakness: 'ice',
    abilities: [
      { id: 'snap', name: 'Snap', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 30, boosted: 40, successFaces: highFaces(2) }] },
      { id: 'hunt', name: 'Hunt', cost: parseCost('0+'),
        special: 'hunt', effects: [] },
    ],
  },
  frost_hawk: {
    kind: 'monster', id: 'frost_hawk', name: 'Frost Hawk', points: 2, maxHp: 80,
    weaknesses: ['fire', 'electric'],
    abilities: [
      { id: 'icey_beak', name: 'Icey Beak', cost: parseCost('+'), ice: true,
        special: 'iceyBeak', upgradeCost: parseCost('0'), upgradeText: '30 ice damage',
        effects: [] },
      { id: 'chilling_screech', name: 'Chilling Screech', cost: parseCost('00'), ice: true,
        special: 'chillingScreech', effects: [] },
    ],
  },
  winter_wizard: {
    kind: 'monster', id: 'winter_wizard', name: 'Winter Wizard', points: 2, maxHp: 90,
    weakness: 'light',
    abilities: [
      { id: 'wizard_freeze', name: 'Freeze', cost: parseCost('+'), ice: true,
        effects: [
          { type: 'damage', amount: 20, damageType: 'ice' },
          { type: 'status', status: 'frozen', turns: 2 },
        ] },
      { id: 'chill', name: 'Chill', cost: parseCost('00'), ice: true,
        special: 'chill', effects: [] },
      { id: 'wizard_winter_winds', name: 'Winter Winds', cost: parseCost('++'),
        special: 'skipOpponentEnergy', effects: [] },
    ],
  },
  two_tailed_frost_biter: {
    kind: 'monster', id: 'two_tailed_frost_biter', name: 'Two-Tailed Frost Biter',
    points: 3, maxHp: 120, weakness: 'fire',
    abilities: [
      { id: 'winters_talons', name: "Winter's Talons", cost: parseCost('+'), ice: true,
        effects: [{ type: 'chanceBoostDamage', base: 30, boosted: 40,
          successFaces: highFaces(3), damageType: 'ice' }] },
      { id: 'frostbite', name: 'Frostbite', cost: parseCost('00'), ice: true,
        special: 'frostbite', effects: [] },
    ],
  },
  aquatic_lightning: {
    kind: 'monster', id: 'aquatic_lightning', name: 'Aquatic Lightning',
    points: 2, maxHp: 80, weakness: 'fire',
    abilities: [
      { id: 'frozen_sting', name: 'Frozen Sting', cost: parseCost('0'), ice: true,
        special: 'frozenSting', effects: [] },
      { id: 'lightning_needle', name: 'Lightning Needle', cost: parseCost('+'),
        special: 'lightningNeedle', effects: [] },
      { id: 'haunting_cry', name: 'Haunting Cry', cost: parseCost('0'),
        special: 'hauntingCry', effects: [] },
    ],
  },
  chill_sprite: {
    kind: 'monster', id: 'chill_sprite', name: 'Chill Sprite',
    points: 2, maxHp: 90, weakness: 'fire',
    abilities: [
      { id: 'freezing_mist', name: 'Freezing Mist', cost: parseCost('0'), ice: true,
        special: 'freezeTwo', effects: [] },
      { id: 'frost_punch', name: 'Frost Punch', cost: parseCost('0'), ice: true,
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30,
          successFaces: highFaces(2), damageType: 'ice' }] },
      { id: 'chill', name: 'Chill', cost: parseCost('00'), ice: true,
        special: 'chill', effects: [] },
    ],
  },
  lantern_wisp: {
    kind: 'monster', id: 'lantern_wisp', name: 'Lantern Wisp', points: 1, maxHp: 50,
    weakness: 'wind', families: ['light'],
    abilities: [
      { id: 'searing_light', name: 'Searing Light', cost: parseCost('+'), light: true,
        special: 'searingLight', effects: [] },
      { id: 'gleam', name: 'Gleam', cost: parseCost('0'), free: true, ranged: true, light: true,
        special: 'gleam', effects: [] },
    ],
  },
  dawn_acolyte: {
    kind: 'monster', id: 'dawn_acolyte', name: 'Dawn Acolyte', points: 2, maxHp: 70,
    weakness: 'ice', families: ['light'],
    abilities: [
      { id: 'healing_light', name: 'Healing Light', cost: parseCost('0'), ranged: true, light: true,
        special: 'healingLight', effects: [] },
      { id: 'chorus', name: 'Chorus', cost: parseCost('00'), ranged: true, light: true,
        special: 'chorus', effects: [] },
    ],
  },
  glacier_golem: {
    kind: 'monster', id: 'glacier_golem', name: 'Glacier Golem',
    points: 4, maxHp: 170, weaknesses: ['fire', 'blast'],
    abilities: [
      { id: 'glacier_frost_punch', name: 'Frost Punch', cost: parseCost('0+'), ice: true,
        effects: [
          { type: 'damage', amount: 40, damageType: 'ice' },
          { type: 'status', status: 'frozen', turns: 2 },
        ] },
      { id: 'frost_breath', name: 'Frost Breath', cost: parseCost('00'), ice: true,
        special: 'frostBreath', effects: [] },
      { id: 'golem_winter_winds', name: 'Winter Winds', cost: parseCost('00+'),
        ranged: true, ice: true,
        effects: [
          { type: 'damage', amount: 20 },
          { type: 'status', status: 'frozen', turns: 2 },
        ] },
    ],
  },
  red_knight: {
    kind: 'monster', id: 'red_knight', name: 'Red Knight', points: 4, maxHp: 120, defense: 1,
    goldAffinity: true,
    abilities: [
      { id: 'fire_sword', name: 'Fire Sword', cost: parseCost('0+'),
        effects: [
          { type: 'damage', amount: 40, damageType: 'fire' },
          { type: 'status', status: 'burn', turns: 2 },
        ] },
      { id: 'flurry_of_blows', name: 'Flurry of Blows', cost: parseCost('0'),
        special: 'flurryOfBlows', effects: [] },
      { id: 'knights_honour', name: "Knight's Honour", cost: parseCost('00'),
        special: 'knightsHonour', effects: [] },
    ],
  },
  lava_lizels: {
    kind: 'monster', id: 'lava_lizels', name: 'Lava Lizels', points: 2, maxHp: 100,
    weakness: 'water',
    abilities: [
      { id: 'lava_claw', name: 'Claw', cost: parseCost('+'), special: 'lavaClaw',
        upgradeCost: parseCost('0'), upgradeText: '30 damage', effects: [] },
      { id: 'magma_gush', name: 'Magma Gush', cost: parseCost('00'), special: 'magmaGush',
        effects: [] },
    ],
  },
  sun_sprite: {
    kind: 'monster', id: 'sun_sprite', name: 'Sun Sprite', points: 2, maxHp: 90,
    weakness: 'water',
    abilities: [
      { id: 'solar_flare', name: 'Solar Flare', cost: parseCost('0'), special: 'solarFlare',
        upgradeCost: parseCost('+'), upgradeText: '30 light damage', effects: [] },
      { id: 'sunburn', name: 'Sunburn', cost: parseCost('+'), special: 'sunburn',
        upgradeCost: parseCost('0'), upgradeText: '10 fire ×4', effects: [] },
    ],
  },
  red_cyclops: {
    kind: 'monster', id: 'red_cyclops', name: 'Red Cyclops', points: 3, maxHp: 120,
    weakness: 'water',
    abilities: [
      { id: 'big_club', name: 'Big Club', cost: parseCost('00'),
        effects: [{ type: 'damage', amount: 40 }] },
      { id: 'cyclops_laser', name: "Cyclops' Laser", cost: parseCost('0++'),
        effects: [
          { type: 'chanceBoostDamage', base: 30, boosted: 40, successFaces: highFaces(3), damageType: 'light' },
          { type: 'status', status: 'burn', turns: 2 },
        ] },
      { id: 'eye_flash', name: 'Eye Flash', cost: parseCost('000'), special: 'eyeFlash',
        effects: [] },
    ],
  },
  blazing_stallion: {
    kind: 'monster', id: 'blazing_stallion', name: 'Blazing Stallion', points: 2, maxHp: 80,
    weakness: 'water',
    abilities: [
      { id: 'burning_buck', name: 'Burning Buck', cost: parseCost('+'),
        effects: [
          { type: 'damage', amount: 30, damageType: 'fire' },
          { type: 'status', status: 'burn', turns: 2 },
        ] },
      { id: 'stampede', name: 'Stampede', cost: parseCost('++'), special: 'stampede',
        effects: [] },
    ],
  },
  rocketeer: {
    kind: 'monster', id: 'rocketeer', name: 'Rocketeer', points: 2, maxHp: 80,
    weakness: 'poison',
    abilities: [
      { id: 'rocket', name: 'Rocket', cost: parseCost('0++'), special: 'rocket',
        effects: [] },
      { id: 'chaos_of_fireworks', name: 'Chaos of Fireworks', cost: parseCost('++++++'),
        special: 'chaosFireworks',
        upgradeText: '−1 + per other fire/blast attacker you control',
        effects: [] },
    ],
  },
  dwarven_warrior: {
    kind: 'monster', id: 'dwarven_warrior', name: 'Dwarven Warrior', points: 2, maxHp: 80,
    defense: 1, goldAffinity: true,
    abilities: [
      { id: 'great_axe', name: 'Great Axe', cost: parseCost('++'), special: 'greatAxe', effects: [] },
      { id: 'dwarven_spirit', name: 'Dwarven Spirit', cost: parseCost('00'), special: 'dwarvenSpirit',
        effects: [] },
      { id: 'smithwork', name: 'Smithwork', cost: parseCost('0'), ranged: true, special: 'gainGold',
        effects: [] },
    ],
  },
  dwarven_miner: {
    kind: 'monster', id: 'dwarven_miner', name: 'Dwarven Miner', points: 2, maxHp: 80,
    defense: 1, goldAffinity: true,
    abilities: [
      { id: 'miner_smithwork', name: 'Smithwork', cost: parseCost('0'), special: 'gainGold',
        effects: [] },
      { id: 'down_in_the_mines', name: 'Down in the Mines', cost: parseCost('000'),
        free: true, ranged: true, special: 'gainGold', effects: [] },
      { id: 'miner_spirit', name: 'Dwarven Spirit', cost: parseCost('00'), special: 'dwarvenSpirit',
        effects: [] },
    ],
  },
  loot_goblin: {
    kind: 'monster', id: 'loot_goblin', name: 'Loot Goblin', points: 2, maxHp: 90,
    weakness: 'poison', goldAffinity: true, families: ['goblin'],
    passiveText: 'When this card deals damage, it deals +10 for each Gold or Equipment attached to it.',
    abilities: [
      { id: 'goblin_scratch', name: 'Scratch', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 10 }] },
      { id: 'theft', name: 'Theft', cost: parseCost('+++'), special: 'theft', effects: [] },
      { id: 'loot_collect', name: 'Collect', cost: parseCost('0'), special: 'gainGold', effects: [] },
    ],
  },
  fire_dragon: {
    kind: 'monster', id: 'fire_dragon', name: 'Fire Dragon', points: 6, maxHp: 250,
    weakness: 'water', goldAffinity: true,
    abilities: [
      { id: 'dragon_talons', name: 'Dragon Talons', cost: parseCost('0+'), special: 'dragonTalons',
        upgradeCost: parseCost('0'), upgradeText: '60 damage', effects: [] },
      { id: 'scorch', name: 'Scorch', cost: parseCost('00+'),
        effects: [
          { type: 'damage', amount: 50, damageType: 'fire' },
          { type: 'status', status: 'burn', turns: 3 },
        ] },
      { id: 'burning_breath', name: 'Burning Breath', cost: parseCost('00++'),
        special: 'burningBreath', effects: [] },
    ],
  },
  amanesian_warden: {
    kind: 'monster', id: 'amanesian_warden', name: 'Amanesian Warden', points: 2, maxHp: 100,
    goldAffinity: true,
    passiveText: 'This card deals +10 damage per gold it has.',
    abilities: [
      { id: 'iron_fists', name: 'Iron Fists', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'archers_of_the_keep', name: 'Archers of the Keep', cost: parseCost('0++'),
        ranged: true, special: 'archersKeep', effects: [] },
      { id: 'treasure_keepers', name: 'Treasure Keepers', cost: parseCost('0'),
        special: 'treasureKeepers', effects: [] },
    ],
  },
  treasure_hoard: {
    kind: 'effect', id: 'treasure_hoard', name: 'Treasure Hoard', effectId: 'treasureHoard',
  },
  toxi_trap: {
    kind: 'monster', id: 'toxi_trap', name: 'Toxi-trap', points: 2, maxHp: 70,
    weakness: 'fire', families: ['plant'],
    abilities: [
      { id: 'chomp', name: 'Chomp', cost: parseCost('+'),
        effects: [{ type: 'rollDamage', table: { 1: 30, 2: 30, 3: 30, 4: 40, 5: 40, 6: 40 } }] },
      { id: 'poison_gas', name: 'Poison Gas', cost: parseCost('0'), special: 'poisonGas', effects: [] },
      { id: 'regrow', name: 'Regrow', cost: parseCost('0'), free: true,
        effects: [{ type: 'healSelf', amount: 10 }] },
    ],
  },
  green_fairy: {
    kind: 'monster', id: 'green_fairy', name: 'Green Fairy', points: 2, maxHp: 90,
    weakness: 'electric',
    passiveText: 'At the end of your turn, choose a card to heal 10 HP.',
    abilities: [
      { id: 'pixie_dust', name: 'Pixie Dust', cost: parseCost(''),
        effects: [{ type: 'damage', amount: 10 }] },
      { id: 'green_heal', name: 'Heal', cost: parseCost('+'), ranged: true,
        targetMode: 'otherMonster', special: 'greenHeal', effects: [] },
    ],
  },
  woody: {
    kind: 'monster', id: 'woody', name: 'Woody', points: 2, maxHp: 80,
    weakness: 'fire', families: ['plant', 'woody'],
    abilities: [
      { id: 'woody_spear', name: 'Spear', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(2) }] },
      { id: 'ambush', name: 'Ambush', cost: parseCost('++'),
        effects: [{ type: 'rollDamage', table: { 1: 10, 2: 10, 3: 10, 4: 40, 5: 40, 6: 40 } }] },
      { id: 'team_attack', name: 'Team Attack', cost: parseCost('00'), special: 'teamAttack', effects: [] },
    ],
  },
  lovnis_weed: {
    kind: 'monster', id: 'lovnis_weed', name: "Lovni's Weed", points: 1, maxHp: 60,
    weakness: 'fire', extremeWeakness: true, families: ['plant'],
    abilities: [
      { id: 'multiply', name: 'Multiply', cost: parseCost('+'), free: true, special: 'multiply', effects: [] },
      { id: 'scent', name: 'Scent of a Thousand Weeds', cost: parseCost('00'), special: 'scent', effects: [] },
    ],
  },
  magic_fertilizer: {
    kind: 'effect', id: 'magic_fertilizer', name: 'Magic Fertilizer', effectId: 'magicFertilizer',
  },
  triple_snapatrap: {
    kind: 'monster', id: 'triple_snapatrap', name: 'Triple-Headed Snapatrap', points: 4, maxHp: 180,
    weakness: 'fire', families: ['plant'],
    abilities: [
      { id: 'snap_trap', name: 'Snap & Trap', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 30 }] },
      { id: 'triple_chomp', name: 'Triple Chomp', cost: parseCost('+00'), special: 'tripleChomp', effects: [] },
      { id: 'regrow', name: 'Regrow', cost: parseCost('0'), free: true,
        effects: [{ type: 'healSelf', amount: 10 }] },
    ],
  },
  ecoling: {
    kind: 'monster', id: 'ecoling', name: 'Ecoling', points: 2, maxHp: 80,
    weakness: 'fire', extremeWeakness: true, families: ['plant'],
    abilities: [
      { id: 'thornbark_stick', name: 'Thornbark Stick', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 20, successFaces: highFaces(1) }] },
      { id: 'healing_hands', name: 'Healing Hands', cost: parseCost('++'), ranged: true,
        special: 'healingHands', effects: [] },
      { id: 'growth', name: 'Growth', cost: parseCost('000'), special: 'growth', effects: [] },
    ],
  },
  vineshon: {
    kind: 'monster', id: 'vineshon', name: 'Vineshon', points: 1, maxHp: 60,
    weakness: 'fire', extremeWeakness: true, families: ['plant'],
    abilities: [
      { id: 'vine_whip', name: 'Vine Whip', cost: parseCost('+'), special: 'vineWhip', effects: [] },
      { id: 'thorn', name: 'Thorn', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 30 }] },
    ],
  },
  withered_woody: {
    kind: 'monster', id: 'withered_woody', name: 'Withered Woody', points: 2, maxHp: 80,
    weakness: 'fire', extremeWeakness: true, families: ['plant', 'woody'],
    abilities: [
      { id: 'poisoned_spear', name: 'Poisoned Spear', cost: parseCost('+'),
        effects: [
          { type: 'damage', amount: 20, damageType: 'poison' },
          { type: 'status', status: 'poison', turns: 2 },
        ] },
      { id: 'burning_spear', name: 'Burning Spear', cost: parseCost('+'), special: 'burningSpear', effects: [] },
      { id: 'ambush', name: 'Ambush', cost: parseCost('++'),
        effects: [{ type: 'rollDamage', table: { 1: 10, 2: 10, 3: 10, 4: 40, 5: 40, 6: 40 } }] },
    ],
  },
  stormling: {
    kind: 'monster', id: 'stormling', name: 'Stormling', points: 3, maxHp: 140,
    weakness: 'light', families: ['stormling'],
    abilities: [
      { id: 'stab', name: 'Stab', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'bolt', name: 'Bolt', cost: parseCost('+++'),
        effects: [{ type: 'damage', amount: 50, damageType: 'electric' }] },
      { id: 'downpour', name: 'Downpour', cost: parseCost('00'), special: 'downpour', effects: [] },
      { id: 'gale', name: 'Gale', cost: parseCost('0+'), special: 'gale', effects: [] },
    ],
  },
  stormling_commander: {
    kind: 'monster', id: 'stormling_commander', name: 'Stormling Commander', points: 4, maxHp: 150,
    families: ['stormling'],
    abilities: [
      { id: 'stab', name: 'Stab', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'bolt', name: 'Bolt', cost: parseCost('+++'),
        effects: [{ type: 'damage', amount: 50, damageType: 'electric' }] },
      { id: 'storm_command', name: 'Command', cost: parseCost('+'), free: true, special: 'stormCommand', effects: [] },
      { id: 'bring_the_storm', name: 'Bring the STORM', cost: parseCost('++'), special: 'bringTheStorm', effects: [] },
    ],
  },
  unending_legionary: {
    kind: 'monster', id: 'unending_legionary', name: 'Unending Legionary', points: 2, maxHp: 80,
    weakness: 'electric', families: ['unending_legion'],
    abilities: [
      { id: 'legion_spear', name: 'Spear', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(3) }] },
      { id: 'improvised_weapon', name: 'Improvised Weapon', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 40 }] },
      { id: 'relentless', name: 'Relentless', cost: parseCost('++'), free: true, special: 'relentless', effects: [] },
    ],
  },
  unending_bannerman: {
    kind: 'monster', id: 'unending_bannerman', name: 'Bannerman of the Unending Legion', points: 2, maxHp: 80,
    weakness: 'electric', families: ['unending_legion'],
    passiveText: 'During your energy phase, you may give 1 energy to a monster you control worth 2 points or less.',
    abilities: [
      { id: 'legion_spear', name: 'Spear', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(3) }] },
      { id: 'attack', name: 'ATTACK!', cost: parseCost('++++'), special: 'attack', effects: [] },
    ],
  },
  veyan_bard: {
    kind: 'monster', id: 'veyan_bard', name: 'Veyan Bard', points: 2, maxHp: 90,
    abilities: [
      { id: 'overdramatic_solo', name: 'Over-dramatic Solo', cost: parseCost('0'),
        effects: [{ type: 'rollDamage', table: { 1: 10, 2: 20, 3: 20, 4: 20, 5: 20, 6: 30 }, damageType: 'sonic' }] },
      { id: 'attracting_melody', name: 'Attracting Melody', cost: parseCost('00'), special: 'drawTwo', effects: [] },
      { id: 'magic_music', name: 'Magic Music', cost: parseCost('0+'), special: 'magicMusic', effects: [] },
    ],
  },
  gale_serpent: {
    kind: 'monster', id: 'gale_serpent', name: 'Gale Serpent', points: 2, maxHp: 90,
    weakness: 'ice',
    abilities: [
      { id: 'serpents_fang', name: "Serpent's Fang", cost: parseCost('0'),
        effects: [
          { type: 'damage', amount: 20, damageType: 'poison' },
          { type: 'status', status: 'poison', turns: 1 },
        ] },
      { id: 'tail_gale', name: 'Tail Gale', cost: parseCost('++'), special: 'tailGale', effects: [] },
    ],
  },
  boneling: {
    kind: 'monster', id: 'boneling', name: 'Boneling', points: 0, maxHp: 30,
    darkCharge: true,
    passiveText:
      'While you control a Boneling, your opponent can only target your Bonelings (ranged and any-card attacks ignore this). A Boneling cannot withdraw; if it would, it is slain instead.',
    abilities: [
      { id: 'hollow_scratch', name: 'Hollow Scratch', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageType: 'shadow' }] },
    ],
  },
  keeper_of_the_catacombs: {
    kind: 'monster', id: 'keeper_of_the_catacombs', name: 'Keeper of the Catacombs', points: 2, maxHp: 100,
    darkCharge: true,
    abilities: [
      { id: 'bring_forth_the_dead', name: 'Bring Forth the Dead', cost: parseCost('0'),
        special: 'bringForthTheDead', effects: [] },
    ],
  },
  skeleton_mage: {
    kind: 'monster', id: 'skeleton_mage', name: 'Skeleton Mage', points: 3, maxHp: 100,
    darkCharge: true,
    abilities: [
      { id: 'anti_heal', name: 'Anti-heal', cost: parseCost('+'), ranged: true,
        effects: [{ type: 'damage', amount: 30, damageType: 'shadow', piercing: true }] },
      { id: 'summon_bonelings', name: 'Summon Bonelings', cost: parseCost('+++'),
        special: 'summonBonelings', effects: [] },
      { id: 'cloud_of_darkness', name: 'Cloud of Darkness', cost: parseCost('0'),
        special: 'cloudOfDarkness', effects: [] },
    ],
  },
  health_potion: {
    kind: 'effect',
    id: 'health_potion',
    name: 'Health Potion',
    effectId: 'heal_30',
  },
  coffee: {
    kind: 'effect',
    id: 'coffee',
    name: 'Coffee',
    effectId: 'energy_3',
  },
  long_range_archer: {
    kind: 'effect',
    id: 'long_range_archer',
    name: 'Long Range Archer',
    effectId: 'damage_20_any',
  },
  falling_anvil: {
    kind: 'effect',
    id: 'falling_anvil',
    name: 'Falling Anvil',
    effectId: 'anvil',
  },
  rally: {
    kind: 'effect',
    id: 'rally',
    name: 'Rally',
    effectId: 'rally',
  },
  storm_bolts: {
    kind: 'effect', id: 'storm_bolts', name: 'Storm of a Thousand Bolts', effectId: 'stormBolts',
  },
  rain_of_goo: {
    kind: 'effect', id: 'rain_of_goo', name: 'Rain of Goo', effectId: 'rainOfGoo',
  },
  whirlpool: {
    kind: 'effect', id: 'whirlpool', name: 'Whirlpool', effectId: 'whirlpool',
  },
  churn_waters: {
    kind: 'effect', id: 'churn_waters', name: 'Churn the Waters', effectId: 'churnWaters',
  },
  blizzard: {
    kind: 'effect', id: 'blizzard', name: 'Blizzard', effectId: 'blizzard',
  },
  ice_mirror: {
    kind: 'effect', id: 'ice_mirror', name: 'Ice Mirror', effectId: 'iceMirror',
  },
  quick_march: {
    kind: 'effect', id: 'quick_march', name: 'Quick… March!', effectId: 'quickMarch',
  },
  starlight_portal: {
    kind: 'effect', id: 'starlight_portal', name: 'Starlight Portal', effectId: 'starlightPortal',
  },
  command: {
    kind: 'effect', id: 'command', name: 'Command', effectId: 'command',
  },
  scroll_wisdom: {
    kind: 'effect', id: 'scroll_wisdom', name: 'Scroll of Wisdom', effectId: 'scrollWisdom',
  },
  empower: {
    kind: 'effect', id: 'empower', name: 'Empower', effectId: 'empower',
  },
  daybreak: {
    kind: 'effect', id: 'daybreak', name: 'Daybreak', effectId: 'daybreak',
  },
  famine: {
    kind: 'effect', id: 'famine', name: 'Famine', effectId: 'famine',
  },
  darklight_portal: {
    kind: 'effect', id: 'darklight_portal', name: 'Darklight Portal', effectId: 'darklightPortal',
  },
  runestone_fires: {
    kind: 'effect', id: 'runestone_fires', name: 'Runestone Fires', effectId: 'runestoneFires',
  },
  eye_of_the_rift: {
    kind: 'effect', id: 'eye_of_the_rift', name: "Eye o' the Rift", effectId: 'eyeOfTheRift',
  },
  the_golden_die: {
    kind: 'effect', id: 'the_golden_die', name: 'The Golden Die', effectId: 'goldenDie',
  },
  time_warp: {
    kind: 'effect', id: 'time_warp', name: 'Time Warp', effectId: 'timeWarp',
  },
  inversion: {
    kind: 'effect', id: 'inversion', name: 'Inversion', effectId: 'inversion',
  },
  recursion: {
    kind: 'effect', id: 'recursion', name: 'Recursion', effectId: 'recursion',
  },
  mirror_pact: {
    kind: 'effect', id: 'mirror_pact', name: 'Mirror Pact', effectId: 'mirrorPact',
  },
  rewind: {
    kind: 'effect', id: 'rewind', name: 'Rewind', effectId: 'rewind',
  },
  shapeshifter: {
    kind: 'monster', id: 'shapeshifter', name: 'Shapeshifter', points: 3, maxHp: 110,
    abilities: [
      { id: 'shapeshift', name: 'Shapeshift', cost: parseCost('+'), special: 'shapeshift', effects: [] },
    ],
  },
  thunder_core: {
    kind: 'monster', id: 'thunder_core', name: 'Thunder Core', points: 2, maxHp: 80,
    weakness: 'wind',
    abilities: [
      { id: 'zap', name: 'Zap', cost: parseCost('0'), special: 'zap',
        upgradeCost: parseCost('+'), upgradeText: '40 electric damage', effects: [] },
      { id: 'storm', name: 'Storm', cost: parseCost('++'), special: 'storm',
        effects: [] },
    ],
  },
  construct: {
    kind: 'monster', id: 'construct', name: 'Construct', points: 2, maxHp: 100,
    weakness: 'water', defense: 1, idleEnergy: true,
    passiveText: 'Energy phase: if unused this turn, gain 1 energy.',
    abilities: [
      { id: 'robotic_stab', name: 'Robotic Stab', cost: parseCost('00'),
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 30, successFaces: highFaces(5) }] },
      { id: 'plasma_cannon', name: 'Plasma Cannon', cost: parseCost('++++'),
        special: 'plasmaCannon', effects: [] },
    ],
  },
  tempest_wraith: {
    kind: 'monster', id: 'tempest_wraith', name: 'Tempest Wraith', points: 2, maxHp: 70,
    weakness: 'light', darkCharge: true,
    abilities: [
      { id: 'phantom_bolt', name: 'Phantom Bolt', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 20, damageType: 'electric', piercing: true }] },
      { id: 'lingering_energy', name: 'Lingering Energy', cost: parseCost('++'),
        special: 'lingeringEnergy', effects: [] },
    ],
  },
  deci_construct: {
    kind: 'monster', id: 'deci_construct', name: 'Deci-construct', points: 2, maxHp: 100,
    weakness: 'water', idleEnergy: true,
    passiveText: 'Energy phase: if unused this turn, gain 1 energy.',
    abilities: [
      { id: 'sonic_blast', name: 'Sonic Blast', cost: parseCost('0+++'),
        targetMode: 'anyMonster',
        effects: [{ type: 'damage', amount: 60, damageType: 'sonic' }] },
      { id: 'sound_wave', name: 'Sonic Wave', cost: parseCost('00++'),
        special: 'soundWave', effects: [] },
    ],
  },
  supply_construct: {
    kind: 'monster', id: 'supply_construct', name: 'Supply Construct', points: 2, maxHp: 90,
    weakness: 'water', defense: 1, idleEnergy: true,
    passiveText: 'Energy phase: if unused this turn, gain 1 energy.',
    abilities: [
      { id: 'claw', name: 'Claw', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(3) }] },
      { id: 'collect', name: 'Collect', cost: parseCost(''), free: true,
        special: 'collect', targetMode: 'otherMonster', effects: [] },
      { id: 'supply', name: 'Supply', cost: parseCost('0'), free: true,
        special: 'supply', targetMode: 'otherMonster', effects: [] },
    ],
  },
  lightning_worm: {
    kind: 'monster', id: 'lightning_worm', name: 'Lightning Worm', points: 4, maxHp: 170,
    weakness: 'poison',
    passiveText: 'When this card is attacked with an electric attack, it gains 1 energy.',
    abilities: [
      { id: 'crush', name: 'Crush', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 50 }] },
      { id: 'channel', name: 'Channel', cost: parseCost('+'),
        special: 'channel', effects: [] },
      { id: 'worm_storm', name: 'Worm Storm', cost: parseCost('++++++++'),
        special: 'wormStorm', effects: [] },
    ],
  },
  gladin_tunneller: {
    kind: 'monster', id: 'gladin_tunneller', name: 'Gladin Tunneller', points: 4, maxHp: 170,
    weakness: 'water',
    abilities: [
      { id: 'chomp', name: 'Chomp', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 40 }] },
      { id: 'acid_spew', name: 'Acid Spew', cost: parseCost('00'),
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 50, successFaces: highFaces(4), damageType: 'poison' }] },
      { id: 'gladin_sting', name: 'Gladin Sting', cost: parseCost('0+'),
        effects: [
          { type: 'damage', amount: 10, damageType: 'poison' },
          { type: 'status', status: 'poison', turns: 5 },
        ] },
    ],
  },
  shadow_imp: {
    kind: 'monster', id: 'shadow_imp', name: 'Shadow Imp', points: 1, maxHp: 50,
    weakness: 'light', darkCharge: true,
    abilities: [
      { id: 'pilfer', name: 'Pilfer', cost: parseCost('0+'), special: 'pilfer',
        effects: [] },
      { id: 'spy', name: 'Spy', cost: parseCost('00'), special: 'spy', effects: [] },
    ],
  },
  grief_soldier: {
    kind: 'monster', id: 'grief_soldier', name: 'Grief Soldier', points: 2, maxHp: 80,
    weakness: 'light', darkCharge: true,
    abilities: [
      { id: 'black_blade', name: 'Black Blade', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 30, damageType: 'shadow' }] },
      { id: 'grief_bolt', name: 'Grief Bolt', cost: parseCost('++'), special: 'griefBolt',
        effects: [] },
    ],
  },
  ancient_monstrosity: {
    kind: 'monster', id: 'ancient_monstrosity', name: 'Ancient Monstrosity', points: 3, maxHp: 110,
    weaknesses: ['blast', 'ice'], defense: 2,
    abilities: [
      { id: 'elder_punch', name: 'Elder Punch', cost: parseCost('++'),
        effects: [{ type: 'damage', amount: 20, damageType: 'earth' }] },
      { id: 'elders_eye', name: "Elder's Eye", cost: parseCost('000'),
        special: 'eldersEye', effects: [] },
    ],
  },
  breaker: {
    kind: 'monster', id: 'breaker', name: 'Breaker', points: 2, maxHp: 100,
    weakness: 'blast',
    abilities: [
      { id: 'breaker_bash', name: 'Bash', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 30, damageType: 'earth' }] },
      { id: 'ground_shaker', name: 'Ground Shaker', cost: parseCost('++'),
        special: 'groundShaker', effects: [] },
      { id: 'break', name: 'Break', cost: parseCost('00+'),
        effects: [{ type: 'damage', amount: 40, damageType: 'earth', piercing: true }] },
    ],
  },
  hill_troll: {
    kind: 'monster', id: 'hill_troll', name: 'Hill Troll', points: 4, maxHp: 160,
    weakness: 'light', extremeWeakness: true, defense: 1, families: ['troll'],
    abilities: [
      { id: 'troll_bash', name: 'Bash', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 30 }] },
      { id: 'boulder_toss', name: 'Boulder Toss', cost: parseCost('0++'), ranged: true,
        effects: [{
          type: 'chanceBoostDamage', base: 0, boosted: 60, successFaces: highFaces(4),
          damageType: 'earth',
        }] },
      { id: 'meat_shield', name: 'Meat Shield', cost: parseCost('00'), free: true,
        special: 'meatShield', effects: [] },
    ],
  },
  molika: {
    kind: 'monster', id: 'molika', name: 'Molika', points: 2, maxHp: 70,
    abilities: [
      { id: 'burrow', name: 'Burrow', cost: parseCost(''), free: true, ranged: true,
        special: 'burrow', effects: [] },
      { id: 'claw_bash', name: 'Claw Bash', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 10 }] },
      { id: 'underground', name: 'Underground Attack', cost: parseCost('0+'),
        special: 'underground', targetMode: 'anyMonster', effects: [] },
    ],
  },
  lizel_guardian: {
    kind: 'monster', id: 'lizel_guardian', name: 'Lizel Guardian', points: 3, maxHp: 110,
    weakness: 'ice', defense: 1,
    abilities: [
      { id: 'guardians_blade', name: "Guardian's Blade", cost: parseCost('+'),
        special: 'guardiansBlade', upgradeCost: parseCost('0'), upgradeText: '40 damage',
        effects: [] },
      { id: 'guard', name: 'Guard', cost: parseCost('00'), special: 'guard', effects: [] },
      { id: 'iron_tail', name: 'Iron Tail Lash', cost: parseCost('0+'),
        special: 'ironTail', effects: [] },
    ],
  },
  colossus: {
    kind: 'monster', id: 'colossus', name: 'Colossus', points: 4, maxHp: 180,
    weakness: 'blast', defense: 1,
    passiveText:
      'This card may not gain energy from any source without a Colossus Keystone attached to it.',
    abilities: [
      { id: 'smash', name: 'Smash', cost: parseCost('0++'), special: 'smash', effects: [] },
      { id: 'fortify', name: 'Fortify', cost: parseCost('00'), special: 'fortify', effects: [] },
      { id: 'quake', name: 'Quake', cost: parseCost('++'), special: 'quake', effects: [] },
      { id: 'ancient_guardian', name: 'Ancient Guardian', cost: parseCost('0'),
        special: 'ancientGuardian', effects: [] },
    ],
  },
  wizards_key: {
    kind: 'monster', id: 'wizards_key', name: "Wizard's Key", points: 2, maxHp: 80,
    weakness: 'blast',
    abilities: [
      { id: 'open_fourth_floor', name: 'Open the 4th Floor to the Dungeon', cost: parseCost('0'),
        special: 'openFourthFloor', effects: [] },
      { id: 'magic_door', name: 'Magic Door', cost: parseCost('0'), free: true, ranged: true,
        special: 'magicDoor', effects: [] },
    ],
  },
  yellow_blob: {
    kind: 'monster', id: 'yellow_blob', name: 'Yellow Blob', points: 2, maxHp: 70,
    weakness: 'water', families: ['blob'],
    passiveText:
      'While this card is in play, gain 1 additional energy in the energy phase, which must be given to a blob card.',
    abilities: [
      { id: 'yellow_wakkle', name: 'Yellow Wakkle', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 20, damageType: 'electric' }] },
      { id: 'yellow_splat', name: 'Splat', cost: parseCost('00'),
        effects: [{ type: 'status', status: 'goo', turns: 1 }] },
    ],
  },
  imilthian_alchemist: {
    kind: 'monster', id: 'imilthian_alchemist', name: 'Imilthian Alchemist', points: 2, maxHp: 90,
    weakness: 'light', darkCharge: true,
    abilities: [
      { id: 'bottle_toxins', name: "Bottle o' Toxins", cost: parseCost('00'),
        special: 'bottleToxins', effects: [] },
      { id: 'transmutation', name: 'Transmutation', cost: parseCost('0+'),
        special: 'transmutation', effects: [] },
      { id: 'imilithias_brew', name: "Imilithia's Brew", cost: parseCost('++'),
        special: 'imilithiasBrew', targetMode: 'anyMonster', effects: [] },
    ],
  },
  sword: {
    kind: 'equipment',
    id: 'sword',
    name: 'Sword',
    maxHp: 20,
    equipmentId: 'sword',
  },
  ruby_ring: {
    kind: 'equipment',
    id: 'ruby_ring',
    name: 'Ruby Ring',
    maxHp: 20,
    equipmentId: 'ruby_ring',
  },
  saphire_ring: {
    kind: 'equipment',
    id: 'saphire_ring',
    name: 'Saphire Ring',
    maxHp: 20,
    equipmentId: 'saphire_ring',
  },
  shield: {
    kind: 'equipment', id: 'shield', name: 'Shield', maxHp: 30, equipmentId: 'shield',
  },
  energy_crystal: {
    kind: 'equipment', id: 'energy_crystal', name: 'Energy Crystal', maxHp: 30,
    equipmentId: 'energy_crystal',
  },
  spear: {
    kind: 'equipment', id: 'spear', name: 'Spear', maxHp: 40, equipmentId: 'spear',
  },
  emerald_ring: {
    kind: 'equipment', id: 'emerald_ring', name: 'Emerald Ring', maxHp: 20,
    equipmentId: 'emerald_ring',
  },
  fishing_rod: {
    kind: 'equipment', id: 'fishing_rod', name: 'Fishing Rod', maxHp: 40,
    equipmentId: 'fishing_rod',
  },
  prism_lens: {
    kind: 'equipment', id: 'prism_lens', name: 'Prism Lens', maxHp: 20,
    equipmentId: 'prism_lens',
  },
  colossus_keystone: {
    kind: 'equipment', id: 'colossus_keystone', name: 'Colossus Keystone', maxHp: 1,
    equipmentId: 'colossusKeystone', createdOnly: true, indestructible: true,
  },
  corsair_of_wildersel: {
    kind: 'monster', id: 'corsair_of_wildersel', name: 'Corsair of Wildersel', points: 2, maxHp: 80,
    goldAffinity: true, families: ['pirate'],
    abilities: [
      { id: 'raid', name: 'Raid', cost: parseCost('+'), special: 'raid', effects: [] },
      { id: 'treblae_shot', name: 'Treblae Shot', cost: parseCost('0000'),
        effects: [{ type: 'damage', amount: 50 }] },
    ],
  },
  public_speaker: {
    kind: 'monster', id: 'public_speaker', name: 'Public Speaker', points: 2, maxHp: 80,
    passiveText:
      'While active, if this card is slain by an opponent then all your monsters gain 1 energy, and you may take an additional action on your next turn.',
    abilities: [
      { id: 'speaker_rally', name: 'Rally', cost: parseCost('0'), special: 'speakerRally', effects: [] },
      { id: 'uprising', name: 'Uprising', cost: parseCost('+++'), special: 'uprising', effects: [] },
    ],
  },
  pegasus_gift: {
    kind: 'equipment', id: 'pegasus_gift', name: 'Pegasus Gift', maxHp: 20,
    equipmentId: 'pegasusGift', enchantment: true,
  },
  haunted_mists: {
    kind: 'effect', id: 'haunted_mists', name: 'Haunted Mists', effectId: 'hauntedMists',
  },
  veridis_warrior: {
    kind: 'monster', id: 'veridis_warrior', name: 'Veridis Warrior', points: 2, maxHp: 100,
    abilities: [
      { id: 'slash', name: 'Slash', cost: parseCost('0'), effects: [{ type: 'damage', amount: 20 }] },
      { id: 'veridian_fires', name: 'Veridian Fires', cost: parseCost('0'), special: 'veridianFires', effects: [] },
      { id: 'veridian_bloodcraft', name: 'Veridian Bloodcraft', cost: parseCost('0'), special: 'veridianBloodcraft', effects: [] },
    ],
  },
  lifesteal_blade: {
    kind: 'equipment', id: 'lifesteal_blade', name: 'Lifesteal Blade', maxHp: 30,
    equipmentId: 'lifestealBlade',
  },
  wizrobe: {
    kind: 'monster', id: 'wizrobe', name: 'Wizrobe', points: 2, maxHp: 90,
    passiveText: "Each time you play an effect card this card's attacks gain +10 damage.",
    abilities: [
      { id: 'magic_missile', name: 'Magic Missile', cost: parseCost('00'), ranged: true,
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'spell_casting', name: 'Spell Casting', cost: parseCost('0+'), special: 'spellCasting', effects: [] },
    ],
  },
  tomebinder_wizard: {
    kind: 'monster', id: 'tomebinder_wizard', name: 'Tomebinder Wizard', points: 3, maxHp: 100,
    passiveText:
      "Every effect card you play while this card is in play is remembered in this card's Tome. The Tome may be viewed by clicking on this passive.",
    abilities: [
      { id: 'fireball', name: 'Fireball', cost: parseCost('00'), ranged: true, special: 'fireball', effects: [] },
      { id: 'arcane_tome', name: 'Arcane Tome', cost: parseCost('00'), special: 'arcaneTome', effects: [] },
    ],
  },
  elemental_summoner: {
    kind: 'monster', id: 'elemental_summoner', name: 'Elemental Summoner', points: 3, maxHp: 100,
    weakness: 'sonic',
    abilities: [
      { id: 'summon', name: 'Summon', cost: parseCost('0+'), special: 'summonElement', effects: [] },
      { id: 'elemental_blast', name: 'Elemental Blast', cost: parseCost('++'),
        effects: [{ type: 'damage', amount: 30, damageTypes: [...ELEMENTAL_TYPES] }] },
    ],
  },
  runestone_enchantress: {
    kind: 'monster', id: 'runestone_enchantress', name: 'Runestone Enchantress', points: 3, maxHp: 100,
    abilities: [
      { id: 'enchant_stone', name: 'Enchant', cost: parseCost('0+'), special: 'enchantMonster',
        targetMode: 'anyMonster', effects: [] },
    ],
  },
  resilience: {
    kind: 'equipment', id: 'resilience', name: 'Resilience', maxHp: 20,
    equipmentId: 'resilience', createdOnly: true, attackProof: true, enchantment: true,
  },
  strength: {
    kind: 'equipment', id: 'strength', name: 'Strength', maxHp: 20,
    equipmentId: 'strength', createdOnly: true, attackProof: true, enchantment: true,
  },
  efficiency: {
    kind: 'equipment', id: 'efficiency', name: 'Efficiency', maxHp: 20,
    equipmentId: 'efficiency', createdOnly: true, attackProof: true, enchantment: true,
  },
  enchant: {
    kind: 'effect', id: 'enchant', name: 'Enchant', effectId: 'runestoneEnchant',
  },
  shadow_sprite: {
    kind: 'monster', id: 'shadow_sprite', name: 'Shadow Sprite', points: 2, maxHp: 90,
    weakness: 'light', darkCharge: true,
    abilities: [
      { id: 'black_touch', name: 'Black Touch', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageType: 'shadow' }] },
      { id: 'vile_shadows', name: 'Vile Shadows', cost: parseCost('++'), effects: [
        { type: 'damage', amount: 10, damageType: 'shadow' },
        { type: 'status', status: 'weakened', turns: 2 },
      ] },
    ],
  },
  starbeam_elemental: {
    kind: 'monster', id: 'starbeam_elemental', name: 'Starbeam Elemental', points: 2, maxHp: 90,
    abilities: [
      { id: 'elemental_shard', name: 'Elemental Shard', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageTypes: [...ELEMENTAL_TYPES] }] },
      { id: 'ancient_powers', name: 'Ancient Powers', cost: parseCost('00+'), special: 'ancientPowers', effects: [] },
    ],
  },
  blue_blob: {
    kind: 'monster', id: 'blue_blob', name: 'Blue Blob', points: 2, maxHp: 70,
    defense: 1, weakness: 'water', families: ['blob'],
    abilities: [
      { id: 'blue_wakkle', name: 'Blue Wakkle', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 20, damageType: 'ice' }] },
      { id: 'freezing_goop', name: 'Freezing Goop', cost: parseCost('00'), special: 'freezingGoop', effects: [] },
    ],
  },
  big_red_blob: {
    kind: 'monster', id: 'big_red_blob', name: 'Big Red Blob', points: 2, maxHp: 110,
    weakness: 'water', families: ['blob'],
    passiveText: 'If this card is slain, create and place two Red Blobs.',
    abilities: [
      { id: 'big_red_wakkle', name: 'Red Wakkle', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 40, damageType: 'fire' }] },
      { id: 'big_red_splat', name: 'Splat', cost: parseCost('00'), special: 'bigRedSplat', effects: [] },
    ],
  },
  big_blue_blob: {
    kind: 'monster', id: 'big_blue_blob', name: 'Big Blue Blob', points: 2, maxHp: 110,
    defense: 1, weakness: 'water', families: ['blob'],
    passiveText: 'If this card is slain, create and place two Blue Blobs.',
    abilities: [
      { id: 'big_blue_wakkle', name: 'Blue Wakkle', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 30, damageType: 'ice' }] },
      { id: 'big_blue_splat', name: 'Splat', cost: parseCost('00'), special: 'bigBlueSplat', effects: [] },
    ],
  },
  black_blob: {
    kind: 'monster', id: 'black_blob', name: 'Black Blob', points: 2, maxHp: 80,
    weakness: 'water', families: ['blob'],
    abilities: [
      { id: 'black_wakkle', name: 'Black Wakkle', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 20, damageType: 'shadow' }] },
      { id: 'blob_absorb', name: 'Absorb', cost: parseCost('0+'), special: 'blobAbsorb', effects: [] },
    ],
  },
  big_yellow_blob: {
    kind: 'monster', id: 'big_yellow_blob', name: 'Big Yellow Blob', points: 2, maxHp: 110,
    weakness: 'water', families: ['blob'],
    passiveText:
      'If this card dies, create and place two Yellow Blobs. While this card is in play, gain 1 additional energy in the energy phase, which must be given to a blob card.',
    abilities: [
      { id: 'big_yellow_wakkle', name: 'Wakkle', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 30 }] },
      { id: 'charged_splat', name: 'Charged Splat', cost: parseCost('00'), special: 'chargedSplat', effects: [] },
    ],
  },
  big_black_blob: {
    kind: 'monster', id: 'big_black_blob', name: 'Big Black Blob', points: 2, maxHp: 110,
    weakness: 'water', families: ['blob'],
    passiveText: 'If this card dies, create and place two Black Blobs.',
    abilities: [
      { id: 'big_black_wakkle', name: 'Black Wakkle', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 30, damageType: 'shadow' }] },
      { id: 'blob_absorb', name: 'Absorb', cost: parseCost('0+'), special: 'blobAbsorb', effects: [] },
    ],
  },
  silent_walker: {
    kind: 'monster', id: 'silent_walker', name: 'Silent Walker', points: 2, maxHp: 100,
    weakness: 'sonic',
    abilities: [
      { id: 'stalk', name: 'Stalk', cost: parseCost('+'), special: 'stalk', effects: [] },
      { id: 'silence', name: 'Silence', cost: parseCost('00'), special: 'silence', effects: [] },
    ],
  },
  unending_archer: {
    kind: 'monster', id: 'unending_archer', name: 'Unending Archer', points: 2, maxHp: 80,
    weakness: 'earth', families: ['unending_legion'],
    abilities: [
      { id: 'archer_spear', name: 'Spear', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(3) }] },
      { id: 'volley', name: 'Volley', cost: parseCost('0+'), ranged: true,
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'unrelenting_arrows', name: 'Unrelenting Arrows', cost: parseCost('+++'),
        special: 'unrelentingArrows', effects: [] },
    ],
  },
  keltreson_noble: {
    kind: 'monster', id: 'keltreson_noble', name: 'Keltreson Noble', points: 2, maxHp: 90,
    weakness: 'poison', goldAffinity: true,
    abilities: [
      { id: 'heirloom_sword', name: 'Heirloom Sword', cost: parseCost('++'),
        effects: [{ type: 'damage', amount: 40 }] },
      { id: 'body_guard', name: 'Body Guard', cost: parseCost('00'), special: 'bodyGuard', effects: [] },
      { id: 'tax', name: 'Tax', cost: parseCost('00+'), special: 'tax', effects: [] },
    ],
  },
  northsel_great_hawk: {
    kind: 'monster', id: 'northsel_great_hawk', name: 'Northsel Great Hawk', points: 2, maxHp: 100,
    weakness: 'earth',
    abilities: [
      { id: 'great_wing', name: 'Great Wing', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageType: 'wind' }] },
      { id: 'soar', name: 'Soar', cost: parseCost('++'), special: 'soar', effects: [] },
    ],
  },
  air_sprite: {
    kind: 'monster', id: 'air_sprite', name: 'Air Sprite', points: 2, maxHp: 90,
    weakness: 'earth',
    abilities: [
      { id: 'wind_punch', name: 'Wind Punch', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 30, damageType: 'wind' }] },
      { id: 'dancing_on_the_wind', name: 'Dancing on the Wind', cost: parseCost('00'),
        special: 'dancingWind', effects: [] },
    ],
  },
  construct_warrior: {
    kind: 'monster', id: 'construct_warrior', name: 'Construct Warrior', points: 2, maxHp: 100,
    weakness: 'water', defense: 1, idleEnergy: true,
    passiveText: 'Energy phase: if unused this turn, gain 1 energy.',
    abilities: [
      { id: 'electro_blades', name: 'Electro Blades', cost: parseCost('000'), repeats: 2,
        effects: [{ type: 'damage', amount: 20, damageType: 'electric', piercing: true }] },
      { id: 'guard_protocol', name: 'Guard Protocol', cost: parseCost('00'), special: 'guard', effects: [] },
    ],
  },
  larrathere_knight: {
    kind: 'monster', id: 'larrathere_knight', name: 'Larrathere Knight', points: 3, maxHp: 120,
    weakness: 'shadow', defense: 1,
    passiveText: 'This card deals 10 extra wind damage for every 10 HP that was healed on your last turn.',
    abilities: [
      { id: 'way_of_the_wind', name: 'The Way of the Wind', cost: parseCost('+'), free: true,
        effects: [{ type: 'damage', amount: 0, damageType: 'wind' }] },
      { id: 'render_aid', name: 'Render Aid', cost: parseCost('0'), special: 'renderAid', effects: [] },
    ],
  },
  shrine_of_healing: {
    kind: 'structure', id: 'shrine_of_healing', name: 'Shrine of Healing',
    structureId: 'shrineOfHealing', ethereal: true,
  },
  targeted_hurricane: {
    kind: 'effect', id: 'targeted_hurricane', name: 'Targeted Hurricane', effectId: 'targetedHurricane',
  },
  zephyr_sage: {
    kind: 'monster', id: 'zephyr_sage', name: 'Zephyr Sage', points: 1, maxHp: 70,
    weakness: 'earth',
    abilities: [
      { id: 'wisdom_of_the_winds', name: 'Wisdom of the Winds', cost: parseCost('0'),
        ranged: true, special: 'wisdomWinds', effects: [] },
      { id: 'gust', name: 'Gust', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 10, damageType: 'wind' }] },
    ],
  },
  sandstorm_golem: {
    kind: 'monster', id: 'sandstorm_golem', name: 'Sandstorm Golem', points: 4, maxHp: 200,
    weakness: 'water',
    passiveText: 'This card enters with only Storm Coming unlocked.',
    abilities: [
      { id: 'storm_coming', name: 'Storm Coming', cost: parseCost('000'), special: 'stormComing', effects: [] },
      { id: 'dust_devil', name: 'Dust Devil', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 40, damageTypes: ['wind', 'earth'] }] },
      { id: 'sandstorm', name: 'Sandstorm', cost: parseCost('+++'), special: 'sandstorm', effects: [] },
      { id: 'buried_alive', name: 'Buried Alive', cost: parseCost('0+'), special: 'buriedAlive', effects: [] },
    ],
  },
  megetherin_bat: {
    kind: 'monster', id: 'megetherin_bat', name: 'Megetherin Bat', points: 3, maxHp: 120,
    weakness: 'light',
    abilities: [
      { id: 'shadowy_wings', name: 'Shadowy Wings', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageType: 'wind' }] },
      { id: 'killing_shriek', name: 'Killing Shriek', cost: parseCost('++++'),
        effects: [{ type: 'damage', amount: 70, damageType: 'sonic' }] },
    ],
  },
  iron_headed_thunderblaster: {
    kind: 'monster', id: 'iron_headed_thunderblaster', name: 'Iron-headed Thunderblaster',
    points: 6, maxHp: 230, defense: 1,
    abilities: [
      { id: 'steel_chomp', name: 'Steel Chomp', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 40 }] },
      { id: 'lightning_blast', name: 'Lightning Blast', cost: parseCost('+++'),
        effects: [{ type: 'damage', amount: 80, damageType: 'electric' }] },
      { id: 'iron_ram', name: 'Iron Ram', cost: parseCost('0+'),
        effects: [
          { type: 'damage', amount: 50, damageType: 'earth' },
          { type: 'chanceStatus', status: 'weakened', turns: 1, successFaces: highFaces(4) },
        ] },
    ],
  },
  blast_leecher: {
    kind: 'monster', id: 'blast_leecher', name: 'Blast Leecher', points: 3, maxHp: 110,
    weakness: 'ice',
    abilities: [
      { id: 'heavy_claws', name: 'Heavy Claws', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 30, successFaces: highFaces(4), damageType: 'earth' }] },
      { id: 'vampiric_drain', name: 'Vampiric Drain', cost: parseCost('00'),
        effects: [{ type: 'damage', amount: 30 }, { type: 'healSelf', amount: 30 }] },
      { id: 'blast', name: 'Blast', cost: parseCost('+++'), special: 'blast', effects: [] },
    ],
  },
  wavebrewer: {
    kind: 'monster', id: 'wavebrewer', name: 'Wavebrewer', points: 2, maxHp: 70,
    weakness: 'ice',
    abilities: [
      { id: 'ocean_alchemy', name: 'Ocean Alchemy', cost: parseCost('0'), special: 'oceanAlchemy', effects: [] },
      { id: 'gather_seaweed', name: 'Gather Seaweed', cost: parseCost('+'), free: true, special: 'drawOne', effects: [] },
    ],
  },
  moonlight_leecher: {
    kind: 'monster', id: 'moonlight_leecher', name: 'Moonlight Leecher', points: 2, maxHp: 70,
    weakness: 'light',
    abilities: [
      { id: 'scratch', name: 'Scratch', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'drugged_vampiric_suck', name: 'Drugged Vampiric Suck', cost: parseCost('0'),
        special: 'druggedSuck', effects: [] },
    ],
  },
  energy_surge: {
    kind: 'effect', id: 'energy_surge', name: 'Energy Surge', effectId: 'energySurge',
  },
  seaborn_merchant: {
    kind: 'monster', id: 'seaborn_merchant', name: 'Seaborn Merchant', points: 2, maxHp: 80,
    weakness: 'earth', goldAffinity: true,
    abilities: [
      { id: 'seablade', name: 'Seablade', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20, damageType: 'water' }] },
      { id: 'overseas_trading', name: 'Overseas Trading', cost: parseCost('+'), free: true,
        special: 'overseasTrading', effects: [] },
    ],
  },
  gnome_demolitionist: {
    kind: 'monster', id: 'gnome_demolitionist', name: 'Gnome Demolitionist', points: 2, maxHp: 70,
    abilities: [
      { id: 'oversized_hammer', name: 'Oversized Hammer', cost: parseCost('+'),
        effects: [
          { type: 'damage', amount: 20, damageType: 'earth' },
          { type: 'status', status: 'weakened', turns: 1 },
        ] },
      { id: 'magnetic_bomb', name: 'Magnetic Bomb', cost: parseCost('++'), special: 'magneticBomb', effects: [] },
      { id: 'detonate', name: 'Detonate', cost: parseCost('0'), special: 'detonate', effects: [] },
    ],
  },
  gnome_bomb: {
    kind: 'equipment', id: 'gnome_bomb', name: 'Gnome Bomb', maxHp: 40,
    equipmentId: 'gnomeBomb', createdOnly: true, removeOnLeave: true,
  },
  elder_smith: {
    kind: 'monster', id: 'elder_smith', name: 'Elder Smith', points: 2, maxHp: 90,
    defense: 1, weakness: 'shadow', goldAffinity: true,
    abilities: [
      { id: 'dwarven_spirit', name: 'Dwarven Spirit', cost: parseCost('00'), special: 'dwarvenSpirit', effects: [] },
      { id: 'master_of_the_forge', name: 'Master of the Forge', cost: parseCost('+'),
        special: 'masterOfTheForge', effects: [] },
    ],
  },
  goldwind_vawk: {
    kind: 'monster', id: 'goldwind_vawk', name: 'Goldwind Vawk', points: 2, maxHp: 70,
    weakness: 'earth', goldAffinity: true,
    abilities: [
      { id: 'shining_bow', name: 'Shining Bow', cost: parseCost('0+'), ranged: true, light: true,
        effects: [{ type: 'damage', amount: 30, damageType: 'light' }] },
      { id: 'reach_for_the_sky', name: 'Reach for the Sky', cost: parseCost('00'),
        special: 'reachForTheSky', effects: [] },
      { id: 'cleansing_rites', name: 'Cleansing Rites', cost: parseCost('0+'), light: true,
        special: 'cleansingRites', effects: [] },
    ],
  },
  suntouched_larner: {
    kind: 'monster', id: 'suntouched_larner', name: 'Suntouched Larner', points: 2, maxHp: 80,
    weakness: 'wind',
    abilities: [
      { id: 'piercing_ray', name: 'Piercing Ray', cost: parseCost('+'), light: true,
        effects: [{ type: 'damage', amount: 20, damageType: 'light', piercing: true }] },
      { id: 'revealing_light', name: 'Revealing Light', cost: parseCost('0+'), light: true,
        special: 'revealingLight', effects: [] },
    ],
  },
  lightbloom_snapatrap: {
    kind: 'monster', id: 'lightbloom_snapatrap', name: 'Lightbloom Snapatrap', points: 2, maxHp: 70,
    weakness: 'wind', families: ['plant'],
    passiveText: 'When this card is slain, each opposing active monster takes 10 light damage.',
    abilities: [
      { id: 'chomp', name: 'Chomp', cost: parseCost('+'),
        effects: [{ type: 'rollDamage', table: { 1: 30, 2: 30, 3: 30, 4: 40, 5: 40, 6: 40 } }] },
      { id: 'flashbloom', name: 'Flashbloom', cost: parseCost('00'), light: true,
        special: 'flashbloom', effects: [] },
      { id: 'regrow', name: 'Regrow', cost: parseCost('0'), free: true,
        effects: [{ type: 'healSelf', amount: 10 }] },
    ],
  },
  hollow_rogue: {
    kind: 'monster', id: 'hollow_rogue', name: 'Hollow Rogue', points: 2, maxHp: 70,
    weakness: 'light', goldAffinity: true, darkCharge: true, families: ['pirate'],
    passiveText: 'This card does double damage on the turn you play it.',
    abilities: [
      { id: 'twisted_knife', name: 'Twisted Knife', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'black_bolt', name: 'Black Bolt', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 30, damageType: 'shadow' }] },
      { id: 'vanish', name: 'Vanish', cost: parseCost('+++'), special: 'vanish', effects: [] },
    ],
  },
  kings_of_the_ocean: {
    kind: 'monster', id: 'kings_of_the_ocean', name: 'The Kings of the Ocean', points: 6, maxHp: 300,
    unique: true, besideRow: true, goldAffinity: true, goldOnly: true, families: ['pirate'],
    specialText:
      'Tribute to the Ocean — The Kings may only use gold as energy. A card that gives them gold cannot be harmed by the Kings of the Ocean until the end of the Kings player\'s next turn. Opponents may give them gold.',
    abilities: [
      { id: 'hurricane', name: 'Hurricane', cost: parseCost('++'),
        effects: [{ type: 'damage', amount: 50, damageType: 'wind' }] },
      { id: 'hail_to_the_kings', name: 'Hail To The Kings!', cost: parseCost('0+'),
        special: 'hailToTheKings', effects: [] },
      { id: 'pirates_haven', name: "Pirate's Haven", cost: parseCost('000'),
        special: 'piratesHaven', effects: [] },
      { id: 'wrath_of_storms', name: 'The Wrath of Storms', cost: parseCost('+++++'),
        special: 'wrathOfStorms', effects: [] },
    ],
  },
  lord_kalung_firefist: {
    kind: 'monster', id: 'lord_kalung_firefist', name: 'Lord Kalung Firefist', points: 5, maxHp: 190,
    unique: true,
    abilities: [
      { id: 'flaming_fists', name: 'Flaming Fists', cost: parseCost('0+'),
        effects: [
          { type: 'damage', amount: 40, damageType: 'fire' },
          { type: 'status', status: 'burn', turns: 2 },
        ] },
      { id: 'kalung_fireball', name: 'Fireball', cost: parseCost('00'), ranged: true,
        special: 'fireball', effects: [] },
      { id: 'incineration', name: 'Incineration', cost: parseCost('++++'),
        special: 'incineration', effects: [] },
    ],
  },
  relkar_goldflame: {
    kind: 'monster', id: 'relkar_goldflame', name: 'Relkar Goldflame', points: 6, maxHp: 240,
    unique: true, families: ['unending_legion'],
    specialText: 'Unending — You cannot lose the game while this card is in play.',
    abilities: [
      { id: 'fury', name: 'Fury', cost: parseCost('+'),
        special: 'fury', effects: [] },
      { id: 'legion_grows', name: 'The Legion Grows', cost: parseCost('0'),
        special: 'legionGrows', effects: [] },
      { id: 'legion_marches', name: 'The Legion Marches On', cost: parseCost('0++'), free: true,
        special: 'legionMarches', effects: [] },
    ],
  },
  lord_devadian: {
    kind: 'monster', id: 'lord_devadian', name: 'Lord Devadian', points: 6, maxHp: 200,
    unique: true,
    specialText:
      'Bloodlust — When Devadian kills any monster, you may choose to make its owner lose no points, instead giving this card +40 max HP, +40 HP, +20 damage to Vicious Claws, 1 energy, and Shadow Matter fires an additional time when used.',
    abilities: [
      { id: 'vicious_claws', name: 'Vicious Claws', cost: parseCost('0'),
        special: 'viciousClaws', effects: [] },
      { id: 'feed', name: 'Feed', cost: parseCost('0+'),
        special: 'feed', effects: [] },
      { id: 'shadow_matter', name: 'Shadow Matter', cost: parseCost('0+'),
        special: 'shadowMatter', repeats: 1, effects: [] },
      { id: 'wings_of_night', name: 'Wings of Night', cost: parseCost('+++'), free: true,
        special: 'wingsOfNight', effects: [] },
    ],
  },
  yentir_starforged: {
    kind: 'equipment', id: 'yentir_starforged', name: 'Yentir Starforged', maxHp: 0,
    equipmentId: 'yentirStarforged', unique: true, unbreakable: true, indestructible: true,
    specialText:
      'Unbreakable. When you play this card, you lose 1 point. The attached card\'s attacks deal +20 damage. They are considered to be of every elemental type.',
  },
  harry_the_hero: {
    kind: 'monster', id: 'harry_the_hero', name: 'Harry the Hero', points: 4, maxHp: 120,
    unique: true,
    abilities: [
      { id: 'really_big_axe', name: 'Really BIG Axe', cost: parseCost('0+'),
        effects: [{ type: 'rollDamage', table: { 1: 40, 2: 40, 3: 50, 4: 50, 5: 60, 6: 60 } }] },
      { id: 'golden_energy', name: 'Golden Energy', cost: parseCost('000'),
        special: 'goldenEnergy', effects: [] },
      { id: 'monsters_and_elements', name: 'Monsters & Elements', cost: parseCost('00'),
        special: 'monstersAndElements', effects: [] },
    ],
  },
  horror_of_the_deep: {
    kind: 'monster', id: 'horror_of_the_deep', name: 'The Horror of the Deep', points: 6, maxHp: 300,
    unique: true,
    specialText:
      'Paralyzing Fear — Any monster that takes damage from the Horror rolls. On a 5 or 6, nothing else happens. On a 3 or 4, it withdraws. On a 1 or 2, it withdraws and cannot use abilities or gain energy until the start of your next turn. A monster slain by the hit does not roll.',
    abilities: [
      { id: 'shadows_rising', name: 'Shadows Rising', cost: parseCost('0'),
        special: 'shadowsRising', effects: [] },
      { id: 'dragged_to_the_deep', name: 'Dragged to the Deep', cost: parseCost('0+'),
        special: 'draggedToTheDeep', effects: [] },
      { id: 'feed_the_beast', name: 'Feed the Beast', cost: parseCost('00+'),
        special: 'feedTheBeast', effects: [] },
    ],
  },
  tenilius_icilius: {
    kind: 'monster', id: 'tenilius_icilius', name: 'Tenilius Icilius', points: 2, maxHp: 100,
    unique: true, weakness: 'fire',
    specialText:
      'Aqua Nova — Whenever an opponent spends filled energy on an ability, this card gains that much energy.',
    abilities: [
      { id: 'ice_lance', name: 'Ice Lance', cost: parseCost('++'), ice: true,
        effects: [{ type: 'damage', amount: 30, damageType: 'ice' }] },
      { id: 'chilling_winds', name: 'Chilling Winds', cost: parseCost('0++'), ice: true,
        special: 'chillingWinds', effects: [] },
      { id: 'deep_freeze', name: 'Deep Freeze', cost: parseCost('+++++'), ice: true,
        special: 'deepFreeze', effects: [] },
    ],
  },
  gorruk_warchieftan: {
    kind: 'monster', id: 'gorruk_warchieftan', name: 'Gorruk, Warchieftan', points: 4, maxHp: 140,
    unique: true, defense: 1, goldAffinity: true, families: ['orc'],
    specialText:
      'Shinies for me Plunderers — Orcs, goblins, and trolls you control have Gold Affinity. Whenever one of them deals damage to another monster, it gains 1 gold.',
    abilities: [
      { id: 'dragonbone_spear', name: 'Dragonbone Spear', cost: parseCost('0+'),
        effects: [{ type: 'chanceBoostDamage', base: 30, boosted: 40, successFaces: highFaces(3) }] },
      { id: 'warcry', name: 'Warcry', cost: parseCost('+'), free: true,
        special: 'warcry', effects: [] },
      { id: 'meat_to_eat', name: 'Meat to Eat', cost: parseCost('++'),
        effects: [{ type: 'healSelf', amount: 30 }] },
    ],
  },
  thornflower_monstrosity: {
    kind: 'monster', id: 'thornflower_monstrosity', name: 'Thornflower Monstrosity', points: 5, maxHp: 100,
    unique: true, weakness: 'fire', families: ['plant'],
    specialText:
      'Monstrous Growth — Whenever this card would heal HP, you may choose to instead create and place a non-unique Thornflower Monstrosity worth 0 points adjacent to any Thornflower Monstrosity you control. Whenever a Thornflower Monstrosity you control gains energy, all copies of it gain energy.',
    abilities: [
      { id: 'growth', name: 'Growth', cost: parseCost('++'), free: true,
        special: 'thornGrowth', effects: [] },
      { id: 'thorns', name: 'Thorns', cost: parseCost('0'),
        special: 'thorns', effects: [] },
      { id: 'overwhelm', name: 'Overwhelm', cost: parseCost('+'),
        special: 'overwhelm', effects: [] },
    ],
  },
  ashling: {
    kind: 'monster', id: 'ashling', name: 'Ashling', points: 2, maxHp: 70,
    weakness: 'wind',
    passiveText: 'Whenever a card takes fire damage, this card gains 10 max HP and heals 10 HP.',
    abilities: [
      { id: 'ember_punch', name: 'Ember Punch', cost: parseCost('+'),
        effects: [{ type: 'damage', amount: 20, damageType: 'fire' }] },
      { id: 'sudden_blaze', name: 'Sudden Blaze', cost: parseCost('0+'),
        special: 'suddenBlaze', effects: [] },
    ],
  },
}

export const SPEAR_ABILITY: AbilityDef = {
  id: 'spear',
  name: 'Spear',
  cost: parseCost('0'),
  effects: [
    { type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: highFaces(3) },
  ],
}

export const ALL_CARD_IDS = Object.keys(CATALOG)

export function getCard(defId: string): CardDef {
  const card = CATALOG[defId]
  if (!card) throw new Error(`Unknown card: ${defId}`)
  return card
}

export function getMonster(defId: string) {
  const card = getCard(defId)
  if (card.kind !== 'monster') throw new Error(`Not a monster: ${defId}`)
  return card
}

export function getWeaknesses(defId: string) {
  const monster = getMonster(defId)
  return monster.weaknesses ?? (monster.weakness ? [monster.weakness] : [])
}

export function grantedAbilities(monster: FieldMonster): AbilityDef[] {
  return monster.equipment.some((eq) => eq.defId === 'spear') ? [SPEAR_ABILITY] : []
}

export function identityDefId(monster: { defId: string; shapeshiftDefId?: string }): string {
  return monster.shapeshiftDefId ?? monster.defId
}

export function monsterAbilities(monster: FieldMonster): AbilityDef[] {
  const printed = getMonster(monster.defId)
  const source = monster.shapeshiftDefId ? getMonster(monster.shapeshiftDefId) : printed
  const shapeshift = printed.abilities.filter((ability) => ability.id === 'shapeshift')
  const copied = source.abilities.filter((ability) => ability.id !== 'shapeshift')
  return [...shapeshift, ...copied, ...grantedAbilities(monster)]
}

export function totalEnergyNeeded(cost: { require: number; spend: number }): number {
  return cost.require + cost.spend
}

const FIRE_BLAST_SPECIALS = new Set([
  'sizzlingShell',
  'fireSword',
  'lavaClaw',
  'magmaGush',
  'sunburn',
  'burningBuck',
  'stampede',
  'rocket',
  'chaosFireworks',
  'fireball',
])

function listedDamageTypes(effect: AbilityEffect): DamageType[] {
  if (effect.type === 'damage') {
    return [...(effect.damageTypes ?? []), ...(effect.damageType ? [effect.damageType] : [])]
  }
  if (effect.type === 'rollDamage' || effect.type === 'chanceBoostDamage') {
    return effect.damageType ? [effect.damageType] : []
  }
  return []
}

function abilityDealsFireOrBlast(ability: AbilityDef): boolean {
  if (ability.special && FIRE_BLAST_SPECIALS.has(ability.special)) return true
  if (['fire_punch', 'overheat', 'explode', 'red_wakkle', 'fire_sword', 'burning_buck'].includes(ability.id)) {
    return true
  }
  return ability.effects.some((effect) => {
    const types = listedDamageTypes(effect)
    return types.includes('fire') || types.includes('blast')
  })
}

export function hasFireOrBlastAttack(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return card.abilities.some(abilityDealsFireOrBlast)
}

export function chaosFireworksSpend(player: PlayerState, rocketeerSlot: number): number {
  let others = 0
  for (let slot = 0; slot < player.field.length; slot++) {
    const monster = player.field[slot]
    if (!monster || slot === rocketeerSlot) continue
    if (hasFireOrBlastAttack(monster.defId)) others++
  }
  return Math.max(0, 6 - others)
}

export const BREWABLE_WEAKNESSES: DamageType[] = [
  'fire',
  'water',
  'ice',
  'poison',
  'electric',
  'light',
  'sonic',
  'blast',
  'shadow',
  'wind',
  'earth',
]

export function formatDamageType(type: DamageType): string {
  return type
}

function abilityInflictsOrBoostsPoison(ability: AbilityDef): boolean {
  if (ability.special === 'bottleToxins') return true
  return ability.effects.some(
    (effect) =>
      listedDamageTypes(effect).includes('poison') ||
      ((effect.type === 'status' || effect.type === 'chanceStatus') && effect.status === 'poison'),
  )
}

export function countsAsPoisonCard(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return card.abilities.some(abilityInflictsOrBoostsPoison)
}

export function countPoisonCardsInPlay(player: PlayerState): number {
  return player.field.filter((monster) => monster && countsAsPoisonCard(monster.defId)).length
}

export function isBlobMonster(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return card.families?.includes('blob') === true || card.name.toLowerCase().includes('blob')
}

export function isOrcOrGoblin(defId: string): boolean {
  const name = getMonster(defId).name.toLowerCase()
  return name.includes('orc') || name.includes('goblin')
}

export function isBoneling(card: string | { defId: string; shapeshiftDefId?: string }): boolean {
  const defId = typeof card === 'string' ? card : identityDefId(card)
  return defId === 'boneling'
}

export function isStormling(defId: string): boolean {
  const card = getCard(defId)
  return card.kind === 'monster' && card.families?.includes('stormling') === true
}

export function countOtherStormlings(player: PlayerState, exceptInstanceId: string): number {
  return player.field.filter(
    (monster) => monster && monster.instanceId !== exceptInstanceId && isStormling(identityDefId(monster)),
  ).length
}

export function isPlant(defId: string): boolean {
  const card = getCard(defId)
  return card.kind === 'monster' && card.families?.includes('plant') === true
}

export function isWoody(defId: string): boolean {
  const card = getCard(defId)
  return card.kind === 'monster' && card.families?.includes('woody') === true
}

export function countWoodySpears(players: PlayerState[], hand: { defId: string }[]): number {
  let count = 0
  for (const side of players) {
    for (const monster of side.field) {
      if (monster && isWoody(monster.defId)) count += 1
    }
  }
  for (const card of hand) {
    if (isWoody(card.defId)) count += 1
  }
  return count
}

const FIRE_DAMAGE_SPECIALS = new Set([
  'sizzlingShell',
  'lavaClaw',
  'magmaGush',
  'sunburn',
  'stampede',
  'overheat',
  'burningBreath',
  'burningSpear',
])

export function isFireMonster(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return card.abilities.some((ability) => {
    if (ability.special && FIRE_DAMAGE_SPECIALS.has(ability.special)) return true
    if (ability.id === 'fire_punch') return true
    return ability.effects.some(
      (effect) =>
        (effect.type === 'damage' ||
          effect.type === 'rollDamage' ||
          effect.type === 'chanceBoostDamage') &&
        effect.damageType === 'fire',
    )
  })
}

export function hasDarkCharge(monster: FieldMonster): boolean {
  return getMonster(identityDefId(monster)).darkCharge === true
}

export function isPlunderer(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return (
    card.families?.includes('orc') === true ||
    card.families?.includes('goblin') === true ||
    card.families?.includes('troll') === true
  )
}

export function controlsGorruk(player: PlayerState): boolean {
  if (player.beside && identityDefId(player.beside) === 'gorruk_warchieftan') return true
  return player.field.some((monster) => monster && identityDefId(monster) === 'gorruk_warchieftan')
}

export function hasGoldAffinity(monster: FieldMonster, state?: GameState): boolean {
  if (getMonster(identityDefId(monster)).goldAffinity === true) return true
  if (!state || !isPlunderer(identityDefId(monster))) return false
  const owner = state.players.find(
    (player) =>
      player.field.some((other) => other?.instanceId === monster.instanceId) ||
      player.beside?.instanceId === monster.instanceId,
  )
  return owner ? controlsGorruk(owner) : false
}

export function canUseDarkCharge(player: PlayerState): boolean {
  if (player.discard.length === 0) return false
  return player.field.some((monster) => monster && hasDarkCharge(monster))
}

const ELECTRIC_SPECIALS = new Set([
  'plasmaVolley',
  'discharge',
  'lightningNeedle',
  'zap',
  'storm',
  'plasmaCannon',
  'wormStorm',
  'bringTheStorm',
])

const WATER_SPECIALS = new Set([
  'waterClaw',
  'waterGush',
  'waterJet',
  'mudball',
  'downpour',
  'bringTheStorm',
])

const WIND_SPECIALS = new Set(['gale'])

function abilityDealsDamageType(
  ability: AbilityDef,
  type: DamageType,
  specials: Set<string>,
): boolean {
  if (ability.special && specials.has(ability.special)) return true
  return ability.effects.some((effect) => listedDamageTypes(effect).includes(type))
}

function abilityDealsElectric(ability: AbilityDef): boolean {
  return abilityDealsDamageType(ability, 'electric', ELECTRIC_SPECIALS)
}

export function countsAsElectricCard(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return card.abilities.some(abilityDealsElectric)
}

export function countsAsElementalCard(defId: string): boolean {
  const card = getCard(defId)
  if (card.kind !== 'monster') return false
  return card.abilities.some(
    (ability) =>
      abilityDealsDamageType(ability, 'electric', ELECTRIC_SPECIALS) ||
      abilityDealsDamageType(ability, 'water', WATER_SPECIALS) ||
      abilityDealsDamageType(ability, 'wind', WIND_SPECIALS),
  )
}

export type CardSearchType =
  | Exclude<DamageType, 'untyped'>
  | 'plant'
  | 'woody'
  | 'stormling'
  | 'blob'
  | 'pirate'
  | 'unending_legion'
  | 'orc'
  | 'goblin'
  | 'troll'
  | 'dark_charge'
  | 'gold_affinity'
  | 'enchantment'
  | 'unique'

/** Specials whose printed hit is this type even when the ability has no damage effect. */
const SPECIAL_DAMAGE_TYPES: Record<string, Exclude<DamageType, 'untyped'>[]> = {
  waterGush: ['water'],
  mudball: ['water'],
  waterJet: ['water'],
  downpour: ['water'],
  bringTheStorm: ['electric', 'water'],
  plasmaVolley: ['electric'],
  discharge: ['electric'],
  lightningNeedle: ['electric'],
  zap: ['electric'],
  storm: ['electric'],
  wormStorm: ['electric'],
  plasmaCannon: ['electric'],
  gale: ['wind'],
  sizzlingShell: ['fire'],
  magmaGush: ['fire'],
  sunburn: ['fire'],
  overheat: ['fire'],
  eyeFlash: ['fire'],
  stampede: ['fire'],
  burningBreath: ['fire'],
  burningSpear: ['fire'],
  iceyBeak: ['ice'],
  frostbite: ['ice'],
  frozenSting: ['ice'],
  chorus: ['light'],
  solarFlare: ['light'],
  pilfer: ['shadow'],
  griefBolt: ['shadow'],
  bottleToxins: ['poison'],
  poisonGas: ['poison'],
  scent: ['poison'],
  groundShaker: ['earth'],
  underground: ['earth'],
  quake: ['earth'],
  magicMusic: ['sonic'],
  soundWave: ['sonic'],
  rocket: ['blast'],
  blast: ['blast'],
  detonate: ['blast'],
  searingLight: ['light'],
  flashbloom: ['light'],
  chaosFireworks: ['blast'],
  fireball: ['blast'],
  ancientPowers: [...ELEMENTAL_TYPES],
  stalk: ['shadow'],
  dancingWind: ['wind'],
  sandstorm: ['earth', 'wind'],
}

const EFFECT_DAMAGE_TYPES: Record<string, Exclude<DamageType, 'untyped'>[]> = {
  stormBolts: ['electric'],
  whirlpool: ['water'],
  daybreak: ['light'],
}

function abilitySearchDamageTypes(ability: AbilityDef): Exclude<DamageType, 'untyped'>[] {
  const types: Exclude<DamageType, 'untyped'>[] = []
  if (ability.special) types.push(...(SPECIAL_DAMAGE_TYPES[ability.special] ?? []))
  for (const effect of ability.effects) {
    for (const type of listedDamageTypes(effect)) {
      if (type !== 'untyped') types.push(type)
    }
  }
  return types
}

/** True when the card deals that damage type, belongs to that family, or has that trait. Weakness does not count. */
export function cardMatchesSearchType(defId: string, type: CardSearchType): boolean {
  const card = getCard(defId)
  if (type === 'plant') return isPlant(defId)
  if (type === 'woody') return isWoody(defId)
  if (type === 'stormling') return isStormling(defId)
  if (type === 'blob') return isBlobMonster(defId)
  if (type === 'dark_charge') return card.kind === 'monster' && card.darkCharge === true
  if (type === 'gold_affinity') return card.kind === 'monster' && card.goldAffinity === true
  if (type === 'enchantment') return card.kind === 'equipment' && card.enchantment === true
  if (type === 'unique') {
    return (card.kind === 'monster' || card.kind === 'equipment') && card.unique === true
  }
  if (type === 'pirate') return card.kind === 'monster' && card.families?.includes('pirate') === true
  if (type === 'unending_legion') {
    return card.kind === 'monster' && card.families?.includes('unending_legion') === true
  }
  if (type === 'orc' || type === 'goblin' || type === 'troll') {
    return card.kind === 'monster' && card.families?.includes(type) === true
  }
  if (type === 'light' && card.kind === 'monster' && card.families?.includes('light')) return true
  if (card.kind === 'effect') return EFFECT_DAMAGE_TYPES[card.effectId]?.includes(type) === true
  if (card.kind !== 'monster') return false
  return card.abilities.some((ability) => abilitySearchDamageTypes(ability).includes(type))
}

/** Equipment Master of the Forge can create. Enchantments and created cards are excluded. */
export function forgeEquipmentIds(): string[] {
  return ALL_CARD_IDS.filter((id) => {
    const card = getCard(id)
    return card.kind === 'equipment' && !card.createdOnly && !card.enchantment
  })
}

export function countElectricCardsInPlay(player: PlayerState, exceptInstanceId?: string): number {
  return player.field.filter(
    (monster) =>
      monster &&
      monster.instanceId !== exceptInstanceId &&
      countsAsElectricCard(monster.defId),
  ).length
}
