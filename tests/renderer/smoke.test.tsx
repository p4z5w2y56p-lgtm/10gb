// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/App'

describe('renderer', () => {
  it('mounts and names the app', () => {
    render(<App />)
    expect(screen.getByText('AIVEN ARC')).toBeInTheDocument()
  })
})
