import { useEffect } from 'react'
import { useBackendStatus, useCloudSessions, useCloudSession } from '../../state/hooks'

export function Sidebar() {
  const { status } = useBackendStatus()
  const { sessions, loading: sessionsLoading } = useCloudSessions()
  const { diff, diffLoading, fetchDiff } = useCloudSession()

  useEffect(() => {
    void fetchDiff()
  }, [fetchDiff])

  const activeCloudAgents = sessions.filter((session) => session.busy).length
  const cloudReady = sessions.length > 0

  return (
    <aside className="sidebar" aria-label="Navigation and change list">
      <div className="sidebar-section">
        <h3>Workspace</h3>
        <div className="sidebar-item muted">{status?.projectRoot ?? 'No project opened'}</div>
      </div>

      <div className="sidebar-section">
        <h3>Cloud</h3>
        <div className="sidebar-item">
          <span className="pill">{activeCloudAgents} active</span>
          <span className="status-dot online" />
          {cloudReady ? 'Workers online' : 'No workers'}
        </div>
        {sessionsLoading ? (
          <div className="sidebar-item muted">Checking sessions...</div>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="sidebar-item compact">
              <span className="session-name">{session.repo}</span>
              <span className="session-branch">{session.branch}</span>
              <span className={`mini-badge ${session.busy ? 'busy' : ''}`}>
                {session.busy ? 'Running' : 'Idle'}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-section">
        <h3>Modified Files</h3>
        {diffLoading ? (
          <div className="sidebar-item muted">Loading file list...</div>
        ) : diff && diff.files.length > 0 ? (
          diff.files.map((file) => (
            <div key={file.path} className="sidebar-item diff-file">
              <span className="file-status" data-status={file.status}>{file.status}</span>
              <span className="file-path">{file.path}</span>
              <span className="file-changes">+{file.additions} / -{file.deletions}</span>
            </div>
          ))
        ) : (
          <div className="sidebar-item muted">No modified files</div>
        )}
      </div>
    </aside>
  )
}
