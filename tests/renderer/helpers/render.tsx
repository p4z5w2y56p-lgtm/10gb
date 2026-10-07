import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'

/** Wraps Testing Library's render. Task 2 teaches it to provide the app store and a fake arc. */
export function renderWithApp(ui: ReactElement, options?: RenderOptions) {
  return render(ui, options)
}
