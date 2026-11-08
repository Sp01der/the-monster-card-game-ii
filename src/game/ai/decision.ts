import { otherPlayer } from '../helpers'
import type { GameState, PendingInteraction, PlayerId } from '../types'

/** Seat that must choose the next action. */
export function decisionPlayer(state: GameState): PlayerId {
  if (state.awaitingHandoff) return state.activePlayer
  if (
    state.openingMulligan &&
    !state.openingMulligan.decided[state.activePlayer]
  ) {
    return state.activePlayer
  }
  if (state.pending) return pendingDecisionPlayer(state.pending)
  return state.activePlayer
}

function pendingDecisionPlayer(pending: PendingInteraction): PlayerId {
  switch (pending.kind) {
    case 'rainChoice':
    case 'trickery':
    case 'spawnBlobs':
    case 'rainBlobs':
    case 'rainGoo':
    case 'bury':
    case 'discardPick':
    case 'spy':
    case 'griefDestroy':
    case 'transmuteHand':
    case 'transmuteFetch':
    case 'brewWeakness':
    case 'march':
    case 'playCards':
    case 'veridianFires':
    case 'veridianStrike':
    case 'bloodcraft':
    case 'hauntedPick':
    case 'goldenDie':
    case 'replayEffect':
    case 'mirrorPick':
    case 'shapeshiftPick':
    case 'rewindDiscard':
    case 'eldersEye':
    case 'keystone':
    case 'hoardChoice':
    case 'assignGold':
    case 'fairyHeal':
    case 'placeWeed':
    case 'placeBoneling':
    case 'bringForth':
    case 'cloudDestroy':
    case 'cloudBless':
    case 'riftEye':
      return pending.owner
    case 'multiHit':
    case 'stormType':
    case 'plasmaCannon':
    case 'soundWave':
    case 'repeatGoo':
    case 'freezeTargets':
      return pending.sourcePlayer
    case 'forceWithdraw':
    case 'handDiscard':
      return pending.player
    case 'mirrorOffer':
      return otherPlayer(pending.owner)
    case 'mirrorContinue':
      return pending.pactOwner
  }
}

/**
 * Pendings that legally reveal hidden cards to the chooser.
 * Search may read those zones while the prompt is open.
 */
export function isRevealingPending(pending: PendingInteraction | null | undefined): boolean {
  if (!pending) return false
  switch (pending.kind) {
    case 'spy':
    case 'trickery':
    case 'eldersEye':
    case 'riftEye':
    case 'transmuteFetch':
    case 'mirrorPick':
    case 'shapeshiftPick':
      return true
    default:
      return false
  }
}
