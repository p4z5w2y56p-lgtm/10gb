import type { TodoItem } from '../../../shared/types'
import { Icon } from '../../ui/Icon'

/** The plan the bot keeps for itself: done, current, and what is left. */
export function PlanPopover({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((t) => t.status === 'completed').length
  return (
    <div className="plan">
      <p className="eyebrow">{`PLAN // ${done} OF ${todos.length}`}</p>
      {todos.length === 0 ? (
        <p className="plan__empty">No plan yet. ARC writes one when a task has several steps.</p>
      ) : (
        <ol className="plan__list">
          {todos.map((t) => (
            <li key={t.id} data-status={t.status} aria-current={t.status === 'in_progress' ? 'step' : undefined} className={`plan__item plan__item--${t.status}`}>
              <span className="plan__mark" aria-hidden="true">
                {t.status === 'completed' ? <Icon name="check" size={14} /> : t.status === 'in_progress' ? <span className="dot" /> : <span className="plan__ring" />}
              </span>
              <span>{t.content}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
