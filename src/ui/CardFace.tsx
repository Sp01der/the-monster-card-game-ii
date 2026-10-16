import { formatDamageType, getCard, getWeaknesses, grantedAbilities } from '../game'
import type { FieldMonster } from '../game'
import { abilityLines, cardBodyText } from './cardText'
import { EnergyDots } from './EnergyDots'

type Props = {
  defId: string
  /** Live field state for monsters in play. */
  field?: FieldMonster
  compact?: boolean
  highlightedEquipment?: Set<number>
  onEquipmentClick?: (equipmentIndex: number) => void
  /** Ability ids that can be clicked right now. */
  usableAbilityIds?: Set<string>
  /** Currently selected ability on this card. */
  selectedAbilityId?: string | null
  onAbilityClick?: (abilityId: string) => void
  /** Extra defense from Treasure Keepers while the ward has Gold. */
  extraDefense?: number
}

export function CardFace({
  defId,
  field,
  compact,
  highlightedEquipment,
  onEquipmentClick,
  usableAbilityIds,
  selectedAbilityId,
  onAbilityClick,
  extraDefense = 0,
}: Props) {
  const card = getCard(defId)

  if (card.kind === 'monster') {
    const hp = field ? `${field.hp}/${field.maxHp}` : `${card.maxHp}`
    const energy = field
      ? `${field.energy}${field.pendingEnergy > 0 ? `+${field.pendingEnergy}` : ''}`
      : null
    const lines = abilityLines(card, field ? grantedAbilities(field) : [])
    const weaknesses = field?.weaknessOverride
      ? [field.weaknessOverride]
      : getWeaknesses(card.id)

    return (
      <div className={`card-face kind-monster${compact ? ' compact' : ''}`}>
        <header className="card-top">
          <span className="card-name">{card.name}</span>
          <span className="card-points">{card.points}pt</span>
        </header>
        <div className="card-stats">
          <span>♥ {hp}</span>
          {energy !== null && <span>⚡ {energy}</span>}
          {weaknesses.length > 0 && (
            <span className="tag">
              {card.extremeWeakness ? 'extremely weak' : 'weak'}{' '}
              {weaknesses.map(formatDamageType).join(' / ')}
            </span>
          )}
          {(card.defense || extraDefense || (field?.fortifyHitsLeft ?? 0) > 0) ? (
            <span className="tag">
              def {(card.defense ?? 0) + extraDefense + ((field?.fortifyHitsLeft ?? 0) > 0 ? 1 : 0)}
            </span>
          ) : null}
          {card.families?.includes('plant') ? <span className="tag">Plant</span> : null}
          {card.families?.includes('woody') ? <span className="tag">Woody</span> : null}
          {card.families?.includes('stormling') ? <span className="tag">Stormling</span> : null}
          {card.darkCharge ? <span className="tag">Dark Charge</span> : null}
          {card.goldAffinity ? <span className="tag">Gold Affinity</span> : null}
          {field && card.goldAffinity ? <span>gold {field.gold ?? 0}</span> : null}
        </div>
        {field && (
          <div className="card-stance-row">
            <span className={`stance-pill stance-${field.stance}`}>{field.stance}</span>
            {(field.illuminatedThisTurn ||
              field.equipment.some((eq) => eq.defId === 'prism_lens')) && (
              <span className="stance-pill lit">lit</span>
            )}
            {field.honourGuardUntilNextTurn && <span className="stance-pill honour">honour</span>}
            {field.protectingInstanceId && <span className="stance-pill">guarding</span>}
            {field.protectedByInstanceId && <span className="stance-pill">protected</span>}
            {field.statuses.map((s, i) => (
              <span key={i} className={`status status-${s.kind}`}>
                {s.kind}
                {s.kind !== 'goo' ? ` ${s.turns}` : ''}
              </span>
            ))}
          </div>
        )}
        <ul className="card-abilities">
          {lines.map((a) => {
            const usable = Boolean(onAbilityClick && usableAbilityIds?.has(a.id))
            const selected = selectedAbilityId === a.id
            const className = `ability-block${usable ? ' usable' : ''}${selected ? ' selected' : ''}`
            const body = (
              <>
                <div className="ability-head">
                  <EnergyDots cost={a.cost} size="lg" />
                  <span className="ability-name">{a.name}</span>
                  {a.flags && <span className="ability-flags">{a.flags}</span>}
                </div>
                <p className="ability-body">{a.body}</p>
                {a.upgradeCost && a.upgradeText && (
                  <div className="ability-upgrade">
                    <span className="upgrade-arrow">→</span>
                    <EnergyDots cost={a.upgradeCost} size="lg" />
                    <span>{a.upgradeText}</span>
                  </div>
                )}
              </>
            )
            return (
              <li key={a.id}>
                {usable ? (
                  <button
                    type="button"
                    className={className}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAbilityClick?.(a.id)
                    }}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
        {card.passiveText &&
          !field?.equipment.some((eq) => eq.defId === 'colossus_keystone') && (
          <div className="card-passive">
            <strong>Passive</strong> — {card.passiveText}
          </div>
        )}
        {field && field.equipment.length > 0 && (
          <div className="card-equipment">
            {field.equipment.map((eq, eqIndex) => {
              const highlighted = highlightedEquipment?.has(eqIndex)
              return (
                <span
                  key={eq.instanceId}
                  role={onEquipmentClick ? 'button' : undefined}
                  tabIndex={onEquipmentClick ? 0 : undefined}
                  className={`eq-chip${highlighted ? ' highlight' : ''}`}
                  onClick={
                    onEquipmentClick
                      ? (e) => {
                          e.stopPropagation()
                          onEquipmentClick(eqIndex)
                        }
                      : undefined
                  }
                  onKeyDown={
                    onEquipmentClick
                      ? (e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation()
                            onEquipmentClick(eqIndex)
                          }
                        }
                      : undefined
                  }
                >
                  {getCard(eq.defId).name} ♥
                  {getCard(eq.defId).kind === 'equipment' && getCard(eq.defId).indestructible
                    ? '∞'
                    : eq.hp}
                </span>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`card-face kind-${card.kind}${compact ? ' compact' : ''}`}>
      <header className="card-top">
        <span className="card-name">{card.name}</span>
        <span className="card-kind-label">{card.kind}</span>
      </header>
      {card.kind === 'equipment' && (
        <div className="card-stats">
          <span>♥ {card.maxHp}</span>
        </div>
      )}
      <p className="card-body">{cardBodyText(defId)}</p>
    </div>
  )
}
