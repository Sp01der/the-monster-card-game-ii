import { describe, expect, it } from 'vitest'
import rulesSource from '../../RULES.md?raw'
import { parseRules } from './Rulebook'

const source = rulesSource

describe('RULES.md', () => {
  it('is the text the corner icon shows', () => {
    const rules = parseRules(source)
    expect(rules.title).toBe('The Monster Card Game II')
    expect(rules.blocks.filter((block) => block.kind === 'heading').map((block) => block.text)).toEqual([
      'Turn',
      'Opening and the first turn',
      'Cards and energy',
      'Target and damage',
      'Leaving play',
      'Statuses',
    ])
    expect(source).toContain('N/6 chance of X')
    expect(source).toContain('Extremely weak is twice')
    expect(source).toContain('Removed:')
    expect(source).toContain('Destroy:')
    expect(source).toContain('Spare energy')
    expect(source).toContain('Immobilized')
  })
})
