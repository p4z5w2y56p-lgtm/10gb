import { act, render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { Arc } from '../../../src/renderer/arc/client'
import { AppProvider, useApp, type AppContextValue } from '../../../src/renderer/state/store'
import { createFakeArc, type FakeArc } from './fakeArc'

/** Captures the live store so tests can read state and call actions. */
function Probe({ target }: { target: { current: AppContextValue | null } }) {
  target.current = useApp()
  return null
}

/** Render inside the real AppProvider, talking to a fake arc. */
export async function renderWithApp(ui: ReactElement, opts: { arc?: FakeArc; renderOptions?: RenderOptions } = {}) {
  const arc = opts.arc ?? createFakeArc()
  const live: { current: AppContextValue | null } = { current: null }
  const view = render(
    <AppProvider arc={arc as Arc}>
      <Probe target={live} />
      {ui}
    </AppProvider>,
    opts.renderOptions,
  )
  // let the initial load settle
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return {
    ...view,
    arc,
    app: () => live.current!,
    state: () => live.current!.state,
    emit: (event: Parameters<FakeArc['emit']>[0]) => act(() => arc.emit(event)),
  }
}
