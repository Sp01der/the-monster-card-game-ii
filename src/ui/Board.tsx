import { useMemo, useState } from 'react'
import {
  applyAction,
  formatDamageType,
  getCard,
  getMonster,
  guardingGoldDefense,
  isUndoablePhaseAction,
  monsterAbilities,
  listLegalActions,
  type AbilityChoice,
  type GameAction,
  type GameState,
  type Stance,
  type TargetRef,
} from '../game'
import { CardFace } from './CardFace'

type Props = {
  state: GameState
  onChange: (next: GameState) => void
  onNewGame: () => void
}

type UiSel =
  | { kind: 'none' }
  | { kind: 'hand'; handIndex: number }
  | {
      kind: 'ability'
      slot: number
      abilityId: string
      choice?: AbilityChoice
      extraEnergy?: number
      goldRequire?: number
      goldSpend?: number
    }
  | { kind: 'abilityChoice'; slot: number; abilityId: string }
  | { kind: 'abilityExtra'; slot: number; abilityId: string; options: number[] }
  | {
      kind: 'abilityGold'
      slot: number
      abilityId: string
      choice?: AbilityChoice
      extraEnergy?: number
      options: { goldRequire: number; goldSpend: number }[]
    }
  | {
      kind: 'abilityMulti'
      slot: number
      abilityId: string
      first?: TargetRef
      goldRequire?: number
      goldSpend?: number
    }
  | { kind: 'rainBlob'; handIndex: number }
  | { kind: 'darkChargeDiscard' }
  | { kind: 'darkChargeTarget'; discardInstanceId: string }

function targetKey(t: TargetRef): string {
  if (t.kind === 'monster') return `m-${t.player}-${t.slot}`
  return `e-${t.player}-${t.slot}-${t.equipmentIndex}`
}

function describeAction(state: GameState, action: GameAction): string {
  switch (action.type) {
    case 'DRAW':
      return 'Draw a card'
    case 'SKIP_DRAW':
      return 'Skip draw'
    case 'SKIP_MAIN':
      return 'Done with main phase'
    case 'SKIP_MOVE':
      return 'Skip withdraw / advance'
    case 'SKIP_ENERGY':
      return 'Skip energy'
    case 'FINISH_ENERGY':
      return 'Finish energy phase'
    case 'END_TURN':
      return 'End turn'
    case 'CONFIRM_HANDOFF':
      return `Start ${state.players[state.activePlayer].name}'s turn`
    case 'WITHDRAW':
      return `Withdraw ${getMonster(state.players[state.activePlayer].field[action.slot]!.defId).name}`
    case 'ADVANCE':
      return `Advance ${getMonster(state.players[state.activePlayer].field[action.slot]!.defId).name}`
    case 'ATTACH_ENERGY':
      return `Attach energy to ${getMonster(state.players[state.activePlayer].field[action.slot]!.defId).name}`
    case 'UNGOO':
      return `Ungoo ${getMonster(state.players[state.activePlayer].field[action.slot]!.defId).name}`
    case 'USE_ABILITY': {
      const m = state.players[state.activePlayer].field[action.slot]!
      const ab = monsterAbilities(m).find((a) => a.id === action.abilityId)!
      const choice =
        action.choice === 'firePunchFull'
          ? ' — 30 fire'
          : action.choice === 'firePunchBurn'
            ? ' — 10 fire + burn'
            : ''
      return `${getMonster(m.defId).name}: ${ab.name}${choice}`
    }
    case 'PLAY_MONSTER':
      return `Play ${getCard(state.players[state.activePlayer].hand[action.handIndex].defId).name}`
    case 'PLAY_EFFECT':
      return `Play ${getCard(state.players[state.activePlayer].hand[action.handIndex].defId).name}`
    case 'PLAY_EQUIPMENT':
      return `Equip ${getCard(state.players[state.activePlayer].hand[action.handIndex].defId).name}`
    case 'RESIST_CLING':
      return 'Spend 1 energy to resist Cling'
    case 'PENDING_TARGET':
      return 'Choose target'
    case 'TRICKERY_PLACE':
      return `Place at deck position ${action.deckIndex + 1}`
    case 'SPAWN_BLOB':
      return `Spawn Blob ${action.stance} in slot ${action.slot + 1}`
    case 'RAIN_CHOOSE_MODE':
      return action.mode === 'blobs' ? 'Play Blob cards' : 'Goo three cards'
    case 'RAIN_PLAY_BLOB':
      return `Play Blob ${action.stance} in slot ${action.slot + 1}`
    case 'RAIN_FINISH_BLOBS':
      return 'Finish playing Blobs'
    case 'RAIN_GOO_TARGET':
      return 'Goo target'
    case 'BURY_TOGGLE':
      return 'Select card to bury'
    case 'BURY_FINISH':
      return 'Finish burying'
    case 'PICK_DISCARD':
      return 'Take card from discard'
    case 'FREEZE_TARGET':
      return 'Freeze target'
    case 'DISCARD_FROM_HAND':
      return 'Discard card'
    case 'MARCH_TOGGLE':
      return 'Toggle withdraw / advance'
    case 'MARCH_FINISH':
      return 'Finish marching'
    case 'PORTAL_FINISH':
      return 'Finish playing cards'
    case 'SPY_MARK':
      return 'Mark this card'
    case 'SPY_SKIP':
      return 'Leave unmarked'
    case 'GRIEF_TOGGLE':
      return 'Select discarded card'
    case 'GRIEF_FINISH':
      return 'Finish Grief Bolt'
    case 'TRANSMUTE_DESTROY':
      return 'Destroy this card'
    case 'TRANSMUTE_FETCH':
      return 'Take this card'
    case 'BREW_WEAKNESS':
      return `Weakness: ${formatDamageType(action.damageType)}`
    case 'DARK_CHARGE':
      return 'Dark Charge'
    case 'PLASMA_ROLL':
      return 'Roll again'
    case 'PLASMA_FIRE':
      return 'Fire Plasma Cannon'
    case 'SOUND_WAVE_TARGET':
      return 'Choose Sound Wave target'
    case 'SOUND_WAVE_FINISH':
      return 'Finish Sound Wave'
    case 'ELDERS_PICK':
      return 'Place this card next'
    case 'BEGIN_KEYSTONE':
      return 'Forge Colossus Keystone'
    case 'KEYSTONE_TOGGLE':
      return 'Choose a card to destroy'
    case 'KEYSTONE_ATTACH':
      return 'Attach the Keystone'
    case 'KEYSTONE_CANCEL':
      return 'Cancel Keystone'
    case 'ASSIGN_GOLD':
      return `Give gold to ${getMonster(state.players[state.activePlayer].field[action.slot]!.defId).name}`
    case 'HOARD_CHOICE':
      return action.mode === 'gold' ? 'Gain 3 gold' : 'Gain 1 gold and draw a card'
    case 'FAIRY_HEAL':
      return 'Heal 10 HP'
    case 'PLACE_WEED':
      return `Place Lovni's Weed ${action.stance}`
    case 'STORM_TYPE':
      return action.damageType === 'electric' ? 'Electric' : 'Water'
    case 'FORCE_WITHDRAW':
      return action.accept ? 'Force withdraw' : 'Leave in place'
  }
}

function goldPaymentLabel(goldRequire: number, goldSpend: number): string {
  if (goldRequire === 0 && goldSpend === 0) return 'Pay with energy'
  const parts: string[] = []
  if (goldSpend > 0) parts.push(`spend ${goldSpend} gold`)
  if (goldRequire > 0) parts.push(`keep ${goldRequire} gold`)
  return parts.join(', ')
}

function sameGold(
  action: { goldRequire?: number; goldSpend?: number },
  sel: { goldRequire?: number; goldSpend?: number },
): boolean {
  return (action.goldRequire ?? 0) === (sel.goldRequire ?? 0) && (action.goldSpend ?? 0) === (sel.goldSpend ?? 0)
}

const DIE_GLYPHS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'] as const

function DieResult({ value }: { value: number }) {
  return (
    <div className="die-result" role="status" aria-label={`Die roll: ${value}`}>
      <span className="die-label">Last roll</span>
      <span className="die-face" aria-hidden="true">
        {DIE_GLYPHS[value - 1]}
      </span>
      <strong>{value}</strong>
    </div>
  )
}

export function Board({ state, onChange, onNewGame }: Props) {
  const [sel, setSel] = useState<UiSel>({ kind: 'none' })
  const [undoStack, setUndoStack] = useState<GameState[]>([])
  const [rallyFirst, setRallyFirst] = useState<TargetRef | null>(null)
  const [discardView, setDiscardView] = useState<0 | 1 | null>(null)
  const legal = useMemo(() => listLegalActions(state), [state])
  const active = state.players[state.activePlayer]
  const inactive = state.players[state.activePlayer === 0 ? 1 : 0]
  const canDraw = legal.some((a) => a.type === 'DRAW')
  const lastRoll = state.log.findLast((entry) => entry.dieRoll !== undefined)?.dieRoll

  function dispatch(action: GameAction) {
    setUndoStack((stack) => (isUndoablePhaseAction(action) ? [...stack, state] : []))
    const next = applyAction(state, action)
    setSel({ kind: 'none' })
    setRallyFirst(null)
    onChange(next)
  }

  function undo() {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setUndoStack((stack) => stack.slice(0, -1))
    setSel({ kind: 'none' })
    setRallyFirst(null)
    onChange(previous)
  }

  const undoButton =
    undoStack.length > 0 ? (
      <button type="button" className="secondary" onClick={undo}>
        Undo
      </button>
    ) : null

  if (state.awaitingHandoff) {
    return (
      <div className="handoff">
        <div className="handoff-card">
          <h1>Pass the device</h1>
          <p>
            Hand the computer to <strong>{active.name}</strong>.
          </p>
          <button type="button" className="primary" onClick={() => dispatch({ type: 'CONFIRM_HANDOFF' })}>
            {active.name}, start your turn
          </button>
          {undoButton}
        </div>
      </div>
    )
  }

  if (state.winner !== null) {
    const winner = state.players[state.winner]
    return (
      <div className="handoff">
        <div className="handoff-card">
          <h1>{winner.name} wins!</h1>
          <button type="button" className="primary" onClick={onNewGame}>
            New game
          </button>
          <div className="log-box win-log">
            {state.log.slice(-12).map((e, i) => (
              <p key={i}>{e.message}</p>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Highlight legal targets given current selection
  const highlightTargets = new Set<string>()
  let prompt = ''

  if (state.pending?.kind === 'assignGold') {
    prompt = `Give this gold to a Gold Affinity card (${state.pending.remaining} remaining).`
    for (const action of legal) {
      if (action.type === 'ASSIGN_GOLD') {
        highlightTargets.add(`mon-${state.pending.owner}-${action.slot}`)
      }
    }
  } else if (state.pending?.kind === 'hoardChoice') {
    prompt = 'Treasure Hoard: gain 3 gold, or gain 1 gold and draw a card.'
  } else if (state.pending?.kind === 'stormType') {
    prompt = 'Bring the STORM: choose electric or water.'
  } else if (state.pending?.kind === 'forceWithdraw') {
    const monster = state.players[state.pending.player].field[state.pending.slot]
    prompt = monster
      ? `Force ${getMonster(monster.defId).name} to withdraw?`
      : 'Force the target to withdraw?'
  } else if (state.pending?.kind === 'multiHit' || state.pending?.kind === 'repeatGoo') {
    prompt =
      state.pending.kind === 'multiHit'
        ? `Choose hit target (${state.pending.remaining} remaining).`
        : 'Choose the second Goo target.'
    for (const a of legal) if (a.type === 'PENDING_TARGET') highlightTargets.add(targetKey(a.target))
  } else if (state.pending?.kind === 'rainGoo') {
    prompt = `Choose Goo target (${state.pending.remaining} remaining).`
    for (const a of legal) if (a.type === 'RAIN_GOO_TARGET') highlightTargets.add(targetKey(a.target))
  } else if (state.pending?.kind === 'bury') {
    prompt = `Choose cards to bury (${state.pending.chosenInstanceIds.length} selected).`
  } else if (state.pending?.kind === 'eldersEye') {
    prompt = `Arrange the top of your deck (${state.pending.order.length + 1} of ${state.pending.cards.length} is next). The first card is drawn.`
  } else if (state.pending?.kind === 'keystone') {
    prompt =
      state.pending.chosenInstanceIds.length < 3
        ? `Destroy 3 cards from your hand (${state.pending.chosenInstanceIds.length} chosen).`
        : 'Choose your Colossus to attach the Keystone.'
  } else if (state.pending?.kind === 'discardPick') {
    prompt = 'Choose a card from the discard pile.'
  } else if (state.pending?.kind === 'freezeTargets') {
    prompt = `Choose a monster to Freeze (${state.pending.remaining} remaining).`
    for (const action of legal) {
      if (action.type === 'FREEZE_TARGET') highlightTargets.add(targetKey(action.target))
    }
  } else if (state.pending?.kind === 'handDiscard') {
    const who = state.players[state.pending.player].name
    prompt =
      state.pending.remaining > 1
        ? `${who} must discard ${state.pending.remaining} cards.`
        : `${who} must choose a card to discard.`
  } else if (state.pending?.kind === 'spy') {
    prompt = "View the opponent's hand. Mark a card or skip."
  } else if (state.pending?.kind === 'griefDestroy') {
    prompt = `Destroy up to two discarded cards (${state.pending.chosenInstanceIds.length} selected).`
  } else if (state.pending?.kind === 'transmuteHand') {
    prompt = 'Destroy a card in your hand.'
  } else if (state.pending?.kind === 'transmuteFetch') {
    prompt = 'Take a card from your discard or deck.'
  } else if (state.pending?.kind === 'brewWeakness') {
    prompt = 'Choose the new weakness.'
  } else if (state.pending?.kind === 'plasmaCannon') {
    prompt = `Plasma Cannon: ${state.pending.hits} hit${state.pending.hits === 1 ? '' : 's'} (${state.pending.hits * 20} electric), ${state.pending.misses} miss${state.pending.misses === 1 ? '' : 'es'}. Roll again${state.pending.hits >= 1 ? ' or click a target to fire' : ''}.`
    if (state.pending.hits >= 1) {
      for (const a of legal) {
        if (a.type === 'PLASMA_FIRE') highlightTargets.add(targetKey(a.target))
      }
    }
  } else if (state.pending?.kind === 'soundWave') {
    prompt = `Choose Sound Wave targets (${state.pending.chosenInstanceIds.length}/3), then finish.`
    for (const a of legal) {
      if (a.type === 'SOUND_WAVE_TARGET') highlightTargets.add(targetKey(a.target))
    }
  } else if (state.pending?.kind === 'fairyHeal') {
    prompt = `Green Fairy: choose a card to heal 10 HP (${state.pending.remaining} remaining).`
    for (const action of legal) {
      if (action.type === 'FAIRY_HEAL') highlightTargets.add(targetKey(action.target))
    }
  } else if (state.pending?.kind === 'placeWeed') {
    prompt = "Place Lovni's Weed on the front (active) or back (withdrawn)."
    for (const action of legal) {
      if (action.type === 'PLACE_WEED') {
        highlightTargets.add(`slot-${state.pending.owner}-${action.slot}-${action.stance}`)
      }
    }
  } else if (state.pending?.kind === 'spawnBlobs') {
    prompt = `Place generated Blob (${state.pending.remaining} remaining).`
    for (const a of legal) {
      if (a.type === 'SPAWN_BLOB') {
        highlightTargets.add(`slot-${state.pending.owner}-${a.slot}-${a.stance}`)
      }
    }
  } else if (sel.kind === 'rainBlob' && state.pending?.kind === 'rainBlobs') {
    prompt = 'Place this Blob active or withdrawn.'
    for (const a of legal) {
      if (a.type === 'RAIN_PLAY_BLOB' && a.handIndex === sel.handIndex) {
        highlightTargets.add(`slot-${state.pending.owner}-${a.slot}-${a.stance}`)
      }
    }
  } else if (sel.kind === 'hand') {
    const card = active.hand[sel.handIndex]
    const def = getCard(card.defId)
    if (def.kind === 'monster') {
      prompt = 'Place on the front (active) or back (withdrawn) of an empty slot.'
      for (const a of legal) {
        if (a.type === 'PLAY_MONSTER' && a.handIndex === sel.handIndex) {
          highlightTargets.add(`slot-${active.id}-${a.slot}-${a.stance}`)
        }
      }
    } else if (def.kind === 'equipment') {
      prompt = 'Choose one of your monsters to equip.'
      for (const a of legal) {
        if (a.type === 'PLAY_EQUIPMENT' && a.handIndex === sel.handIndex) {
          highlightTargets.add(`mon-${active.id}-${a.slot}`)
        }
      }
    } else {
      prompt =
        def.effectId === 'rally'
          ? rallyFirst
            ? 'Choose the second monster for Rally.'
            : 'Choose the first monster for Rally.'
          : 'Choose a target.'
      for (const a of legal) {
        if (a.type !== 'PLAY_EFFECT' || a.handIndex !== sel.handIndex) continue
        if (def.effectId === 'rally' && rallyFirst) {
          const [t0, t1] = a.targets
          if (actionsEqualTargets(t0, rallyFirst)) highlightTargets.add(targetKey(t1))
          if (actionsEqualTargets(t1, rallyFirst)) highlightTargets.add(targetKey(t0))
        } else if (a.targets[0]) {
          highlightTargets.add(targetKey(a.targets[0]))
          if (def.effectId === 'rally' && a.targets[1]) {
            highlightTargets.add(targetKey(a.targets[1]))
          }
        }
      }
    }
  } else if (state.pending?.kind === 'playCards') {
    prompt = 'Play any number of cards from your hand, then finish.'
  } else if (state.pending?.kind === 'march') {
    prompt = 'Click your cards to withdraw or advance them, then finish.'
    for (const action of legal) {
      if (action.type === 'MARCH_TOGGLE') {
        highlightTargets.add(`mon-${state.pending.owner}-${action.slot}`)
      }
    }
  } else if (sel.kind === 'ability') {
    prompt = 'Choose a target.'
    for (const a of legal) {
      if (
        a.type === 'USE_ABILITY' &&
        a.slot === sel.slot &&
        a.abilityId === sel.abilityId &&
        a.choice === sel.choice &&
        a.extraEnergy === sel.extraEnergy &&
        sameGold(a, sel) &&
        a.target
      ) {
        highlightTargets.add(targetKey(a.target))
      }
    }
  } else if (sel.kind === 'abilityMulti') {
    prompt =
      sel.abilityId === 'bottle_toxins' ||
      sel.abilityId === 'burning_breath' ||
      sel.abilityId === 'poison_gas'
        ? sel.first
          ? 'Choose an adjacent card.'
          : 'Choose the first of two adjacent cards.'
        : sel.first
          ? 'Choose the destination monster.'
          : 'Choose a source with energy.'
    for (const a of legal) {
      if (a.type !== 'USE_ABILITY' || a.slot !== sel.slot || a.abilityId !== sel.abilityId) continue
      if (!sameGold(a, sel)) continue
      const [source, destination] = a.targets ?? []
      if (!source || !destination) continue
      if (!sel.first) highlightTargets.add(targetKey(source))
      else if (actionsEqualTargets(source, sel.first)) highlightTargets.add(targetKey(destination))
    }
  } else if (sel.kind === 'darkChargeDiscard') {
    prompt = 'Choose a discarded card to destroy.'
  } else if (sel.kind === 'darkChargeTarget') {
    prompt = 'Choose a Dark Charge monster to attach the extra energy.'
    for (const a of legal) {
      if (a.type === 'DARK_CHARGE' && a.discardInstanceId === sel.discardInstanceId) {
        highlightTargets.add(`mon-${state.activePlayer}-${a.slot}`)
      }
    }
  } else if (state.phase === 'move') {
    prompt = 'Withdraw or advance one card, or skip.'
  } else if (state.phase === 'energy') {
    const pools = [
      state.energyPool > 0 ? `${state.energyPool} energy` : null,
      state.blobEnergyPool > 0 ? `${state.blobEnergyPool} blob energy` : null,
      state.bannerEnergyPool > 0 ? `${state.bannerEnergyPool} legion energy` : null,
    ].filter(Boolean)
    const remaining = pools.length > 0 ? pools.join(' and ') : 'no energy'
    prompt = legal.some((a) => a.type === 'DARK_CHARGE')
      ? pools.length > 0
        ? `Distribute ${remaining}. You may Dark Charge.`
        : 'You may Dark Charge, or end your turn.'
      : `Distribute ${remaining}, or skip the rest.`
  } else if (state.phase === 'draw') {
    prompt = 'Click your draw pile to draw, or skip.'
  } else if (state.phase === 'main') {
    prompt = active.isFirstTurn
      ? 'First turn: play a monster to the front (active) or back (withdrawn).'
      : 'Click an ability on your card, and/or play a card from hand.'
  } else if (state.phase === 'end') {
    prompt = 'End your turn to resolve status effects.'
  }

  function onFieldSlotClick(playerId: 0 | 1, slot: number, stance?: Stance) {
    const clicked: TargetRef = { kind: 'monster', player: playerId, slot }
    if (state.pending?.kind === 'assignGold' && playerId === state.pending.owner) {
      const action = legal.find((a) => a.type === 'ASSIGN_GOLD' && a.slot === slot)
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'march' && playerId === state.pending.owner) {
      const action = legal.find((a) => a.type === 'MARCH_TOGGLE' && a.slot === slot)
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'fairyHeal') {
      const action = legal.find(
        (a) => a.type === 'FAIRY_HEAL' && actionsEqualTargets(a.target, clicked),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'multiHit' || state.pending?.kind === 'repeatGoo') {
      const action = legal.find(
        (a) => a.type === 'PENDING_TARGET' && actionsEqualTargets(a.target, clicked),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'rainGoo') {
      const action = legal.find(
        (a) => a.type === 'RAIN_GOO_TARGET' && actionsEqualTargets(a.target, clicked),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'freezeTargets') {
      const action = legal.find(
        (a) => a.type === 'FREEZE_TARGET' && actionsEqualTargets(a.target, clicked),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'plasmaCannon') {
      const action = legal.find(
        (a) => a.type === 'PLASMA_FIRE' && actionsEqualTargets(a.target, clicked),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'soundWave') {
      const action = legal.find(
        (a) => a.type === 'SOUND_WAVE_TARGET' && actionsEqualTargets(a.target, clicked),
      )
      if (action) dispatch(action)
      return
    }
    if (
      state.pending?.kind === 'placeWeed' &&
      playerId === state.pending.owner &&
      stance
    ) {
      const action = legal.find(
        (a) => a.type === 'PLACE_WEED' && a.slot === slot && a.stance === stance,
      )
      if (action) dispatch(action)
      return
    }
    if (
      state.pending?.kind === 'spawnBlobs' &&
      playerId === state.pending.owner &&
      stance
    ) {
      const action = legal.find(
        (a) => a.type === 'SPAWN_BLOB' && a.slot === slot && a.stance === stance,
      )
      if (action) dispatch(action)
      return
    }
    if (
      state.pending?.kind === 'rainBlobs' &&
      playerId === state.pending.owner &&
      sel.kind === 'rainBlob' &&
      stance
    ) {
      const action = legal.find(
        (a) =>
          a.type === 'RAIN_PLAY_BLOB' &&
          a.handIndex === sel.handIndex &&
          a.slot === slot &&
          a.stance === stance,
      )
      if (action) dispatch(action)
      return
    }
    if (sel.kind === 'hand') {
      if (stance) {
        const playMon = legal.find(
          (a) =>
            a.type === 'PLAY_MONSTER' &&
            a.handIndex === sel.handIndex &&
            a.slot === slot &&
            a.stance === stance &&
            playerId === active.id,
        )
        if (playMon) {
          dispatch(playMon)
          return
        }
      }
      const playEq = legal.find(
        (a) =>
          a.type === 'PLAY_EQUIPMENT' &&
          a.handIndex === sel.handIndex &&
          a.slot === slot &&
          playerId === active.id,
      )
      if (playEq) {
        dispatch(playEq)
        return
      }
      const card = active.hand[sel.handIndex]
      const def = getCard(card.defId)
      if (def.kind === 'effect') {
        if (def.effectId === 'rally') {
          const monster = state.players[playerId].field[slot]
          if (!monster) return
          const t: TargetRef = { kind: 'monster', player: playerId, slot }
          if (!rallyFirst) {
            setRallyFirst(t)
            return
          }
          const play = legal.find(
            (a) =>
              a.type === 'PLAY_EFFECT' &&
              a.handIndex === sel.handIndex &&
              a.targets.length === 2 &&
              ((actionsEqualTargets(a.targets[0], rallyFirst) &&
                actionsEqualTargets(a.targets[1], t)) ||
                (actionsEqualTargets(a.targets[1], rallyFirst) &&
                  actionsEqualTargets(a.targets[0], t))),
          )
          if (play) {
            setRallyFirst(null)
            dispatch(play)
          }
          return
        }
        const tMonster: TargetRef = { kind: 'monster', player: playerId, slot }
        const play = legal.find(
          (a) =>
            a.type === 'PLAY_EFFECT' &&
            a.handIndex === sel.handIndex &&
            a.targets.length === 1 &&
            actionsEqualTargets(a.targets[0], tMonster),
        )
        if (play) dispatch(play)
      }
      return
    }

    if (sel.kind === 'ability') {
      const t: TargetRef = { kind: 'monster', player: playerId, slot }
      const use = legal.find(
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.slot === sel.slot &&
          a.abilityId === sel.abilityId &&
          a.choice === sel.choice &&
          a.extraEnergy === sel.extraEnergy &&
          sameGold(a, sel) &&
          a.target &&
          actionsEqualTargets(a.target, t),
      )
      if (use) dispatch(use)
      return
    }
    if (sel.kind === 'abilityMulti') {
      if (!sel.first) {
        const valid = legal.some(
          (a) =>
            a.type === 'USE_ABILITY' &&
            a.slot === sel.slot &&
            a.abilityId === sel.abilityId &&
            sameGold(a, sel) &&
            a.targets?.[0] &&
            actionsEqualTargets(a.targets[0], clicked),
        )
        if (valid) setSel({ ...sel, first: clicked })
      } else {
        const use = legal.find(
          (a) =>
            a.type === 'USE_ABILITY' &&
            a.slot === sel.slot &&
            a.abilityId === sel.abilityId &&
            sameGold(a, sel) &&
            a.targets?.[0] &&
            a.targets?.[1] &&
            actionsEqualTargets(a.targets[0], sel.first!) &&
            actionsEqualTargets(a.targets[1], clicked),
        )
        if (use) dispatch(use)
      }
      return
    }

    if (state.phase === 'move' && playerId === active.id) {
      const w = legal.find((a) => a.type === 'WITHDRAW' && a.slot === slot)
      const adv = legal.find((a) => a.type === 'ADVANCE' && a.slot === slot)
      if (w) dispatch(w)
      else if (adv) dispatch(adv)
      return
    }

    if (state.phase === 'energy' && playerId === active.id) {
      if (sel.kind === 'darkChargeTarget') {
        const charge = legal.find(
          (a) =>
            a.type === 'DARK_CHARGE' &&
            a.slot === slot &&
            a.discardInstanceId === sel.discardInstanceId,
        )
        if (charge) dispatch(charge)
        return
      }
      const att = legal.find((a) => a.type === 'ATTACH_ENERGY' && a.slot === slot)
      if (att) dispatch(att)
      return
    }

  }

  function beginAbility(
    slot: number,
    abilityId: string,
    choice?: AbilityChoice,
    extraEnergy?: number,
    payment?: { goldRequire: number; goldSpend: number },
  ) {
    const matches = legal.filter(
      (a) =>
        a.type === 'USE_ABILITY' &&
        a.slot === slot &&
        a.abilityId === abilityId &&
        (choice === undefined || a.choice === choice) &&
        (extraEnergy === undefined || a.extraEnergy === extraEnergy),
    )
    if (matches.length === 0) return

    const choices = [
      ...new Set(matches.map((m) => (m.type === 'USE_ABILITY' ? m.choice : undefined))),
    ]
    if (choice === undefined && choices.some((c) => c !== undefined) && choices.length > 1) {
      setSel({ kind: 'abilityChoice', slot, abilityId })
      setRallyFirst(null)
      return
    }

    const extraOptions = [
      ...new Set(
        matches
          .map((m) => (m.type === 'USE_ABILITY' ? m.extraEnergy : undefined))
          .filter((n): n is number => n !== undefined),
      ),
    ]
    if (extraEnergy === undefined && extraOptions.length > 1) {
      setSel({ kind: 'abilityExtra', slot, abilityId, options: extraOptions })
      return
    }

    const paid = matches.filter(
      (m) =>
        m.type === 'USE_ABILITY' &&
        (choice === undefined || m.choice === choice) &&
        (extraEnergy === undefined || m.extraEnergy === extraEnergy),
    )
    const goldOptions = [
      ...new Map(
        paid
          .filter((m) => m.type === 'USE_ABILITY')
          .map((m) => {
            const goldRequire = m.type === 'USE_ABILITY' ? (m.goldRequire ?? 0) : 0
            const goldSpend = m.type === 'USE_ABILITY' ? (m.goldSpend ?? 0) : 0
            return [`${goldRequire},${goldSpend}`, { goldRequire, goldSpend }] as const
          }),
      ).values(),
    ]
    if (!payment && goldOptions.length > 1) {
      setSel({
        kind: 'abilityGold',
        slot,
        abilityId,
        choice,
        extraEnergy,
        options: goldOptions,
      })
      return
    }

    const sample = matches.find(
      (m) =>
        m.type === 'USE_ABILITY' &&
        (choice === undefined || m.choice === choice) &&
        (extraEnergy === undefined || m.extraEnergy === extraEnergy) &&
        (!payment ||
          ((m.goldRequire ?? 0) === payment.goldRequire && (m.goldSpend ?? 0) === payment.goldSpend)),
    )
    if (!sample || sample.type !== 'USE_ABILITY') return

    if (sample.targets) {
      setSel({
        kind: 'abilityMulti',
        slot,
        abilityId,
        goldRequire: sample.goldRequire,
        goldSpend: sample.goldSpend,
      })
    } else if (sample.target) {
      setSel({
        kind: 'ability',
        slot,
        abilityId,
        choice: sample.choice,
        extraEnergy: sample.extraEnergy,
        goldRequire: sample.goldRequire,
        goldSpend: sample.goldSpend,
      })
      setRallyFirst(null)
    } else {
      dispatch(sample)
    }
  }

  function onAbilityClick(playerId: 0 | 1, slot: number, abilityId: string) {
    if (playerId !== active.id || state.phase !== 'main') return
    beginAbility(slot, abilityId)
  }

  function onEquipmentClick(playerId: 0 | 1, slot: number, equipmentIndex: number) {
    const t: TargetRef = { kind: 'equipment', player: playerId, slot, equipmentIndex }
    if (state.pending?.kind === 'fairyHeal') {
      const action = legal.find(
        (a) => a.type === 'FAIRY_HEAL' && actionsEqualTargets(a.target, t),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'multiHit') {
      const action = legal.find(
        (a) => a.type === 'PENDING_TARGET' && actionsEqualTargets(a.target, t),
      )
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'plasmaCannon') {
      const action = legal.find((a) => a.type === 'PLASMA_FIRE' && actionsEqualTargets(a.target, t))
      if (action) dispatch(action)
      return
    }
    if (state.pending?.kind === 'soundWave') {
      const action = legal.find(
        (a) => a.type === 'SOUND_WAVE_TARGET' && actionsEqualTargets(a.target, t),
      )
      if (action) dispatch(action)
      return
    }
    if (sel.kind === 'hand') {
      const play = legal.find(
        (a) =>
          a.type === 'PLAY_EFFECT' &&
          a.handIndex === sel.handIndex &&
          a.targets.length === 1 &&
          actionsEqualTargets(a.targets[0], t),
      )
      if (play) dispatch(play)
      return
    }
    if (sel.kind === 'ability') {
      const use = legal.find(
        (a) =>
          a.type === 'USE_ABILITY' &&
          a.slot === sel.slot &&
          a.abilityId === sel.abilityId &&
          a.choice === sel.choice &&
          a.extraEnergy === sel.extraEnergy &&
          sameGold(a, sel) &&
          a.target &&
          actionsEqualTargets(a.target, t),
      )
      if (use) dispatch(use)
    }
  }

  const phaseButtons = legal.filter((a) =>
    [
      'SKIP_DRAW',
      'SKIP_MAIN',
      'SKIP_MOVE',
      'SKIP_ENERGY',
      'FINISH_ENERGY',
      'END_TURN',
      'UNGOO',
      'RESIST_CLING',
      'MARCH_FINISH',
      'PORTAL_FINISH',
      'GRIEF_FINISH',
      'SPY_SKIP',
      'PLASMA_ROLL',
      'SOUND_WAVE_FINISH',
      'BEGIN_KEYSTONE',
      'KEYSTONE_CANCEL',
    ].includes(a.type),
  )

  const viewingDiscard = discardView !== null ? state.players[discardView] : null
  const trickeryPending = state.pending?.kind === 'trickery' ? state.pending : null
  const buryPending = state.pending?.kind === 'bury' ? state.pending : null
  const discardPickPending = state.pending?.kind === 'discardPick' ? state.pending : null
  const handDiscardPending = state.pending?.kind === 'handDiscard' ? state.pending : null
  const spyPending = state.pending?.kind === 'spy' ? state.pending : null
  const griefPending = state.pending?.kind === 'griefDestroy' ? state.pending : null
  const transmuteHandPending = state.pending?.kind === 'transmuteHand' ? state.pending : null
  const transmuteFetchPending = state.pending?.kind === 'transmuteFetch' ? state.pending : null
  const brewPending = state.pending?.kind === 'brewWeakness' ? state.pending : null
  const darkChargeActions = legal.filter((a) => a.type === 'DARK_CHARGE')

  return (
    <div className="board">
      <header className="board-top">
        <div>
          <h1>MCG II</h1>
          <p className="muted">
            {active.name}&apos;s turn · phase: <strong>{state.phase}</strong>
            {active.isFirstTurn ? ' · first turn' : ''}
          </p>
        </div>
        <button type="button" className="secondary" onClick={onNewGame}>
          Quit to setup
        </button>
      </header>

      <div className="battle-layout">
      <PlayerRow
        game={state}
        player={inactive}
        you={false}
        highlightTargets={highlightTargets}
        rallyFirst={rallyFirst}
        canDraw={false}
        onDraw={() => {}}
        onOpenDiscard={() => setDiscardView(inactive.id)}
        onSlotClick={onFieldSlotClick}
        onEquipmentClick={onEquipmentClick}
        onAbilityClick={onAbilityClick}
        legal={legal}
        selectedAbility={null}
      />

      <section className="center-panel">
        <p className="prompt">{prompt}{rallyFirst ? ' Now choose the second monster.' : ''}</p>
        <div className="phase-actions">
          {undoButton}
          {phaseButtons.map((a, i) => (
            <button key={i} type="button" className="primary" onClick={() => dispatch(a)}>
              {describeAction(state, a)}
            </button>
          ))}
          {darkChargeActions.length > 0 && sel.kind === 'none' && (
            <button
              type="button"
              className="primary"
              onClick={() => setSel({ kind: 'darkChargeDiscard' })}
            >
              Dark Charge
            </button>
          )}
          {(sel.kind === 'darkChargeDiscard' || sel.kind === 'darkChargeTarget') && (
            <button type="button" className="secondary" onClick={() => setSel({ kind: 'none' })}>
              Cancel Dark Charge
            </button>
          )}
        </div>

        {sel.kind === 'abilityChoice' && (
          <div className="ability-choice">
            <h3>
              Choose Fire Punch mode
              <button type="button" className="linkish" onClick={() => setSel({ kind: 'none' })}>
                cancel
              </button>
            </h3>
            <div className="chip-row">
              <button
                type="button"
                className="chip"
                onClick={() => beginAbility(sel.slot, sel.abilityId, 'firePunchFull')}
              >
                30 fire damage
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => beginAbility(sel.slot, sel.abilityId, 'firePunchBurn')}
              >
                10 fire + burn
              </button>
            </div>
          </div>
        )}

        {sel.kind === 'ability' && (
          <div className="ability-choice">
            <p className="muted">
              Choose a target for{' '}
              {monsterAbilities(active.field[sel.slot]!).find((a) => a.id === sel.abilityId)?.name}.
              <button type="button" className="linkish" onClick={() => setSel({ kind: 'none' })}>
                cancel
              </button>
            </p>
          </div>
        )}

        {sel.kind === 'abilityGold' && (
          <div className="ability-choice">
            <h3>
              Choose how Gold pays this cost
              <button type="button" className="linkish" onClick={() => setSel({ kind: 'none' })}>
                cancel
              </button>
            </h3>
            <div className="chip-row">
              {sel.options.map((option) => (
                <button
                  key={`${option.goldRequire}-${option.goldSpend}`}
                  type="button"
                  className="chip"
                  onClick={() =>
                    beginAbility(sel.slot, sel.abilityId, sel.choice, sel.extraEnergy, option)
                  }
                >
                  {goldPaymentLabel(option.goldRequire, option.goldSpend)}
                </button>
              ))}
            </div>
          </div>
        )}

        {sel.kind === 'abilityExtra' && (
          <div className="ability-choice">
            <h3>Choose extra energy to spend</h3>
            <div className="chip-row">
              {sel.options.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className="chip"
                  onClick={() => beginAbility(sel.slot, sel.abilityId, undefined, amount)}
                >
                  {sel.abilityId === 'flurry_of_blows'
                    ? `${amount} energy → ${amount * 30} damage`
                    : sel.abilityId === 'solar_flare'
                      ? amount === 0
                        ? '20 light'
                        : '30 light'
                      : sel.abilityId === 'zap'
                        ? amount === 0
                          ? '20 electric'
                          : '40 electric'
                        : sel.abilityId === 'collect' || sel.abilityId === 'supply'
                          ? `Move ${amount} energy`
                          : `${amount} extra → ${20 + amount * 20} damage`}
                </button>
              ))}
            </div>
          </div>
        )}

        {sel.kind === 'abilityMulti' && (
          <div className="ability-choice">
            <p className="muted">
              {sel.abilityId === 'bottle_toxins' ||
              sel.abilityId === 'burning_breath' ||
              sel.abilityId === 'poison_gas'
                ? sel.first
                  ? 'Now choose an adjacent card.'
                  : 'Choose the first of two adjacent cards.'
                : sel.first
                  ? 'Now choose the destination.'
                  : 'Choose the energy source.'}
              <button type="button" className="linkish" onClick={() => setSel({ kind: 'none' })}>
                cancel
              </button>
            </p>
          </div>
        )}

        {brewPending && (
          <div className="ability-choice">
            <h3>Choose the new weakness</h3>
            <div className="chip-row">
              {legal
                .filter((a) => a.type === 'BREW_WEAKNESS')
                .map((a) =>
                  a.type === 'BREW_WEAKNESS' ? (
                    <button
                      key={a.damageType}
                      type="button"
                      className="chip"
                      onClick={() => dispatch(a)}
                    >
                      {formatDamageType(a.damageType)}
                    </button>
                  ) : null,
                )}
            </div>
          </div>
        )}

        {state.pending?.kind === 'stormType' && (
          <div className="ability-choice">
            <h3>Bring the STORM</h3>
            <div className="chip-row">
              {legal
                .filter((action) => action.type === 'STORM_TYPE')
                .map((action) =>
                  action.type === 'STORM_TYPE' ? (
                    <button
                      key={action.damageType}
                      type="button"
                      className="chip"
                      onClick={() => dispatch(action)}
                    >
                      {describeAction(state, action)}
                    </button>
                  ) : null,
                )}
            </div>
          </div>
        )}

        {state.pending?.kind === 'forceWithdraw' && (
          <div className="ability-choice">
            <h3>Withdraw</h3>
            <div className="chip-row">
              {legal
                .filter((action) => action.type === 'FORCE_WITHDRAW')
                .map((action) =>
                  action.type === 'FORCE_WITHDRAW' ? (
                    <button
                      key={action.accept ? 'yes' : 'no'}
                      type="button"
                      className="chip"
                      onClick={() => dispatch(action)}
                    >
                      {describeAction(state, action)}
                    </button>
                  ) : null,
                )}
            </div>
          </div>
        )}

        {state.pending?.kind === 'hoardChoice' && (
          <div className="ability-choice">
            <h3>Treasure Hoard</h3>
            <div className="chip-row">
              {legal
                .filter((action) => action.type === 'HOARD_CHOICE')
                .map((action) =>
                  action.type === 'HOARD_CHOICE' ? (
                    <button
                      key={action.mode}
                      type="button"
                      className="chip"
                      onClick={() => dispatch(action)}
                    >
                      {describeAction(state, action)}
                    </button>
                  ) : null,
                )}
            </div>
          </div>
        )}

        {state.pending?.kind === 'rainChoice' && (
          <div className="ability-choice">
            <h3>Choose Rain of Goo mode</h3>
            <div className="chip-row">
              {legal.map((action, i) =>
                action.type === 'RAIN_CHOOSE_MODE' ? (
                  <button key={i} type="button" className="chip" onClick={() => dispatch(action)}>
                    {describeAction(state, action)}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        )}

        {state.pending?.kind === 'rainBlobs' && (
          <div className="ability-choice">
            <h3>Play Blob cards</h3>
            <div className="chip-row">
              {active.hand.map((card, handIndex) =>
                getCard(card.defId).name.toLowerCase().includes('blob') ? (
                  <button
                    key={card.instanceId}
                    type="button"
                    className={`chip${sel.kind === 'rainBlob' && sel.handIndex === handIndex ? ' selected' : ''}`}
                    onClick={() => setSel({ kind: 'rainBlob', handIndex })}
                  >
                    {getCard(card.defId).name}
                  </button>
                ) : null,
              )}
              <button
                type="button"
                className="secondary"
                disabled={!legal.some((a) => a.type === 'RAIN_FINISH_BLOBS')}
                onClick={() => dispatch({ type: 'RAIN_FINISH_BLOBS' })}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {lastRoll !== undefined && <DieResult value={lastRoll} />}

        <div className="log-box" aria-label="Game activity">
          {state.log.slice(-10).map((e, i) => (
            <p key={i} className={e.dieRoll !== undefined ? 'roll-log-entry' : undefined}>
              {e.dieRoll !== undefined && (
                <span className="mini-die" aria-hidden="true">
                  {DIE_GLYPHS[e.dieRoll - 1]}
                </span>
              )}
              {e.message}
            </p>
          ))}
        </div>
      </section>

      <PlayerRow
        game={state}
        player={active}
        you
        highlightTargets={highlightTargets}
        rallyFirst={rallyFirst}
        selectedSlot={
          sel.kind === 'ability' ||
          sel.kind === 'abilityChoice' ||
          sel.kind === 'abilityExtra' ||
          sel.kind === 'abilityMulti'
            ? sel.slot
            : null
        }
        canDraw={canDraw}
        onDraw={() => dispatch({ type: 'DRAW' })}
        onOpenDiscard={() => setDiscardView(active.id)}
        onSlotClick={onFieldSlotClick}
        onEquipmentClick={onEquipmentClick}
        onAbilityClick={onAbilityClick}
        legal={legal}
        selectedAbility={
          sel.kind === 'ability' ||
          sel.kind === 'abilityChoice' ||
          sel.kind === 'abilityExtra' ||
          sel.kind === 'abilityMulti'
            ? { slot: sel.slot, abilityId: sel.abilityId }
            : null
        }
      />
      </div>

      <section className="hand-row">
        <h3>Your hand</h3>
        <div className="hand-cards">
          {active.hand.map((card, handIndex) => {
            const def = getCard(card.defId)
            const playable = legal.some(
              (a) =>
                (a.type === 'PLAY_MONSTER' ||
                  a.type === 'PLAY_EFFECT' ||
                  a.type === 'PLAY_EQUIPMENT') &&
                a.handIndex === handIndex,
            )
            const selected = sel.kind === 'hand' && sel.handIndex === handIndex
            return (
              <button
                key={card.instanceId}
                type="button"
                className={`tcg-card hand-card kind-${def.kind}${selected ? ' selected' : ''}${
                  playable ? ' playable' : ''
                }`}
                disabled={!playable && !selected}
                onClick={() => {
                  setRallyFirst(null)
                  const immediate = legal.find(
                    (a) =>
                      a.type === 'PLAY_EFFECT' &&
                      a.handIndex === handIndex &&
                      a.targets.length === 0,
                  )
                  if (immediate) {
                    dispatch(immediate)
                    return
                  }
                  setSel(selected ? { kind: 'none' } : { kind: 'hand', handIndex })
                }}
              >
                <CardFace defId={card.defId} />
              </button>
            )
          })}
        </div>
      </section>

      {viewingDiscard && (
        <div className="modal-backdrop" onClick={() => setDiscardView(null)} role="presentation">
          <div
            className="modal-panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={`${viewingDiscard.name} discard pile`}
          >
            <header className="modal-header">
              <h2>{viewingDiscard.name}&apos;s discard</h2>
              <button type="button" className="secondary" onClick={() => setDiscardView(null)}>
                Close
              </button>
            </header>
            {viewingDiscard.discard.length === 0 ? (
              <p className="muted">Empty.</p>
            ) : (
              <div className="discard-grid">
                {[...viewingDiscard.discard].reverse().map((card) => (
                  <div key={card.instanceId} className={`tcg-card kind-${getCard(card.defId).kind}`}>
                    <CardFace defId={card.defId} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {trickeryPending && (
        <div className="modal-backdrop">
          <div className="modal-panel trickery-panel" role="dialog" aria-label="Trickery card">
            <h2>Trickery revealed</h2>
            <div className={`tcg-card kind-${getCard(trickeryPending.card.defId).kind}`}>
              <CardFace defId={trickeryPending.card.defId} />
            </div>
            <p>Choose its exact position in {state.players[trickeryPending.opponent].name}&apos;s deck:</p>
            <div className="chip-row">
              {legal.map((action) =>
                action.type === 'TRICKERY_PLACE' ? (
                  <button
                    key={action.deckIndex}
                    type="button"
                    className="chip"
                    onClick={() => dispatch(action)}
                  >
                    {action.deckIndex === 0
                      ? 'Top'
                      : action.deckIndex === state.players[trickeryPending.opponent].deck.length
                        ? 'Bottom'
                        : `Position ${action.deckIndex + 1}`}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        </div>
      )}

      {buryPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Choose cards to bury">
            <header className="modal-header">
              <h2>Choose cards to bury</h2>
              <button type="button" className="primary" onClick={() => dispatch({ type: 'BURY_FINISH' })}>
                Bury {buryPending.chosenInstanceIds.length}
              </button>
            </header>
            <p className="muted">Selected cards will be inserted at random positions in your deck.</p>
            {state.players[buryPending.owner].hand.length === 0 ? (
              <p className="muted">Your hand is empty. Choose “Bury 0” to continue.</p>
            ) : (
              <div className="discard-grid">
                {state.players[buryPending.owner].hand.map((card) => {
                  const selected = buryPending.chosenInstanceIds.includes(card.instanceId)
                  return (
                    <button
                      key={card.instanceId}
                      type="button"
                      className={`tcg-card kind-${getCard(card.defId).kind}${selected ? ' selected' : ''}`}
                      onClick={() => dispatch({ type: 'BURY_TOGGLE', instanceId: card.instanceId })}
                    >
                      <CardFace defId={card.defId} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {discardPickPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Choose a discarded card">
            <header className="modal-header">
              <h2>Choose a discarded card</h2>
            </header>
            <div className="discard-grid">
              {state.players[discardPickPending.pileOwner].discard.map((card) => (
                <button
                  key={card.instanceId}
                  type="button"
                  className={`tcg-card kind-${getCard(card.defId).kind}`}
                  onClick={() => dispatch({ type: 'PICK_DISCARD', instanceId: card.instanceId })}
                >
                  <CardFace defId={card.defId} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.pending?.kind === 'eldersEye' && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Elder's Eye">
            <header className="modal-header">
              <h2>Elder's Eye</h2>
            </header>
            <p className="muted">
              Click cards from the top downward. The first card you click is drawn.
            </p>
            <div className="discard-grid">
              {state.pending.cards.map((card) => {
                const place = state.pending?.kind === 'eldersEye'
                  ? state.pending.order.indexOf(card.instanceId)
                  : -1
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    className={`tcg-card kind-${getCard(card.defId).kind}${place >= 0 ? ' selected' : ''}`}
                    disabled={place >= 0}
                    onClick={() => dispatch({ type: 'ELDERS_PICK', instanceId: card.instanceId })}
                  >
                    <CardFace defId={card.defId} />
                    {place >= 0 && <span className="pile-hint">{place === 0 ? 'Drawn' : `Next ${place}`}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {state.pending?.kind === 'keystone' && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Forge Colossus Keystone">
            <header className="modal-header">
              <h2>Forge Colossus Keystone</h2>
              <button type="button" className="primary" onClick={() => dispatch({ type: 'KEYSTONE_CANCEL' })}>
                Cancel
              </button>
            </header>
            <p className="muted">Destroy 3 cards from your hand, then choose a Colossus.</p>
            <div className="discard-grid">
              {state.players[state.pending.owner].hand.map((card) => {
                const chosen =
                  state.pending?.kind === 'keystone' &&
                  state.pending.chosenInstanceIds.includes(card.instanceId)
                return (
                  <button
                    key={card.instanceId}
                    type="button"
                    className={`tcg-card kind-${getCard(card.defId).kind}${chosen ? ' selected' : ''}`}
                    onClick={() => dispatch({ type: 'KEYSTONE_TOGGLE', instanceId: card.instanceId })}
                  >
                    <CardFace defId={card.defId} />
                  </button>
                )
              })}
            </div>
            {state.pending.chosenInstanceIds.length === 3 && (
              <div className="chip-row">
                {legal
                  .filter((action) => action.type === 'KEYSTONE_ATTACH')
                  .map((action) => (
                    <button
                      key={action.type === 'KEYSTONE_ATTACH' ? action.slot : 'keystone'}
                      type="button"
                      className="primary"
                      onClick={() => dispatch(action)}
                    >
                      {describeAction(state, action)}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {handDiscardPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Choose a card to discard">
            <header className="modal-header">
              <h2>
                {state.players[handDiscardPending.player].name}: choose a card to discard
                {handDiscardPending.remaining > 1 ? ` (${handDiscardPending.remaining} remaining)` : ''}
              </h2>
            </header>
            <div className="discard-grid">
              {state.players[handDiscardPending.player].hand
                .filter((card) =>
                  legal.some(
                    (a) => a.type === 'DISCARD_FROM_HAND' && a.instanceId === card.instanceId,
                  ),
                )
                .map((card) => (
                  <button
                    key={card.instanceId}
                    type="button"
                    className={`tcg-card kind-${getCard(card.defId).kind}`}
                    onClick={() => dispatch({ type: 'DISCARD_FROM_HAND', instanceId: card.instanceId })}
                  >
                    <CardFace defId={card.defId} />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {spyPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Opponent hand">
            <header className="modal-header">
              <h2>{state.players[spyPending.owner === 0 ? 1 : 0].name}&apos;s hand</h2>
              <button type="button" className="primary" onClick={() => dispatch({ type: 'SPY_SKIP' })}>
                Leave unmarked
              </button>
            </header>
            <p className="muted">Mark a card to force it on their next discard, or leave unmarked.</p>
            <div className="discard-grid">
              {state.players[spyPending.owner === 0 ? 1 : 0].hand.map((card) => (
                <button
                  key={card.instanceId}
                  type="button"
                  className={`tcg-card kind-${getCard(card.defId).kind}`}
                  onClick={() => dispatch({ type: 'SPY_MARK', instanceId: card.instanceId })}
                >
                  <CardFace defId={card.defId} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {griefPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Destroy discarded cards">
            <header className="modal-header">
              <h2>Destroy up to two discarded cards</h2>
              <button type="button" className="primary" onClick={() => dispatch({ type: 'GRIEF_FINISH' })}>
                Destroy {griefPending.chosenInstanceIds.length}
              </button>
            </header>
            {state.players[griefPending.owner].discard.length === 0 ? (
              <p className="muted">Your discard is empty. Destroy 0 to continue.</p>
            ) : (
              <div className="discard-grid">
                {state.players[griefPending.owner].discard.map((card) => {
                  const selected = griefPending.chosenInstanceIds.includes(card.instanceId)
                  const toggle = legal.find(
                    (a) => a.type === 'GRIEF_TOGGLE' && a.instanceId === card.instanceId,
                  )
                  return (
                    <button
                      key={card.instanceId}
                      type="button"
                      className={`tcg-card kind-${getCard(card.defId).kind}${selected ? ' selected' : ''}`}
                      disabled={!toggle}
                      onClick={() => toggle && dispatch(toggle)}
                    >
                      <CardFace defId={card.defId} />
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {transmuteHandPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Destroy a card in hand">
            <header className="modal-header">
              <h2>Destroy a card in your hand</h2>
            </header>
            <div className="discard-grid">
              {state.players[transmuteHandPending.owner].hand.map((card) => (
                <button
                  key={card.instanceId}
                  type="button"
                  className={`tcg-card kind-${getCard(card.defId).kind}`}
                  onClick={() => dispatch({ type: 'TRANSMUTE_DESTROY', instanceId: card.instanceId })}
                >
                  <CardFace defId={card.defId} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {transmuteFetchPending && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Take a card">
            <header className="modal-header">
              <h2>Take a card from your discard or deck</h2>
            </header>
            <div className="discard-grid">
              {[
                ...state.players[transmuteFetchPending.owner].discard.map((card) => ({
                  card,
                  pile: 'Discard',
                })),
                ...state.players[transmuteFetchPending.owner].deck.map((card) => ({
                  card,
                  pile: 'Deck',
                })),
              ].map(({ card, pile }) => (
                <button
                  key={card.instanceId}
                  type="button"
                  className={`tcg-card kind-${getCard(card.defId).kind}`}
                  onClick={() => dispatch({ type: 'TRANSMUTE_FETCH', instanceId: card.instanceId })}
                >
                  <CardFace defId={card.defId} />
                  <span className="muted">{pile}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sel.kind === 'darkChargeDiscard' && (
        <div className="modal-backdrop">
          <div className="modal-panel" role="dialog" aria-label="Destroy a discarded card">
            <header className="modal-header">
              <h2>Destroy a discarded card</h2>
              <button type="button" className="secondary" onClick={() => setSel({ kind: 'none' })}>
                Cancel
              </button>
            </header>
            <p className="muted">Then choose a Dark Charge monster to attach 1 extra energy.</p>
            <div className="discard-grid">
              {active.discard
                .filter((card) =>
                  darkChargeActions.some((a) => a.discardInstanceId === card.instanceId),
                )
                .map((card) => (
                  <button
                    key={card.instanceId}
                    type="button"
                    className={`tcg-card kind-${getCard(card.defId).kind}`}
                    onClick={() =>
                      setSel({ kind: 'darkChargeTarget', discardInstanceId: card.instanceId })
                    }
                  >
                    <CardFace defId={card.defId} />
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function actionsEqualTargets(a: TargetRef, b: TargetRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function PlayerRow({
  game,
  player,
  you,
  highlightTargets,
  rallyFirst,
  selectedSlot = null,
  canDraw,
  onDraw,
  onOpenDiscard,
  onSlotClick,
  onEquipmentClick,
  onAbilityClick,
  legal,
  selectedAbility,
}: {
  game: GameState
  player: GameState['players'][0]
  you: boolean
  highlightTargets: Set<string>
  rallyFirst: TargetRef | null
  selectedSlot?: number | null
  canDraw: boolean
  onDraw: () => void
  onOpenDiscard: () => void
  onSlotClick: (playerId: 0 | 1, slot: number, stance?: Stance) => void
  onEquipmentClick: (playerId: 0 | 1, slot: number, equipmentIndex: number) => void
  onAbilityClick: (playerId: 0 | 1, slot: number, abilityId: string) => void
  legal: GameAction[]
  selectedAbility: { slot: number; abilityId: string } | null
}) {
  return (
    <section className={`player-row ${you ? 'you' : 'foe'}`}>
      <div className="player-meta">
        <h2>
          {player.name} {you ? '(you)' : ''}
        </h2>
        <p>
          Points: <strong>{player.points}</strong>
          {player.skipEnergyPhases > 0 && <> · Energy skips: <strong>{player.skipEnergyPhases}</strong></>}
          {player.iceMirrorCharges > 0 && <> · Ice Mirror: <strong>{player.iceMirrorCharges}</strong></>}
          {player.lingeringEnergy && <> · Lingering Energy</>}
        </p>
      </div>
      <div className="play-area">
        <button
          type="button"
          className={`pile draw-pile${canDraw ? ' interactive' : ''}${
            player.deck.length === 0 ? ' empty-pile' : ''
          }`}
          title={canDraw ? 'Draw a card' : `${player.deck.length} in draw pile`}
          onClick={() => {
            if (canDraw) onDraw()
          }}
        >
          <span className="pile-label">Draw</span>
          <span className="pile-count">{player.deck.length}</span>
          {canDraw && <span className="pile-hint">Click to draw</span>}
        </button>

        <div
          className="field-row"
          style={{
            gridTemplateColumns: `repeat(${
              game.pending?.kind === 'placeWeed' &&
              game.pending.owner === player.id &&
              player.field.every((occupant) => occupant !== null)
                ? player.field.length + 1
                : player.field.length
            }, minmax(132px, 1fr))`,
          }}
        >
          {(game.pending?.kind === 'placeWeed' &&
          game.pending.owner === player.id &&
          player.field.every((occupant) => occupant !== null)
            ? [...player.field, null]
            : player.field
          ).map((monster, slot) => {
            const activeHighlight = highlightTargets.has(`slot-${player.id}-${slot}-active`)
            const withdrawnHighlight = highlightTargets.has(
              `slot-${player.id}-${slot}-withdrawn`,
            )
            const monKey = `mon-${player.id}-${slot}`
            const tKey = targetKey({ kind: 'monster', player: player.id, slot })
            const cardHighlighted =
              Boolean(monster) &&
              (highlightTargets.has(monKey) ||
                highlightTargets.has(tKey) ||
                (rallyFirst?.kind === 'monster' &&
                  rallyFirst.player === player.id &&
                  rallyFirst.slot === slot))
            const selected = you && selectedSlot === slot
            const eqHighlights = new Set<number>()
            monster?.equipment.forEach((_, eqIndex) => {
              if (
                highlightTargets.has(
                  targetKey({
                    kind: 'equipment',
                    player: player.id,
                    slot,
                    equipmentIndex: eqIndex,
                  }),
                )
              ) {
                eqHighlights.add(eqIndex)
              }
            })
            const usableAbilityIds = new Set(
              legal
                .filter((a) => a.type === 'USE_ABILITY' && a.slot === slot && you)
                .map((a) => (a.type === 'USE_ABILITY' ? a.abilityId : '')),
            )

            const cardEl = monster ? (
              <div
                role="button"
                tabIndex={0}
                className={`tcg-card field-slot monster stance-${monster.stance}${
                  cardHighlighted ? ' highlight' : ''
                }${selected ? ' selected' : ''}`}
                onClick={() => onSlotClick(player.id, slot, monster.stance)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSlotClick(player.id, slot, monster.stance)
                  }
                }}
              >
                <CardFace
                  defId={monster.defId}
                  field={monster}
                  extraDefense={guardingGoldDefense(game, monster)}
                  highlightedEquipment={eqHighlights}
                  onEquipmentClick={(eqIndex) => onEquipmentClick(player.id, slot, eqIndex)}
                  usableAbilityIds={usableAbilityIds}
                  selectedAbilityId={
                    selectedAbility?.slot === slot ? selectedAbility.abilityId : null
                  }
                  onAbilityClick={
                    you ? (abilityId) => onAbilityClick(player.id, slot, abilityId) : undefined
                  }
                />
              </div>
            ) : null

            const guardingAway = Boolean(monster?.protectingInstanceId)
            const protectorIndex = monster
              ? player.field.findIndex(
                  (candidate) => candidate?.protectingInstanceId === monster.instanceId,
                )
              : -1
            const protector = protectorIndex >= 0 ? player.field[protectorIndex] : null
            const protectorHighlighted = Boolean(
              protector &&
                (highlightTargets.has(`mon-${player.id}-${protectorIndex}`) ||
                  highlightTargets.has(
                    targetKey({ kind: 'monster', player: player.id, slot: protectorIndex }),
                  ) ||
                  (rallyFirst?.kind === 'monster' &&
                    rallyFirst.player === player.id &&
                    rallyFirst.slot === protectorIndex)),
            )
            const protectorSelected = you && selectedSlot === protectorIndex
            const protectorAbilities = new Set(
              legal
                .filter((a) => a.type === 'USE_ABILITY' && a.slot === protectorIndex && you)
                .map((a) => (a.type === 'USE_ABILITY' ? a.abilityId : '')),
            )
            const guardingMarker = monster ? (
              <button
                type="button"
                className={`tcg-card field-slot guarding-away${cardHighlighted ? ' highlight' : ''}${
                  selected ? ' selected' : ''
                }`}
                onClick={() => onSlotClick(player.id, slot, monster.stance)}
              >
                <span>Guarding</span>
              </button>
            ) : null
            const protectorEqHighlights = new Set<number>()
            protector?.equipment.forEach((_, eqIndex) => {
              if (
                highlightTargets.has(
                  targetKey({
                    kind: 'equipment',
                    player: player.id,
                    slot: protectorIndex,
                    equipmentIndex: eqIndex,
                  }),
                )
              ) {
                protectorEqHighlights.add(eqIndex)
              }
            })
            const protectorCard = protector ? (
              <div
                role="button"
                tabIndex={0}
                className={`tcg-card field-slot monster guard-horizontal stance-${protector.stance}${
                  protectorHighlighted ? ' highlight' : ''
                }${protectorSelected ? ' selected' : ''}`}
                onClick={() => onSlotClick(player.id, protectorIndex, protector.stance)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSlotClick(player.id, protectorIndex, protector.stance)
                  }
                }}
              >
                <CardFace
                  defId={protector.defId}
                  field={protector}
                  extraDefense={guardingGoldDefense(game, protector)}
                  highlightedEquipment={protectorEqHighlights}
                  onEquipmentClick={(eqIndex) =>
                    onEquipmentClick(player.id, protectorIndex, eqIndex)
                  }
                  usableAbilityIds={protectorAbilities}
                  selectedAbilityId={
                    selectedAbility?.slot === protectorIndex ? selectedAbility.abilityId : null
                  }
                  onAbilityClick={
                    you
                      ? (abilityId) => onAbilityClick(player.id, protectorIndex, abilityId)
                      : undefined
                  }
                />
              </div>
            ) : null

            const emptyActive = (
              <button
                type="button"
                className={`tcg-card field-slot empty zone-empty${
                  activeHighlight ? ' highlight' : ''
                }`}
                onClick={() => onSlotClick(player.id, slot, 'active')}
              >
                <span>Active</span>
              </button>
            )

            const emptyWithdrawn = (
              <button
                type="button"
                className={`tcg-card field-slot empty zone-empty withdrawn-pad${
                  withdrawnHighlight ? ' highlight' : ''
                }`}
                onClick={() => onSlotClick(player.id, slot, 'withdrawn')}
              >
                <span>Withdrawn</span>
              </button>
            )

            const shownCard = guardingAway ? guardingMarker : cardEl

            return (
              <div key={slot} className="slot-column">
                <div className="zone zone-active">
                  {monster?.stance === 'active' ? shownCard : !monster ? emptyActive : (
                    <div className="zone-spacer" aria-hidden />
                  )}
                  {protectorCard}
                </div>
                <div className="zone zone-withdrawn">
                  {monster?.stance === 'withdrawn' ? shownCard : !monster ? emptyWithdrawn : (
                    <div className="zone-spacer" aria-hidden />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className={`pile discard-pile${player.discard.length === 0 ? ' empty-pile' : ' interactive'}`}
          title="View discard pile"
          onClick={onOpenDiscard}
        >
          <span className="pile-label">Discard</span>
          <span className="pile-count">{player.discard.length}</span>
          <span className="pile-hint">Click to view</span>
        </button>
      </div>
    </section>
  )
}
