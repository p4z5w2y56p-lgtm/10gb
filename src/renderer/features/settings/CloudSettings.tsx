import { useState, useEffect } from 'react'
import { useCloudStatus, useCloudTest } from '../../state/hooks'

export function CloudSettings() {
  const { cloudStatus, setSecret, clearSecret, loading, error } = useCloudStatus()
  const { test, testing, results } = useCloudTest()
  const [workerUrl, setWorkerUrl] = useState('')
  const [cloudToken, setCloudToken] = useState('')
  const [githubToken, setGithubToken] = useState('')
  const [model, setModel] = useState('gemini-3.8-flash')

  useEffect(() => {
    if (cloudStatus?.workerUrl) {
      setWorkerUrl(cloudStatus.workerUrl)
    }
  }, [cloudStatus?.workerUrl])

  const handleSetCloudToken = async () => {
    if (!cloudToken.trim()) return
    try {
      await setSecret('cloud-token', cloudToken)
      setCloudToken('')
    } catch (err) {
      console.error('Failed to set cloud token:', err)
    }
  }

  const handleSetGithubToken = async () => {
    if (!githubToken.trim()) return
    try {
      await setSecret('github-token', githubToken)
      setGithubToken('')
    } catch (err) {
      console.error('Failed to set GitHub token:', err)
    }
  }

  const handleClearCloudToken = async () => {
    try {
      await clearSecret('cloud-token')
    } catch (err) {
      console.error('Failed to clear cloud token:', err)
    }
  }

  const handleClearGithubToken = async () => {
    try {
      await clearSecret('github-token')
    } catch (err) {
      console.error('Failed to clear GitHub token:', err)
    }
  }

  const handleTest = async () => {
    try {
      await test()
    } catch (err) {
      console.error('Test failed:', err)
    }
  }

  if (loading && !cloudStatus) {
    return <div className="cloud-settings-loading">Loading cloud configuration...</div>
  }

  return (
    <div className="cloud-settings">
      <h2>Cloud Worker Configuration</h2>

      {error && <div className="cloud-settings-error" role="alert">{error}</div>}

      <div className="settings-section">
        <h3>Worker URL</h3>
        <p className="help-text">HTTPS address of your ARC cloud worker (Cloud Run or self-hosted)</p>
        <div className="form-group">
          <input
            type="url"
            value={workerUrl}
            onChange={(e) => setWorkerUrl(e.target.value)}
            placeholder="https://arc-worker-example.run.app"
            className="input"
            aria-label="Cloud worker URL"
          />
        </div>
      </div>

      <div className="settings-section">
        <h3>Vertex AI Model Configuration</h3>
        <div className="form-group">
          <label htmlFor="model-select">Model</label>
          <select
            id="model-select"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="input"
          >
            <option value="gemini-3.8-flash">Gemini 3.8 Flash (Recommended)</option>
            <option value="gemini-2.0-pro">Gemini 2.0 Pro</option>
            <option value="claude-3-opus">Claude 3 Opus</option>
          </select>
          <p className="help-text">3.8 Flash is optimized for coding tasks and cost-efficiency</p>
        </div>
      </div>

      <div className="settings-section">
        <h3>Authentication</h3>

        <div className="form-group">
          <label htmlFor="cloud-token-input">Cloud Worker Token</label>
          <p className="help-text">32+ character token for worker authorization</p>
          <input
            id="cloud-token-input"
            type="password"
            value={cloudToken}
            onChange={(e) => setCloudToken(e.target.value)}
            placeholder="Paste token here"
            className="input"
            aria-label="Cloud worker authentication token"
          />
          <div className="token-actions">
            <button
              onClick={handleSetCloudToken}
              disabled={!cloudToken.trim()}
              className="btn btn-secondary"
              type="button"
            >
              Save Token
            </button>
            {cloudStatus?.hasCloudToken && (
              <>
                <span className="token-status">✓ Token saved</span>
                <button
                  onClick={handleClearCloudToken}
                  className="btn btn-tertiary"
                  type="button"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="github-token-input">GitHub Personal Access Token</label>
          <p className="help-text">Fine-grained token with Contents and Pull Requests access on selected repos</p>
          <input
            id="github-token-input"
            type="password"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="github_pat_..."
            className="input"
            aria-label="GitHub personal access token"
          />
          <div className="token-actions">
            <button
              onClick={handleSetGithubToken}
              disabled={!githubToken.trim()}
              className="btn btn-secondary"
              type="button"
            >
              Save Token
            </button>
            {cloudStatus?.hasGithubToken && (
              <>
                <span className="token-status">✓ Token saved</span>
                <button
                  onClick={handleClearGithubToken}
                  className="btn btn-tertiary"
                  type="button"
                >
                  Clear
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <h3>Connectivity Test</h3>
        <p className="help-text">Verify worker, tokens, and GitHub access in one step</p>
        <button
          onClick={handleTest}
          disabled={testing}
          className="btn btn-primary"
          type="button"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>

        {results && results.length > 0 && (
          <div className="test-results">
            {results.map((result, idx) => (
              <div
                key={idx}
                className={`test-result ${result.ok ? 'ok' : 'error'}`}
                role="status"
              >
                <span className="test-label">{result.label}:</span>
                <span className="test-message">{result.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-section">
        <h3>Auto-Push</h3>
        <p className="help-text">Automatically push completed turns to GitHub</p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            defaultChecked={cloudStatus?.autoPush ?? true}
            className="checkbox"
          />
          <span>Enable auto-push</span>
        </label>
      </div>
    </div>
  )
}
