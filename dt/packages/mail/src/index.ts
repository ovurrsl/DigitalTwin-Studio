export type Mail = { to: string; subject: string; text: string; html?: string }

export type MailResult = { delivered: boolean; reason?: 'not-configured' | 'provider-error' }

/**
 * Sends through Resend when RESEND_API_KEY and DT_MAIL_FROM are set. Without them
 * the message is only logged, and callers that hand out links (invites, resets)
 * also return the link so an admin can pass it on from the console.
 */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.DT_MAIL_FROM
  if (!(apiKey && from)) {
    console.info(`[dt/mail] not configured; would send "${mail.subject}" to ${mail.to}`)
    return { delivered: false, reason: 'not-configured' }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    console.error(`[dt/mail] Resend responded ${res.status} for "${mail.subject}"`)
    return { delivered: false, reason: 'provider-error' }
  }
  return { delivered: true }
}
