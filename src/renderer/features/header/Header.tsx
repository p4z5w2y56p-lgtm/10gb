import { Button } from '../../ui/Button'
import { baseName } from '../../ui/format'
import { useApp } from '../../state/store'
import { ChangesPopover } from './ChangesPopover'
import { ModeChip } from './ModeChip'
import { ProgressPill } from './ProgressPill'

/** The one slim bar: where you are, what the bot is doing, and the few controls that matter. */
export function Header() {
  const { state, actions } = useApp()
  const root = state.app?.projectRoot
  const canSpark = Boolean(state.app?.ready && state.app?.hasProject) && !state.busy

  return (
    <header role="banner" className={`header drag${state.ui.sidebar ? '' : ' header--lights'}`}>
      <div className="header__left no-drag">
        <Button variant="ghost" size="sm" icon="sidebar" aria-label="Toggle sidebar" onClick={() => actions.ui({ sidebar: !state.ui.sidebar })} />
        <div className="header__project">
          <span className="eyebrow">ARC //</span>
          <span className="header__name">{root ? baseName(root) : 'No project'}</span>
        </div>
      </div>
      <div className="header__center no-drag">
        <ProgressPill />
      </div>
      <div className="header__right no-drag">
        <ChangesPopover />
        <ModeChip />
        <Button variant="outline" size="sm" icon="sparkles" disabled={!canSpark} onClick={() => void actions.spark()}>
          Spark
        </Button>
        <Button variant="ghost" size="sm" icon="settings" aria-label="Settings" onClick={() => actions.ui({ settingsOpen: true })} />
      </div>
    </header>
  )
}
