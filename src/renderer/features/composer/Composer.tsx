import { useState, useRef, useEffect } from 'react'
import { useAgent, useBackendStatus } from '../../state/hooks'
import type { TurnEndReason } from '../../../shared/types'

interface ComposerProps {
  onTurnEnd?: (reason: TurnEndReason) => void
}

export function Composer({ onTurnEnd }: ComposerProps) {
  const [input, setInput] = useState('')
  const [streamingOutput, setStreamingOutput] = useState('')
  const { status } = useBackendStatus()
  const { sending, error, send, stop } = useAgent()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isLocked = status?.busy ?? false

  const handleSend = async () => {
    if (!input.trim() || isLocked) return
    try {
      setStreamingOutput('')
      const reason = await send(input)
      setInput('')
      onTurnEnd?.(reason)
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }

  const handleStop = async () => {
    try {
      await stop()
    } catch (err) {
      console.error('Failed to stop:', err)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [input])

  return (
    <div className="composer">
      <div className="composer-input-area">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent to help with your code..."
          disabled={isLocked || sending}
          className="composer-textarea"
          aria-label="Agent prompt input"
        />
      </div>
      {streamingOutput && <div className="composer-output">{streamingOutput}</div>}
      {error && <div className="composer-error" role="alert">{error}</div>}
      <div className="composer-actions">
        <button
          onClick={handleSend}
          disabled={isLocked || sending || !input.trim()}
          className="btn btn-primary"
          title={isLocked ? 'Agent is busy' : 'Send prompt (Cmd/Ctrl+Enter)'}
        >
          {sending ? 'Running...' : 'Send'}
        </button>
        {sending && (
          <button onClick={handleStop} className="btn btn-secondary" title="Stop the current turn">
            Stop
          </button>
        )}
      </div>
      {isLocked && <div className="execution-lock-indicator">🔒 Agent is running</div>}
    </div>
  )
}
