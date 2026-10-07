import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { useApp } from '../../state/store'

/** The agent is waiting on you: pick an option or type your own answer. */
export function QuestionCard() {
  const { state, actions } = useApp()
  const q = state.question
  const [answered, setAnswered] = useState<string | null>(null)
  const [text, setText] = useState('')
  const headingId = useId()

  // The backend keeps the question until the turn ends, so once answered it is hidden here.
  if (!q || answered === q.id) return null

  const send = (answer: string) => {
    const clean = answer.trim()
    if (!clean) return
    setAnswered(q.id)
    setText('')
    void actions.answer(clean)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    send(text)
  }

  return (
    <section className="question" role="group" aria-labelledby={headingId}>
      <div className="question__head">
        <span className="question__mark" aria-hidden="true">
          <Icon name="sparkles" size={16} />
        </span>
        <div className="question__text">
          <p className="eyebrow">ARC // QUESTION</p>
          <h2 className="question__title selectable" id={headingId}>
            {q.question}
          </h2>
        </div>
      </div>
      {q.options && q.options.length > 0 ? (
        <div className="question__options">
          {q.options.map((o) => (
            <Button key={o} variant="outline" onClick={() => send(o)}>
              {o}
            </Button>
          ))}
        </div>
      ) : null}
      <form className="question__form" onSubmit={submit}>
        <input
          className="input"
          aria-label="Your answer"
          placeholder={q.options?.length ? 'Or type your own answer' : 'Type your answer'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="primary" disabled={text.trim() === ''}>
          Send
        </Button>
      </form>
    </section>
  )
}
