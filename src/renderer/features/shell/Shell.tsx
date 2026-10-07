import type { ReactNode } from 'react'
import { Header } from '../header/Header'
import { Sidebar } from './Sidebar'

/** Sidebar on the left, then the slim header over the conversation. No right sidebar. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell__col">
        <Header />
        <main className="shell__main">{children}</main>
      </div>
    </div>
  )
}
