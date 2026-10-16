import type { AbilityDef, CardDef, DamageType, FieldMonster, PlayerState } from './types'

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
            successFaces: [1, 2],
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
        effects: [{ type: 'damage', amount: 20, damageType: 'poison' }, { type: 'status', status: 'poison', turns: 3 }] },
    ],
  },
  big_blob: {
    kind: 'monster', id: 'big_blob', name: 'Big Blob', points: 2, maxHp: 100,
    weakness: 'water', families: ['blob'],
    passiveText: 'When slain, place two generated Blobs in empty slots.',
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
      { id: 'swarm', name: 'Swarm', cost: parseCost('00'), special: 'swarm', effects: [] },
    ],
  },
  rarkling: {
    kind: 'monster', id: 'rarkling', name: 'Rarkling', points: 2, maxHp: 100, weakness: 'ice',
    abilities: [
      { id: 'claw_rake', name: 'Claw Rake', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: [1, 2, 3] }] },
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
        effects: [{ type: 'chanceBoostDamage', base: 0, boosted: 30, successFaces: [1, 2, 3, 4] }] },
      { id: 'plasma_volley', name: 'Plasma Volley', cost: parseCost('+++'), special: 'plasmaVolley', effects: [] },
    ],
  },
  yellow_fairy: {
    kind: 'monster', id: 'yellow_fairy', name: 'Yellow Fairy', points: 2, maxHp: 90,
    weakness: 'electric',
    passiveText: 'While in play, add 1 distributable energy each energy phase.',
    abilities: [
      { id: 'light_beam', name: 'Light Beam', cost: parseCost('00'),
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 20, successFaces: [1, 2, 3], damageType: 'light' }] },
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
    abilities: [
      { id: 'cruel_scimitar', name: 'Cruel Scimitar', cost: parseCost('0+'),
        effects: [{ type: 'chanceBoostDamage', base: 0, boosted: 40, successFaces: [2, 3, 4, 5, 6] }] },
      { id: 'poisoned_shaft', name: 'Poisoned Shaft', cost: parseCost('0+'), ranged: true,
        effects: [
          { type: 'damage', amount: 10, damageType: 'poison' },
          { type: 'status', status: 'poison', turns: 3 },
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
    weakness: 'light', goldAffinity: true,
    abilities: [
      { id: 'rusty_cutlass', name: 'Rusty Cutlass', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 0, boosted: 30, successFaces: [1, 2, 3, 4] }] },
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
        effects: [{ type: 'chanceBoostDamage', base: 30, boosted: 40, successFaces: [1, 2] }] },
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
          successFaces: [1, 2, 3], damageType: 'ice' }] },
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
          successFaces: [1, 2], damageType: 'ice' }] },
      { id: 'chill', name: 'Chill', cost: parseCost('00'), ice: true,
        special: 'chill', effects: [] },
    ],
  },
  lantern_wisp: {
    kind: 'monster', id: 'lantern_wisp', name: 'Lantern Wisp', points: 1, maxHp: 50,
    weakness: 'ice', families: ['light'],
    abilities: [
      { id: 'gleam', name: 'Gleam', cost: parseCost('0'), free: true, ranged: true, light: true,
        special: 'gleam', effects: [] },
      { id: 'flicker', name: 'Flicker', cost: parseCost('+'), light: true,
        effects: [{ type: 'damage', amount: 10, damageType: 'light' }] },
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
          { type: 'status', status: 'burn', turns: 3 },
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
          { type: 'chanceBoostDamage', base: 30, boosted: 40, successFaces: [1, 2, 3], damageType: 'light' },
          { type: 'status', status: 'burn', turns: 3 },
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
          { type: 'status', status: 'burn', turns: 3 },
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
    weakness: 'poison', goldAffinity: true,
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
        special: 'archersKeep', effects: [] },
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
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: [1, 2] }] },
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
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 20, successFaces: [1] }] },
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
          { type: 'status', status: 'poison', turns: 3 },
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
    weakness: 'electric',
    abilities: [
      { id: 'legion_spear', name: 'Spear', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: [1, 2, 3] }] },
      { id: 'improvised_weapon', name: 'Improvised Weapon', cost: parseCost('0+'),
        effects: [{ type: 'damage', amount: 40 }] },
      { id: 'relentless', name: 'Relentless', cost: parseCost('++'), special: 'relentless', effects: [] },
    ],
  },
  unending_bannerman: {
    kind: 'monster', id: 'unending_bannerman', name: 'Bannerman of the Unending Legion', points: 2, maxHp: 80,
    weakness: 'electric',
    passiveText: 'During your energy phase, you may give 1 energy to a monster you control worth 2 points or less.',
    abilities: [
      { id: 'legion_spear', name: 'Spear', cost: parseCost('0'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: [1, 2, 3] }] },
      { id: 'attack', name: 'ATTACK!', cost: parseCost('++++'), special: 'attack', effects: [] },
    ],
  },
  veyan_bard: {
    kind: 'monster', id: 'veyan_bard', name: 'Veyan Bard', points: 2, maxHp: 90,
    abilities: [
      { id: 'overdramatic_solo', name: 'Over-dramatic Solo', cost: parseCost('0'),
        effects: [{ type: 'rollDamage', table: { 1: 10, 2: 20, 3: 20, 4: 20, 5: 20, 6: 30 }, damageType: 'sound' }] },
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
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 30, successFaces: [1, 2, 3, 4, 5] }] },
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
        effects: [{ type: 'damage', amount: 60, damageType: 'sound' }] },
      { id: 'sound_wave', name: 'Sound Wave', cost: parseCost('00++'),
        special: 'soundWave', effects: [] },
    ],
  },
  supply_construct: {
    kind: 'monster', id: 'supply_construct', name: 'Supply Construct', points: 2, maxHp: 90,
    weakness: 'water', defense: 1, idleEnergy: true,
    passiveText: 'Energy phase: if unused this turn, gain 1 energy.',
    abilities: [
      { id: 'claw', name: 'Claw', cost: parseCost('+'),
        effects: [{ type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: [1, 2, 3] }] },
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
        effects: [{ type: 'chanceBoostDamage', base: 10, boosted: 50, successFaces: [1, 2, 3, 4], damageType: 'poison' }] },
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
        effects: [{ type: 'damage', amount: 20 }] },
      { id: 'elders_eye', name: "Elder's Eye", cost: parseCost('000'),
        special: 'eldersEye', effects: [] },
    ],
  },
  breaker: {
    kind: 'monster', id: 'breaker', name: 'Breaker', points: 2, maxHp: 100,
    weakness: 'blast', defense: 1,
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
    weakness: 'light', extremeWeakness: true, defense: 1,
    abilities: [
      { id: 'troll_bash', name: 'Bash', cost: parseCost('0'),
        effects: [{ type: 'damage', amount: 30 }] },
      { id: 'boulder_toss', name: 'Boulder Toss', cost: parseCost('0++'), ranged: true,
        effects: [{
          type: 'chanceBoostDamage', base: 0, boosted: 60, successFaces: [1, 2, 3, 4],
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
}

export const SPEAR_ABILITY: AbilityDef = {
  id: 'spear',
  name: 'Spear',
  cost: parseCost('0'),
  effects: [
    { type: 'chanceBoostDamage', base: 20, boosted: 30, successFaces: [1, 2, 3] },
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

export function monsterAbilities(monster: FieldMonster): AbilityDef[] {
  return [...getMonster(monster.defId).abilities, ...grantedAbilities(monster)]
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
])

function abilityDealsFireOrBlast(ability: AbilityDef): boolean {
  if (ability.special && FIRE_BLAST_SPECIALS.has(ability.special)) return true
  if (['fire_punch', 'overheat', 'explode', 'red_wakkle', 'fire_sword', 'burning_buck'].includes(ability.id)) {
    return true
  }
  return ability.effects.some(
    (effect) =>
      (effect.type === 'damage' ||
        effect.type === 'rollDamage' ||
        effect.type === 'chanceBoostDamage') &&
      (effect.damageType === 'fire' || effect.damageType === 'blast'),
  )
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
  'sound',
  'blast',
  'shadow',
  'wind',
  'earth',
]

export function formatDamageType(type: DamageType): string {
  if (type === 'sound') return 'sonic'
  return type
}

function abilityInflictsOrBoostsPoison(ability: AbilityDef): boolean {
  if (ability.special === 'bottleToxins') return true
  return ability.effects.some(
    (effect) =>
      ((effect.type === 'damage' ||
        effect.type === 'rollDamage' ||
        effect.type === 'chanceBoostDamage') &&
        effect.damageType === 'poison') ||
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

export function isStormling(defId: string): boolean {
  const card = getCard(defId)
  return card.kind === 'monster' && card.families?.includes('stormling') === true
}

export function countOtherStormlings(player: PlayerState, exceptInstanceId: string): number {
  return player.field.filter(
    (monster) => monster && monster.instanceId !== exceptInstanceId && isStormling(monster.defId),
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
  return getMonster(monster.defId).darkCharge === true
}

export function hasGoldAffinity(monster: FieldMonster): boolean {
  return getMonster(monster.defId).goldAffinity === true
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
  return ability.effects.some(
    (effect) =>
      (effect.type === 'damage' ||
        effect.type === 'rollDamage' ||
        effect.type === 'chanceBoostDamage') &&
      effect.damageType === type,
  )
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

export type CardSearchType = Exclude<DamageType, 'untyped'> | 'plant' | 'woody' | 'stormling' | 'blob'

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
  griefBolt: ['shadow'],
  bottleToxins: ['poison'],
  poisonGas: ['poison'],
  scent: ['poison'],
  groundShaker: ['earth'],
  underground: ['earth'],
  quake: ['earth'],
  magicMusic: ['sound'],
  soundWave: ['sound'],
  rocket: ['blast'],
  chaosFireworks: ['blast'],
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
    if (
      (effect.type === 'damage' ||
        effect.type === 'rollDamage' ||
        effect.type === 'chanceBoostDamage') &&
      effect.damageType &&
      effect.damageType !== 'untyped'
    ) {
      types.push(effect.damageType)
    }
  }
  return types
}

/** True when the card deals that damage type, or belongs to that family. Weakness does not count. */
export function cardMatchesSearchType(defId: string, type: CardSearchType): boolean {
  const card = getCard(defId)
  if (type === 'plant') return isPlant(defId)
  if (type === 'woody') return isWoody(defId)
  if (type === 'stormling') return isStormling(defId)
  if (type === 'blob') return isBlobMonster(defId)
  if (type === 'light' && card.kind === 'monster' && card.families?.includes('light')) return true
  if (card.kind === 'effect') return EFFECT_DAMAGE_TYPES[card.effectId]?.includes(type) === true
  if (card.kind !== 'monster') return false
  return card.abilities.some((ability) => abilitySearchDamageTypes(ability).includes(type))
}

export function countElectricCardsInPlay(player: PlayerState, exceptInstanceId?: string): number {
  return player.field.filter(
    (monster) =>
      monster &&
      monster.instanceId !== exceptInstanceId &&
      countsAsElectricCard(monster.defId),
  ).length
}
