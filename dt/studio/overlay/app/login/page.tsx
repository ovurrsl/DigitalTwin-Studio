'use client'

import { authClient } from '@dt/identity/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useState } from 'react'

type Step = 'password' | 'totp'

function safeNext(value: string | null): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

function LoginForm() {
  const router = useRouter()
  const next = safeNext(useSearchParams().get('next'))
  const [step, setStep] = useState<Step>('password')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submitPassword(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const credentials = { password, rememberMe: true }
    const { data, error } = identifier.includes('@')
      ? await authClient.signIn.email({ email: identifier, ...credentials })
      : await authClient.signIn.username({ username: identifier, ...credentials })
    setBusy(false)
    if (error) {
      const retry = (error as { retryAfterSeconds?: number }).retryAfterSeconds
      if (error.code === 'ACCOUNT_LOCKED') {
        setError(`Çok fazla hatalı deneme. ${retry ?? ''} sn sonra tekrar deneyin.`)
      } else if (error.code === 'ACCOUNT_INACTIVE') {
        setError('Bu hesap etkin değil. Yöneticinize başvurun.')
      } else {
        setError('E-posta/kullanıcı adı veya şifre hatalı.')
      }
      return
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      setStep('totp')
      return
    }
    router.replace(next)
  }

  async function submitTotp(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await authClient.twoFactor.verifyTotp({ code, trustDevice: true })
    setBusy(false)
    if (error) {
      setError('Doğrulama kodu geçersiz.')
      return
    }
    router.replace(next)
  }

  const input =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40'

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-popover p-6 shadow-elevation-3">
        <h1 className="font-semibold text-lg">DigitalTwin Studio</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          {step === 'password'
            ? 'Hesabınızla giriş yapın.'
            : 'Doğrulama uygulamanızdaki kodu girin.'}
        </p>
        {step === 'password' ? (
          <form className="mt-5 flex flex-col gap-3" onSubmit={submitPassword}>
            <input
              autoComplete="username"
              className={input}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="E-posta veya kullanıcı adı"
              required
              value={identifier}
            />
            <input
              autoComplete="current-password"
              className={input}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Şifre"
              required
              type="password"
              value={password}
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              className="rounded-md bg-foreground px-3 py-2 font-medium text-background text-sm disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
            </button>
          </form>
        ) : (
          <form className="mt-5 flex flex-col gap-3" onSubmit={submitTotp}>
            <input
              autoComplete="one-time-code"
              className={input}
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 haneli kod"
              required
              value={code}
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              className="rounded-md bg-foreground px-3 py-2 font-medium text-background text-sm disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              Doğrula
            </button>
          </form>
        )}
        <p className="mt-5 text-muted-foreground text-xs">
          Hesaplar yönetici tarafından oluşturulur. Erişim için yöneticinize başvurun.
        </p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
