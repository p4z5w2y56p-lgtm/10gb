import { useEffect, useRef, useState } from 'react'

interface CommandItem {
  id: string
  label: string
  description: string
  action: () => void | Promise<void>
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [commands, setCommands] = useState<CommandItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const baseCommands: CommandItem[] = [
      {
        id: 'send',
        label: 'New prompt',
        description: 'Focus the composer and start a new turn',
        action: () => {
          setIsOpen(false)
          const textarea = document.querySelector<HTMLTextAreaElement>('.composer-textarea')
          textarea?.focus()
        },
      },
      {
        id: 'toggle-mode',
        label: 'Toggle mode',
        description: 'Switch between ask / auto-edit / auto modes',
        action: () => setIsOpen(false),
      },
      {
        id: 'cloud-test',
        label: 'Test cloud connection',
        description: 'Validate worker URL, secrets, and GitHub access',
        action: () => setIsOpen(false),
      },
      {
        id: 'open-settings',
        label: 'Open settings',
        description: 'Open the Vertex and cloud configuration panel',
        action: () => setIsOpen(false),
      },
    ]
    setCommands(baseCommands)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsOpen((prev) => !prev)
      }
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus()
  }, [isOpen])

  const filtered = commands.filter((command) => {
    const haystack = `${command.label} ${command.description}`.toLowerCase()
    return haystack.includes(query.trim().toLowerCase())
  })

  if (!isOpen) return null

  return (
    <div className="command-palette-overlay" onClick={() => setIsOpen(false)}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="command-palette-input"
          placeholder="Type a command..."
          aria-label="Command palette search"
        />

        <div className="command-palette-list" role="listbox">
          {filtered.length === 0 && <div className="command-palette-empty">No commands found</div>}

          {filtered.map((command) => (
            <button
              key={command.id}
              type="button"
              className="command-palette-item"
              onClick={async () => {
                await command.action()
                setQuery('')
              }}
            >
              <span className="command-palette-label">{command.label}</span>
              <span className="command-palette-description">{command.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
