import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { LogoMark, Wordmark } from '../../ui/Logo'
import { baseName, formatAgo } from '../../ui/format'
import { useApp } from '../../state/store'

export function Sidebar() {
  const { state, actions } = useApp()
  if (!state.ui.sidebar) return null
  const root = state.app?.projectRoot
  const ready = state.app?.ready

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar__brand drag">
        <LogoMark size={30} />
        <Wordmark />
      </div>

      <div className="project no-drag">
        {root ? (
          <>
            <div className="project__text">
              <span className="project__name">{baseName(root)}</span>
              <span className="project__path" title={root}>
                {root}
              </span>
            </div>
            <Button variant="ghost" size="sm" icon="folder" aria-label="Open folder" onClick={() => void actions.chooseProject()} />
          </>
        ) : (
          <div className="project__empty">
            <span className="project__name">No project open</span>
            <Button size="sm" icon="folder" onClick={() => void actions.chooseProject()}>
              Open a folder
            </Button>
          </div>
        )}
      </div>

      {root ? (
        <Button className="sidebar__new no-drag" icon="plus" onClick={() => void actions.newSession()}>
          New session
        </Button>
      ) : null}

      <p className="eyebrow sidebar__heading">SESSIONS</p>
      <div className="sidebar__sessions no-drag">
        {state.sessions.length === 0 ? (
          <p className="sidebar__empty">No sessions yet. They appear here after your first message.</p>
        ) : (
          <ul aria-label="Sessions" className="sessions">
            {state.sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`session${s.id === state.app?.sessionId ? ' is-active' : ''}`}
                  aria-current={s.id === state.app?.sessionId ? 'true' : undefined}
                  onClick={() => void actions.resumeSession(s.id)}
                >
                  <span className="session__title">{s.title || 'Untitled'}</span>
                  <span className="session__time">{formatAgo(s.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar__foot no-drag">
        {ready ? <Badge tone="success" dot>KEY // CONNECTED</Badge> : <Badge tone="danger">KEY // MISSING</Badge>}
        <Button variant="ghost" size="sm" icon="settings" aria-label="Settings" onClick={() => actions.ui({ settingsOpen: true, settingsSection: 'models' })} />
      </div>
    </aside>
  )
}
