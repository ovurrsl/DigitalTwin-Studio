import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ClientBootstrap } from './client-bootstrap'
import './globals.css'

export const metadata: Metadata = {
  title: 'DigitalTwin Studio',
  description: 'Digital twin studio built on the Pascal editor',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans">
        <ClientBootstrap>{children}</ClientBootstrap>
      </body>
    </html>
  )
}
