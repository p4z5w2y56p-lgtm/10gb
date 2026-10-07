import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: IconName
  loading?: boolean
}

/** One primary per view. Text on the orange primary is always black. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'outline', size = 'md', icon, loading, children, className, disabled, type = 'button', ...rest },
  ref,
) {
  const iconOnly = children === undefined || children === null || children === false
  const classes = ['btn', `btn--${variant}`, `btn--${size}`, iconOnly ? 'btn--icon' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  )
})
