'use client'

import { authClient } from '@dt/identity/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, Suspense, useState } from 'react'

function ResetForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(
    params.get('error') ? 'Bağlantı geçersiz veya süresi dolmuş.' : null,
  )
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    if (!token) return
    setBusy(true)
    setError(null)
    const { error } = await authClient.resetPassword({ newPassword: password, token })
    setBusy(false)
    if (error) {
      setError(
        error.code === 'PASSWORD_TOO_SHORT'
          ? 'Şifre en az 10 karakter olmalı.'
          : 'Bağlantı geçersiz veya süresi dolmuş.',
      )
      return
    }
    router.replace('/login')
  }

  const input =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40'

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-popover p-6 shadow-elevation-3">
        <h1 className="font-semibold text-lg">Şifre belirleyin</h1>
        {token ? (
          <form className="mt-5 flex flex-col gap-3" onSubmit={submit}>
            <input
              autoComplete="new-password"
              className={input}
              minLength={10}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Yeni şifre (en az 10 karakter)"
              required
              type="password"
              value={password}
            />
            <input
              autoComplete="new-password"
              className={input}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Yeni şifre (tekrar)"
              required
              type="password"
              value={confirm}
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              className="rounded-md bg-foreground px-3 py-2 font-medium text-background text-sm disabled:opacity-60"
              disabled={busy}
              type="submit"
            >
              Kaydet
            </button>
          </form>
        ) : (
          <p className="mt-3 text-red-400 text-sm">
            {error ?? 'Bağlantı geçersiz veya süresi dolmuş.'}
          </p>
        )}
      </div>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  )
}
