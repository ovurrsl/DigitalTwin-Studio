import { AppProviders } from '@panel/components/app-providers'
import type { Lang, Theme } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  title: 'DigitalTwin Studio',
  description: 'DigitalTwin: sign-in and administration console.',
}

/**
 * ovurrsl/panel's root layout, adapted to live inside the studio: the host owns
 * <html>/<body> and the fonts, so the panel's theme attribute sits on a wrapper
 * and every panel token and base rule is scoped to it (see @panel/panel.css).
 * Theme and language come from cookies so the first paint does not flash.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const jar = await cookies()
  const theme: Theme = jar.get('digitaltwin_theme')?.value === 'light' ? 'light' : 'dark'
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'en' ? 'en' : 'tr'

  return (
    <div className="min-h-screen bg-shell text-fg" data-dt-theme={theme} lang={lang}>
      <AppProviders initialLang={lang} initialTheme={theme}>
        {children}
      </AppProviders>
    </div>
  )
}
