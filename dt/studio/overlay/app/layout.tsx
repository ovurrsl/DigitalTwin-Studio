import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DtProviders } from './dt-providers'
import UpstreamLayout from './upstream-layout'

export const metadata: Metadata = {
  title: 'DigitalTwin Studio',
  description: 'Digital twin studio built on the Pascal editor',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <UpstreamLayout>
      <DtProviders>{children}</DtProviders>
    </UpstreamLayout>
  )
}
