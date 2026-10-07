import { useEffect, useMemo, useState } from 'react'
import { AppProvider } from './state/context'
import { useBackendStatus, useCloudStatus, useCloudSessions } from './state/hooks'
import { Composer } from './features/composer/Composer'
import { CommandPalette } from './features/palette/CommandPalette'
import { CloudSettings } from './features/settings/CloudSettings'
import { Sidebar } from './features/navigation/Sidebar'

function AppContent() {
  const { status, loading: statusLoading, error: statusError } = useBackendStatus()
  const { cloudStatus } = useCloudStatus()
  const { sessions } = useCloudSessions()
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        // palette opens itself via its own listener; this just keeps app-level focus stable
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const activeAgents = useMemo(() => sessions.filter((s) => s.busy).length, [sessions])

  if (statusLoading) {
    return <main className="shell loading">Loading ARC…</main>
  }

  if (statusError) {
    return <main className="shell error">{statusError}</main>
  }

  const ready = !!status?.ready

  return (
    <>
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark">ARC</span>
          <div>
            <div className="brand-title">AIVEN ARC</div>
            <div className="brand-subtitle">Vertex AI coding assistant</div>
          </div>
        </div>

        <div className="header-tools">
          <div className="status-pill busy">{status?.busy ? 'Working' : 'Idle'}</div>
          <div className="status-pill cloud">{activeAgents} cloud agents</div>
          <button className="btn btn-secondary" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>

      <div className="app-shell">
        <Sidebar />

        <main className="app-main">
          {!ready ? (
            <section className="setup-panel">
              <h1>Welcome to AIVEN ARC</h1>
              <p>Set up your Vertex AI API key and cloud settings to begin.</p>
              <button className="btn btn-primary" onClick={() => setShowSettings(true)}>
                Configure
              </button>
            </section>
          ) : (
            <>
              <Composer onTurnEnd={() => undefined} />
              <div className="footer-strip">
                <span>{status?.projectRoot ?? 'No project opened'}</span>
                <span>{cloudStatus?.configured ? 'Cloud connected' : 'Cloud not configured'}</span>
              </div>
            </>
          )}
        </main>
      </div>

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="btn btn-tertiary" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <CloudSettings />
            </div>
          </div>
        </div>
      )}

      <CommandPalette />
    </>
  )
}

export function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}
