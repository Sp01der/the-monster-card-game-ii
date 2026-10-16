export type StarterDeck = {
  id: string
  name: string
  blurb: string
  counts: Record<string, number>
  topMonsterId: string
}

function starter(
  id: string,
  name: string,
  blurb: string,
  topMonsterId: string,
  copies: Record<string, number>,
): StarterDeck {
  const counts: Record<string, number> = {}
  counts[topMonsterId] = copies[topMonsterId] ?? 0
  for (const [cardId, n] of Object.entries(copies)) counts[cardId] = n
  return { id, name, blurb, topMonsterId, counts }
}

/** Themed decks for quick matches. Read-only templates, not saved user decks. */
export const STARTERS: StarterDeck[] = [
  starter(
    'ember',
    'Ember',
    'Fire attackers, Coffee, Ruby Rings, and Rally.',
    'fire_sprite',
    {
      fire_sprite: 2,
      ember_tortoise: 2,
      bomber_beetle: 2,
      lava_lizels: 2,
      sun_sprite: 1,
      blazing_stallion: 1,
      rocketeer: 1,
      red_knight: 1,
      coffee: 2,
      ruby_ring: 2,
      rally: 2,
      health_potion: 2,
      falling_anvil: 1,
    },
  ),
  starter(
    'frost',
    'Frost',
    'Ice control with Blizzard, Ice Mirror, and Shields.',
    'ice_core',
    {
      ice_core: 2,
      frost_hawk: 2,
      winter_wizard: 2,
      chill_sprite: 2,
      glacier_golem: 1,
      two_tailed_frost_biter: 1,
      aquatic_lightning: 1,
      ice_mirror: 2,
      blizzard: 2,
      shield: 2,
      health_potion: 2,
      coffee: 2,
      energy_crystal: 1,
    },
  ),
  starter(
    'tide',
    'Tide',
    'Blobs and water, backed by Rain of Goo.',
    'blob',
    {
      blob: 2,
      big_blob: 2,
      red_blob: 2,
      purple_blob: 2,
      water_lizel: 2,
      hydro_core: 2,
      fisher_mirel: 1,
      navit_gel: 1,
      rain_of_goo: 2,
      whirlpool: 1,
      churn_waters: 1,
      fishing_rod: 2,
      health_potion: 1,
      coffee: 1,
    },
  ),
  starter(
    'gloom',
    'Gloom',
    'Shadow monsters and Famine.',
    'shadow_imp',
    {
      shadow_imp: 2,
      grief_soldier: 2,
      imilthian_alchemist: 2,
      leecher: 2,
      drowned_pirate: 2,
      orc: 1,
      malvistra: 1,
      famine: 2,
      scroll_wisdom: 1,
      health_potion: 2,
      coffee: 2,
      sword: 2,
      shield: 1,
    },
  ),
]

export const DEFAULT_STARTER_IDS = ['ember', 'frost'] as const

export function starterById(id: string): StarterDeck | undefined {
  return STARTERS.find((starter) => starter.id === id)
}

export function cardIdsFromCounts(counts: Record<string, number>): string[] {
  const cardIds: string[] = []
  for (const [id, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) cardIds.push(id)
  }
  return cardIds
}
