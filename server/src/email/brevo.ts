/**
 * Transactional email through Brevo's HTTP API.
 *
 * The sender address is configuration (`EMAIL_FROM_ADDRESS`), so moving to a
 * verified domain is an env change rather than a code change. Sending is
 * best-effort: a mail outage must never turn a signup or a password reset into
 * a 500, so failures are logged and reported as `false`.
 */
import { loadConfig } from '../env.js';
import { logger } from '../log.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 10_000;

/** True when a sender and an API key are both configured. */
export function emailConfigured(): boolean {
  const config = loadConfig();
  return Boolean(config.emailApiKey && config.emailFromAddress);
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const config = loadConfig();
  if (!emailConfigured()) {
    logger.warn({ to: message.to, subject: message.subject }, 'email not configured; not sent');
    return false;
  }

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': config.emailApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: config.emailFromName, email: config.emailFromAddress },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.error(
        { status: response.status, body: (await response.text()).slice(0, 500) },
        'brevo rejected the message',
      );
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ err: error }, 'brevo request failed');
    return false;
  }
}

/** Minimal shared layout so both emails look like they came from the same app. */
function layout(heading: string, body: string[], action?: { url: string; label: string }): string {
  const paragraphs = body.map((line) => `<p style="margin:0 0 12px">${line}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${action.url}" style="background:#e3a455;color:#0b0c0f;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${action.label}</a></p>`
    : '';
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#14161b">',
    `<h1 style="font-size:20px;margin:0 0 16px">${heading}</h1>`,
    paragraphs,
    button,
    '<p style="margin:24px 0 0;font-size:12px;color:#6b7280">If you did not ask for this, you can ignore this message.</p>',
    '</div>',
  ].join('');
}

export function verificationEmail(link: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Confirm your ChessForge email',
    text: `Confirm your email address to finish setting up your ChessForge account:\n\n${link}\n\nThis link expires in 24 hours.`,
    html: layout(
      'Confirm your email',
      ['Confirm this address to finish setting up your ChessForge account. The link is valid for 24 hours.'],
      { url: link, label: 'Confirm email' },
    ),
  };
}

export function passwordResetEmail(link: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Reset your ChessForge password',
    text: `Use this link to choose a new password:\n\n${link}\n\nThis link expires in 30 minutes and works once. If you did not request it, ignore this message.`,
    html: layout(
      'Reset your password',
      [
        'Use the button below to choose a new password. The link expires in 30 minutes and works only once.',
        'If you did not request a reset, no action is needed — your password is unchanged.',
      ],
      { url: link, label: 'Choose a new password' },
    ),
  };
}
