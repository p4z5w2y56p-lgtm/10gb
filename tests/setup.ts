import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when test globals are on; we keep them off.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})
