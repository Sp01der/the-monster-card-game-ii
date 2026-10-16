export type PlayerId = 0 | 1

export type DamageType =
  | 'fire'
  | 'water'
  | 'ice'
  | 'poison'
  | 'electric'
  | 'light'
  | 'sound'
  | 'blast'
  | 'shadow'
  | 'wind'
  | 'earth'
  | 'untyped'

export type CardKind = 'monster' | 'effect' | 'equipment'

export type TurnPhase = 'draw' | 'main' | 'move' | 'energy' | 'end'

export type Stance = 'active' | 'withdrawn'

export type EnergyCost = {
  /** Empty dots: energy that must be attached (kept). */
  require: number
  /** Filled dots: energy consumed when used. */
  spend: number
}

export type StatusKind = 'goo' | 'frozen' | 'burn' | 'poison' | 'wet' | 'cling' | 'weakened'

export type StatusInstance = {
  kind: StatusKind
  /** Remaining end-step ticks. Burn deals damage each tick. */
  turns: number
  /** Status applied this turn does not tick until the next end step. */
  skipNextTick: boolean
  /** Used by Cling to identify the Rarkling maintaining it. */
  sourceInstanceId?: string
}

export type AbilityChoice =
  | 'firePunchFull'
  | 'firePunchBurn'
  | 'rainBlobs'
  | 'rainGoo'

export type AbilityEffect =
  | { type: 'damage'; amount: number; damageType?: DamageType; piercing?: boolean }
  | { type: 'rollDamage'; table: Record<number, number>; damageType?: DamageType }
  | { type: 'chanceBoostDamage'; base: number; boosted: number; successFaces: number[]; damageType?: DamageType }
  | { type: 'healSelf'; amount: number }
  | { type: 'status'; status: StatusKind; turns: number; stacks?: number }
  | { type: 'chanceStatus'; status: StatusKind; turns: number; successFaces: number[] }
  | { type: 'removeSelf' }
  | { type: 'choice'; options: AbilityChoice[] }

export type AbilityDef = {
  id: string
  name: string
  cost: EnergyCost
  free?: boolean
  ranged?: boolean
  /** Counts as an ice ability for effects such as Haunting Cry. */
  ice?: boolean
  /** Counts as a light ability. */
  light?: boolean
  /** Resolve this ability's effect list this many times (e.g. Sizzling Shell x2). */
  repeats?: number
  /** Named resolver for abilities whose rules are more than basic effects. */
  special?: string
  /** Targeting rule used by legal-action generation. */
  targetMode?: 'normal' | 'anyMonster' | 'otherMonster' | 'twoAnyMonsters'
  upgradeCost?: EnergyCost
  upgradeText?: string
  effects: AbilityEffect[]
}

export type MonsterDef = {
  kind: 'monster'
  id: string
  name: string
  points: number
  maxHp: number
  weakness?: DamageType
  weaknesses?: DamageType[]
  /** Listed weaknesses deal double damage, rounded to the nearest 10, before defense. */
  extremeWeakness?: boolean
  defense?: number
  families?: string[]
  passiveText?: string
  /** Printed tag: may receive extra energy in the energy phase by destroying discarded cards. */
  darkCharge?: boolean
  /** Printed tag: may hold Gold and spend it as energy. */
  goldAffinity?: boolean
  /** Energy phase: if this card didn’t act or change stance, it gains 1 energy. */
  idleEnergy?: boolean
  abilities: AbilityDef[]
}

export type EffectDef = {
  kind: 'effect'
  id: string
  name: string
  /** Structured resolution handled in reducer by id. */
  effectId: string
}

export type EquipmentDef = {
  kind: 'equipment'
  id: string
  name: string
  maxHp: number
  equipmentId: string
  /** Created during play. Hidden from the deck builder. */
  createdOnly?: boolean
  /** Damage and destroy effects cannot remove this equipment. */
  indestructible?: boolean
}

export type CardDef = MonsterDef | EffectDef | EquipmentDef

export type FieldMonster = {
  instanceId: string
  defId: string
  hp: number
  maxHp: number
  stance: Stance
  /** Energy that can be spent this turn. */
  energy: number
  /** Energy attached this turn; becomes usable next turn. */
  pendingEnergy: number
  statuses: StatusInstance[]
  equipment: FieldEquipment[]
  /** Spark changes the base manual energy pool to 3 for this turn. */
  sparkedThisTurn?: boolean
  /** Light support: this monster's damage can trigger Light weakness until its next turn. */
  illuminatedThisTurn?: boolean
  /** Rarkling's currently maintained target instance. */
  clingTargetInstanceId?: string
  /** Empower: this monster's next ability this turn does not spend the team action. */
  freeActionThisTurn?: boolean
  /** Extra ability uses this turn. They pay energy and do not spend the team action. */
  extraAbilityUses?: number
  /** Relentless: a hit that would slay this card leaves it at 10 HP until its controller's next turn. */
  unending?: boolean
  /** Knight's Honour: fatal hits on teammates redirect here until this controller's next turn. */
  honourGuardUntilNextTurn?: boolean
  /** Imilithia's Brew: replaces printed weaknesses. */
  weaknessOverride?: DamageType
  /** This monster is standing in front of the card with this instance id. */
  protectingInstanceId?: string
  /** Instance id of the monster currently protecting this card. */
  protectedByInstanceId?: string
  /** Fortify: bonus defense remains until this many damage packets land. */
  fortifyHitsLeft?: number
  /** Gold Affinity counter. Not equipment, and not taken by attacks. */
  gold?: number
  /** Occupies a slot that exists only while this monster remains in play. */
  ownsExtraSlot?: boolean
}

export type FieldEquipment = {
  instanceId: string
  defId: string
  hp: number
  maxHp: number
}

export type HandCard = {
  instanceId: string
  defId: string
}

export type PlayerState = {
  id: PlayerId
  name: string
  points: number
  deck: HandCard[]
  hand: HandCard[]
  discard: HandCard[]
  /** Cards permanently destroyed (not in discard). */
  removed: HandCard[]
  /** Spy mark: this instance must be discarded on the next forced discard if still in hand. */
  spyMarkInstanceId?: string
  /** Seven slots, plus a temporary slot for each Lovni's Weed that had nowhere else to go. */
  field: (FieldMonster | null)[]
  hasFinishedFirstTurn: boolean
  /** True until the player has completed their first turn. */
  isFirstTurn: boolean
  /** Number of upcoming energy phases this player must skip. */
  skipEnergyPhases: number
  /** Player-wide Ice Mirror reflections waiting to trigger. */
  iceMirrorCharges: number
  /** Lingering Energy: the next ability treats filled + as empty 0s (attached, not spent). */
  lingeringEnergy: boolean
  /** Monsters that have dealt damage to this player's cards this game. */
  damagedByInstanceIds?: string[]
  /** ATTACK!: added to this player's damaging hits before weakness, until the turn ends. */
  attackBonus?: number
}

export type LogEntry = {
  message: string
  /** Present when this entry records a die result. */
  dieRoll?: number
}

export type GameState = {
  players: [PlayerState, PlayerState]
  activePlayer: PlayerId
  phase: TurnPhase
  /** Whether the draw step has been completed or skipped. */
  drewThisTurn: boolean
  /** Paid team ability actions remaining (normally 1). */
  abilityUsesLeft: number
  /** Field slots that have already used an ability this turn (max one each). */
  actedSlots: number[]
  /** Slots that advanced or withdrew this turn. */
  movedSlots: number[]
  /** Whether a non-free card has been played this main phase. */
  playedCardThisTurn: boolean
  /** Whether withdraw/advance has been used this turn. */
  movedThisTurn: boolean
  /** Whether energy was attached this turn. */
  attachedEnergyThisTurn: boolean
  /** Remaining energy points the player can distribute in this energy phase. */
  energyPool: number
  /** Energy that can only be attached to a blob. Lost if the phase is skipped. */
  blobEnergyPool: number
  /** Bannerman energy. Only a monster you control worth 2 points or less can take it. */
  bannerEnergyPool: number
  /** An ability/effect may skip the entire energy phase. */
  skipEnergyPhase: boolean
  /** Prevents status effects resolving twice if a death passive pauses END_TURN. */
  endStepResolved: boolean
  /** Multi-step resolutions that require another player choice. */
  pending: PendingInteraction | null
  /** Paused interactions to resume after a nested pending effect finishes. */
  pendingStack: PendingInteraction[]
  /** True when waiting for pass-the-device cover before revealing hand. */
  awaitingHandoff: boolean
  winner: PlayerId | null
  log: LogEntry[]
  /** Optional injectable RNG for tests (returns 1-6). */
  rng: () => number
  /** Uniform random float in [0,1), used for shuffles/random card selection. */
  random: () => number
  nextInstanceId: number
}

export type PendingInteraction =
  | {
      kind: 'rainChoice'
      owner: PlayerId
    }
  | {
      kind: 'multiHit'
      sourcePlayer: PlayerId
      sourceSlot: number
      remaining: number
      amount: number
      damageType: DamageType
      requiredEnergy: number
      piercing?: boolean
      statusChanceFaces?: number[]
      status?: StatusKind
      statusTurns?: number
      /** Each hit rolls. Spear is 20, or 30 on a 2/6. Chomp is 30 or 40. */
      strike?: 'spear' | 'chomp'
      /** Any card on either side, instead of a normal attack. */
      scope?: 'any'
      /** Cards already hit, so the next choice must be a different card. */
      excludeInstanceIds?: string[]
    }
  | {
      kind: 'stormType'
      sourcePlayer: PlayerId
      sourceSlot: number
      amount: number
      requiredEnergy: number
    }
  | {
      kind: 'forceWithdraw'
      player: PlayerId
      slot: number
    }
  | {
      kind: 'plasmaCannon'
      sourcePlayer: PlayerId
      sourceSlot: number
      hits: number
      misses: number
      requiredEnergy: number
    }
  | {
      kind: 'soundWave'
      sourcePlayer: PlayerId
      sourceSlot: number
      chosenInstanceIds: string[]
      requiredEnergy: number
    }
  | {
      kind: 'repeatGoo'
      sourcePlayer: PlayerId
      sourceSlot: number
    }
  | {
      kind: 'trickery'
      owner: PlayerId
      opponent: PlayerId
      card: HandCard
    }
  | {
      kind: 'spawnBlobs'
      owner: PlayerId
      remaining: number
      queue: Array<{ owner: PlayerId; remaining: number }>
    }
  | {
      kind: 'rainBlobs'
      owner: PlayerId
      played: number
    }
  | {
      kind: 'rainGoo'
      owner: PlayerId
      remaining: number
      chosenInstanceIds: string[]
    }
  | {
      kind: 'bury'
      owner: PlayerId
      chosenInstanceIds: string[]
      purpose: 'absorb' | 'hunt' | 'whirlpool' | 'churn'
      sourceSlot?: number
      requiredEnergy?: number
      target?: TargetRef
    }
  | {
      kind: 'discardPick'
      owner: PlayerId
      pileOwner: PlayerId
    }
  | {
      kind: 'freezeTargets'
      sourcePlayer: PlayerId
      sourceSlot: number
      remaining: number
      turns: number
      chosenInstanceIds: string[]
      discardPlayer?: PlayerId
    }
  | {
      kind: 'handDiscard'
      player: PlayerId
      remaining: number
      /** After this player finishes, each listed player discards one card. */
      thenPlayers?: PlayerId[]
    }
  | {
      kind: 'spy'
      owner: PlayerId
    }
  | {
      kind: 'griefDestroy'
      owner: PlayerId
      chosenInstanceIds: string[]
    }
  | {
      kind: 'transmuteHand'
      owner: PlayerId
    }
  | {
      kind: 'transmuteFetch'
      owner: PlayerId
    }
  | {
      kind: 'brewWeakness'
      owner: PlayerId
      target: TargetRef
    }
  | {
      kind: 'march'
      owner: PlayerId
      chosenSlots: number[]
    }
  | {
      kind: 'playCards'
      owner: PlayerId
      played: number
    }
  | {
      kind: 'eldersEye'
      owner: PlayerId
      /** Top of the deck, removed until the player orders them. */
      cards: HandCard[]
      /** Instance ids from top to bottom. */
      order: string[]
    }
  | {
      kind: 'keystone'
      owner: PlayerId
      chosenInstanceIds: string[]
    }
  | {
      kind: 'hoardChoice'
      owner: PlayerId
    }
  | {
      kind: 'assignGold'
      owner: PlayerId
      remaining: number
      /** Draw one card after the last gold is placed. */
      drawAfter?: boolean
    }
  | {
      kind: 'fairyHeal'
      owner: PlayerId
      remaining: number
    }
  | {
      kind: 'placeWeed'
      owner: PlayerId
    }

export type TargetRef =
  | { kind: 'monster'; player: PlayerId; slot: number }
  | { kind: 'equipment'; player: PlayerId; slot: number; equipmentIndex: number }

export type GameAction =
  | { type: 'DRAW' }
  | { type: 'SKIP_DRAW' }
  | {
      type: 'USE_ABILITY'
      slot: number
      abilityId: string
      target?: TargetRef
      targets?: TargetRef[]
      choice?: AbilityChoice
      extraEnergy?: number
      /** Empty-dot cost covered by Gold. That Gold stays. */
      goldRequire?: number
      /** Filled-dot cost covered by Gold. That Gold is removed. */
      goldSpend?: number
    }
  | { type: 'ASSIGN_GOLD'; slot: number }
  | { type: 'HOARD_CHOICE'; mode: 'gold' | 'card' }
  | {
      type: 'PLAY_MONSTER'
      handIndex: number
      slot: number
      stance: Stance
    }
  | {
      type: 'PLAY_EFFECT'
      handIndex: number
      /** One or two targets depending on the effect. */
      targets: TargetRef[]
    }
  | {
      type: 'PLAY_EQUIPMENT'
      handIndex: number
      slot: number
    }
  | { type: 'SKIP_MAIN' }
  | { type: 'WITHDRAW'; slot: number }
  | { type: 'ADVANCE'; slot: number }
  | { type: 'SKIP_MOVE' }
  | { type: 'ATTACH_ENERGY'; slot: number }
  | { type: 'FINISH_ENERGY' }
  | { type: 'SKIP_ENERGY' }
  | { type: 'UNGOO'; slot: number }
  | { type: 'RESIST_CLING'; slot: number }
  | { type: 'PENDING_TARGET'; target: TargetRef }
  | { type: 'TRICKERY_PLACE'; deckIndex: number }
  | { type: 'SPAWN_BLOB'; slot: number; stance: Stance }
  | { type: 'RAIN_CHOOSE_MODE'; mode: 'blobs' | 'goo' }
  | { type: 'RAIN_PLAY_BLOB'; handIndex: number; slot: number; stance: Stance }
  | { type: 'RAIN_FINISH_BLOBS' }
  | { type: 'RAIN_GOO_TARGET'; target: TargetRef }
  | { type: 'BURY_TOGGLE'; instanceId: string }
  | { type: 'BURY_FINISH' }
  | { type: 'PICK_DISCARD'; instanceId: string }
  | { type: 'FREEZE_TARGET'; target: TargetRef }
  | { type: 'DISCARD_FROM_HAND'; instanceId: string }
  | { type: 'MARCH_TOGGLE'; slot: number }
  | { type: 'MARCH_FINISH' }
  | { type: 'PORTAL_FINISH' }
  | { type: 'SPY_MARK'; instanceId: string }
  | { type: 'SPY_SKIP' }
  | { type: 'GRIEF_TOGGLE'; instanceId: string }
  | { type: 'GRIEF_FINISH' }
  | { type: 'TRANSMUTE_DESTROY'; instanceId: string }
  | { type: 'TRANSMUTE_FETCH'; instanceId: string }
  | { type: 'BREW_WEAKNESS'; damageType: DamageType }
  | { type: 'DARK_CHARGE'; slot: number; discardInstanceId: string }
  | { type: 'PLASMA_ROLL' }
  | { type: 'PLASMA_FIRE'; target: TargetRef }
  | { type: 'SOUND_WAVE_TARGET'; target: TargetRef }
  | { type: 'SOUND_WAVE_FINISH' }
  | { type: 'ELDERS_PICK'; instanceId: string }
  | { type: 'BEGIN_KEYSTONE' }
  | { type: 'KEYSTONE_TOGGLE'; instanceId: string }
  | { type: 'KEYSTONE_ATTACH'; slot: number }
  | { type: 'KEYSTONE_CANCEL' }
  | { type: 'FAIRY_HEAL'; target: TargetRef }
  | { type: 'PLACE_WEED'; slot: number; stance: Stance }
  | { type: 'STORM_TYPE'; damageType: 'electric' | 'water' }
  | { type: 'FORCE_WITHDRAW'; accept: boolean }
  | { type: 'END_TURN' }
  | { type: 'CONFIRM_HANDOFF' }

export const FIELD_SIZE = 7
export const STARTING_POINTS = 6
export const STARTING_HAND = 4
