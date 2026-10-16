import type { EnergyCost } from '../game'

/** Empty dots = require (kept). Filled dots = spend (consumed). */
export function EnergyDots({ cost, size = 'md' }: { cost: EnergyCost; size?: 'md' | 'lg' }) {
  const total = cost.require + cost.spend
  if (total === 0) {
    return <span className={`energy-dots size-${size} free`}>—</span>
  }

  const dots: Array<'empty' | 'filled'> = [
    ...Array.from({ length: cost.require }, () => 'empty' as const),
    ...Array.from({ length: cost.spend }, () => 'filled' as const),
  ]

  return (
    <span className={`energy-dots size-${size}`} aria-label={`${cost.require} empty, ${cost.spend} filled`}>
      {dots.map((kind, i) => (
        <span key={i} className={`energy-dot ${kind}`} />
      ))}
    </span>
  )
}
