import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Popover } from '../../ui/Popover'
import { baseName, dirName } from '../../ui/format'
import { useApp } from '../../state/store'

export function ChangesPopover() {
  const { state, actions } = useApp()
  const [open, setOpen] = useState(false)
  const { files, canUndo } = state.changes
  const root = state.app?.projectRoot ?? ''
  const relDir = (p: string) => {
    const dir = dirName(p)
    return root && dir.startsWith(root) ? dir.slice(root.length).replace(/^\//, '') : dir
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label="Changes"
      trigger={
        <Button variant="outline" size="sm" icon="edit" disabled={files.length === 0}>
          Changes
          {files.length > 0 ? <span className="count tabular">{files.length}</span> : null}
        </Button>
      }
    >
      <div className="changes">
        <p className="eyebrow">{`CHANGES // ${files.length} ${files.length === 1 ? 'FILE' : 'FILES'}`}</p>
        <ul className="changes__list">
          {files.map((f) => (
            <li key={f} title={f} className="changes__item">
              <Icon name="file" size={15} />
              <span className="changes__name">{baseName(f)}</span>
              <span className="changes__dir">{relDir(f)}</span>
            </li>
          ))}
        </ul>
        <div className="changes__foot">
          <Button
            size="sm"
            icon="undo"
            disabled={!canUndo}
            onClick={async () => {
              await actions.undo()
              setOpen(false)
            }}
          >
            Undo last changes
          </Button>
        </div>
      </div>
    </Popover>
  )
}
