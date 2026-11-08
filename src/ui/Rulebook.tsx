import { useState } from 'react'
import rulesSource from '../../RULES.md?raw'

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

export function parseRules(source: string): { title: string; blocks: Block[] } {
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  let title = 'Rules'
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }
  const flushList = () => {
    if (list.length === 0) return
    blocks.push({ kind: 'list', items: list })
    list = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      flushParagraph()
      flushList()
      title = trimmed.slice(2).trim()
      continue
    }
    if (trimmed.startsWith('## ')) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', text: trimmed.slice(3).trim() })
      continue
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph()
      list.push(trimmed.slice(2).trim())
      continue
    }
    if (trimmed === '') {
      flushParagraph()
      flushList()
      continue
    }
    flushList()
    paragraph.push(trimmed)
  }
  flushParagraph()
  flushList()
  return { title, blocks }
}

export function RulesCorner() {
  const [open, setOpen] = useState(false)
  const rules = parseRules(rulesSource)

  return (
    <>
      <button
        type="button"
        className="rules-corner"
        aria-label="Rules"
        title="Rules"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 4.5h6.2c1.2 0 2.2.6 2.8 1.5.6-.9 1.6-1.5 2.8-1.5H21V18h-4.2c-1 0-1.9.4-2.5 1.1-.7-.7-1.6-1.1-2.6-1.1H5V4.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M12 6.2v12.6" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div className="modal-backdrop rules-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel rulebook"
            role="dialog"
            aria-label="Rules"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <h2>{rules.title}</h2>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>
            {rules.blocks.map((block, index) => {
              if (block.kind === 'heading') return <h3 key={index}>{block.text}</h3>
              if (block.kind === 'list') {
                return (
                  <ul key={index}>
                    {block.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )
              }
              return <p key={index}>{block.text}</p>
            })}
          </div>
        </div>
      )}
    </>
  )
}
