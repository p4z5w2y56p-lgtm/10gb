// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Badge } from '../../src/renderer/ui/Badge'
import { Button } from '../../src/renderer/ui/Button'
import { Dialog } from '../../src/renderer/ui/Dialog'
import { Field, TextInput } from '../../src/renderer/ui/Field'
import { ICON_NAMES, Icon } from '../../src/renderer/ui/Icon'
import { Kbd } from '../../src/renderer/ui/Kbd'
import { Panel } from '../../src/renderer/ui/Panel'
import { Popover } from '../../src/renderer/ui/Popover'
import { ProgressBar } from '../../src/renderer/ui/ProgressBar'
import { Segmented } from '../../src/renderer/ui/Segmented'
import { Select } from '../../src/renderer/ui/Select'
import { ToastProvider, useToast } from '../../src/renderer/ui/Toast'
import { Toggle } from '../../src/renderer/ui/Toggle'

afterEach(() => {
  vi.useRealTimers()
})

describe('Icon', () => {
  it('has every icon the app uses, each an aria-hidden svg', () => {
    for (const name of ['arrow-right', 'bolt', 'chart-up', 'cpu', 'eye', 'plug', 'radar', 'target', 'terminal', 'check', 'x', 'warn', 'lock', 'key', 'folder', 'file', 'plus', 'minus', 'chevron-down', 'chevron-right', 'search', 'sparkles', 'undo', 'stop', 'settings', 'sidebar', 'clock', 'edit', 'shield', 'play', 'send']) {
      expect(ICON_NAMES).toContain(name)
    }
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg, name).toBeTruthy()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      unmount()
    }
  })
})

describe('Button', () => {
  it('loading disables it and marks it busy', () => {
    render(<Button loading>Save</Button>)
    const b = screen.getByRole('button', { name: /save/i })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
  })

  it('applies the variant classes', () => {
    render(
      <>
        <Button variant="primary">A</Button>
        <Button variant="outline">B</Button>
        <Button variant="ghost">C</Button>
        <Button variant="danger">D</Button>
      </>,
    )
    expect(screen.getByText('A').closest('button')).toHaveClass('btn--primary')
    expect(screen.getByText('B').closest('button')).toHaveClass('btn--outline')
    expect(screen.getByText('C').closest('button')).toHaveClass('btn--ghost')
    expect(screen.getByText('D').closest('button')).toHaveClass('btn--danger')
  })

  it('activates with Enter and Space', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('an icon-only button needs and uses an accessible name', () => {
    render(<Button icon="settings" aria-label="Settings" />)
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
  })
})

describe('Badge, Panel, Kbd', () => {
  it('renders tone classes and a live dot', () => {
    const { container } = render(<Badge tone="success" dot>LIVE</Badge>)
    expect(container.querySelector('.badge')).toHaveClass('badge--success')
    expect(container.querySelector('.dot')).toBeTruthy()
  })
  it('renders glass and deep panels and a key cap', () => {
    const { container } = render(<><Panel tone="deep">x</Panel><Panel>y</Panel><Kbd>⌘K</Kbd></>)
    expect(container.querySelector('.panel--deep')).toBeTruthy()
    expect(container.querySelectorAll('.panel')).toHaveLength(2)
    expect(screen.getByText('⌘K').tagName).toBe('KBD')
  })
})

describe('Field and TextInput', () => {
  it('ties the label to the input and announces errors', () => {
    render(
      <Field label="API key" hint="Stored in the Keychain" error="Required">
        <TextInput />
      </Field>,
    )
    const input = screen.getByLabelText('API key')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByText('Stored in the Keychain')).toBeInTheDocument()
  })
})

describe('Toggle', () => {
  it('is a switch that flips on click and on Space', async () => {
    function Demo() {
      const [on, setOn] = useState(false)
      return <Toggle checked={on} onChange={setOn} label="Show details" />
    }
    render(<Demo />)
    const sw = screen.getByRole('switch', { name: 'Show details' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    sw.focus()
    await userEvent.keyboard(' ')
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Segmented', () => {
  function Demo({ onChange = () => undefined }: { onChange?: (v: string) => void }) {
    const [v, setV] = useState('ask')
    return (
      <Segmented
        aria-label="Mode"
        value={v}
        onChange={(x) => {
          setV(x)
          onChange(x)
        }}
        options={[
          { value: 'ask', label: 'Ask' },
          { value: 'auto-edit', label: 'Auto-edit' },
          { value: 'auto', label: 'Auto' },
        ]}
      />
    )
  }

  it('is a radiogroup and click selects', async () => {
    render(<Demo />)
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Auto-edit' }))
    expect(screen.getByRole('radio', { name: 'Auto-edit' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Ask' })).toHaveAttribute('aria-checked', 'false')
  })

  it('moves selection with the arrow keys, Home and End', async () => {
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    screen.getByRole('radio', { name: 'Ask' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('auto-edit')
    await userEvent.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('auto')
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('ask')
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('auto')
    await userEvent.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('ask')
  })
})

describe('Select', () => {
  function Demo({ onChange = () => undefined, custom = false }: { onChange?: (v: string) => void; custom?: boolean }) {
    const [v, setV] = useState('a')
    return (
      <Select
        aria-label="Model"
        value={v}
        allowCustom={custom}
        customLabel="Custom model id"
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta', hint: 'faster' },
        ]}
        onChange={(x) => {
          setV(x)
          onChange(x)
        }}
      />
    )
  }

  it('opens on click, lists the options and chooses with the mouse', async () => {
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    expect(trigger).toHaveTextContent('Alpha')
    await userEvent.click(trigger)
    const list = screen.getByRole('listbox')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alpha', 'Betafaster'])
    await userEvent.click(within(list).getByRole('option', { name: /Beta/ }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveTextContent('Beta')
  })

  it('works from the keyboard and Escape returns focus to the trigger', async () => {
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('allowCustom adds a Custom entry that takes any id', async () => {
    const onChange = vi.fn()
    render(<Demo onChange={onChange} custom />)
    await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    await userEvent.click(screen.getByRole('option', { name: 'Custom…' }))
    const input = screen.getByRole('textbox', { name: 'Custom model id' })
    await userEvent.type(input, 'my-model{Enter}')
    expect(onChange).toHaveBeenCalledWith('my-model')
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('my-model')
  })

  it('shows a value that is not in the list as it is', () => {
    render(<Select aria-label="Model" value="weird-id" options={[{ value: 'a', label: 'Alpha' }]} onChange={() => undefined} allowCustom />)
    expect(screen.getByRole('combobox')).toHaveTextContent('weird-id')
  })
})

describe('Popover', () => {
  function Demo() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Popover open={open} onOpenChange={setOpen} trigger={<button>Open</button>}>
          <p>Popover body</p>
        </Popover>
        <button>Outside</button>
      </>
    )
  }

  it('opens on click and closes on an outside press', async () => {
    render(<Demo />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByText('Popover body')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByText('Popover body')).toBeNull()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Demo />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(trigger)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Popover body')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('reports expanded state on the trigger', async () => {
    render(<Demo />)
    const trigger = screen.getByRole('button', { name: 'Open' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Dialog', () => {
  function Demo({ onClose = () => undefined }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <button onClick={() => setOpen(true)}>Open dialog</button>
        <Dialog
          open={open}
          title="Switch to Auto"
          onClose={() => {
            setOpen(false)
            onClose()
          }}
          actions={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary">Confirm</Button>
            </>
          }
        >
          <p>This lets ARC run commands without asking.</p>
        </Dialog>
      </>
    )
  }

  it('is a modal dialog with a name, and focus moves inside', async () => {
    render(<Demo />)
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = screen.getByRole('dialog', { name: 'Switch to Auto' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps Tab inside the dialog', async () => {
    render(<Demo />)
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = screen.getByRole('dialog')
    for (let i = 0; i < 6; i++) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement), `tab ${i}`).toBe(true)
    }
    for (let i = 0; i < 3; i++) {
      await userEvent.tab({ shift: true })
      expect(dialog.contains(document.activeElement), `shift-tab ${i}`).toBe(true)
    }
  })

  it('Escape calls onClose and focus returns to the opener', async () => {
    const onClose = vi.fn()
    render(<Demo onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await userEvent.click(opener)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('renders nothing while closed', () => {
    render(<Dialog open={false} title="x" onClose={() => undefined}>y</Dialog>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Toast', () => {
  function Demo() {
    const toast = useToast()
    return <button onClick={() => toast.push({ tone: 'success', text: 'Saved' })}>Push</button>
  }

  it('shows a toast and dismisses it after four seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<ToastProvider><Demo /></ToastProvider>)
    await user.click(screen.getByRole('button', { name: 'Push' }))
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(3900)
    })
    expect(screen.getByText('Saved')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('can be dismissed by hand', async () => {
    render(<ToastProvider><Demo /></ToastProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Push' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Saved')).toBeNull()
  })
})

describe('ProgressBar', () => {
  it('exposes progressbar semantics and clamps the value', () => {
    const { rerender } = render(<ProgressBar value={3} max={7} label="Plan progress" />)
    const bar = screen.getByRole('progressbar', { name: 'Plan progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '3')
    expect(bar).toHaveAttribute('aria-valuemax', '7')
    rerender(<ProgressBar value={99} max={7} label="Plan progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '7')
    rerender(<ProgressBar value={-4} max={7} label="Plan progress" />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
})
