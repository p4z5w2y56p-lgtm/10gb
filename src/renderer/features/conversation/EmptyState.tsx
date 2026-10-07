import { useState } from 'react'
import type { SuggestionKind } from '../../../shared/types'
import { Badge, type Tone } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { LogoMark } from '../../ui/Logo'
import { useApp } from '../../state/store'

const KIND_TONE: Record<SuggestionKind, Tone> = {
  feature: 'signal',
  fix: 'danger',
  test: 'success',
  refactor: 'neutral',
  polish: 'neutral',
  wild: 'warning',
}

const MAX_IDEAS = 3

export function EmptyState() {
  const { state, actions } = useApp()
  const [fetching, setFetching] = useState(false)
  const app = state.app

  if (!app) {
    return (
      <div className="empty" aria-busy="true">
        <LogoMark size={56} />
      </div>
    )
  }

  if (!app.hasProject) {
    return (
      <div className="empty">
        <LogoMark size={56} />
        <p className="eyebrow">ARC // NO PROJECT</p>
        <h2 className="empty__title">Open a folder to begin</h2>
        <p className="empty__lede">Pick the project you want to work on. ARC reads it, plans the work and asks before it changes anything.</p>
        <Button variant="primary" size="lg" icon="folder" onClick={() => void actions.chooseProject()}>
          Open a folder
        </Button>
      </div>
    )
  }

  const ideas = state.suggestions.slice(0, MAX_IDEAS)
  const getIdeas = async () => {
    setFetching(true)
    try {
      await actions.spark()
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="empty">
      <LogoMark size={56} />
      <p className="eyebrow">ARC // READY</p>
      <h2 className="empty__title">What are we building?</h2>
      <p className="empty__lede">Describe it in plain words. ARC shows its progress and asks before it changes anything.</p>
      {ideas.length > 0 ? (
        <ul className="empty__ideas" aria-label="Ideas">
          {ideas.map((s) => (
            // Title first in the DOM so the button's name starts with it; the grid puts the badge on top.
            <li key={s.title}>
              <button type="button" className="idea" onClick={() => void actions.sendMessage(s.prompt)}>
                <span className="idea__title">{s.title}</span>
                <span className="idea__prompt">{s.prompt}</span>
                <span className="idea__kind">
                  <Badge tone={KIND_TONE[s.kind]}>{s.kind}</Badge>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Button variant="outline" icon="sparkles" loading={fetching} disabled={state.busy} onClick={() => void getIdeas()}>
          Get ideas
        </Button>
      )}
    </div>
  )
}
