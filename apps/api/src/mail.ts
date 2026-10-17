/** One transactional email. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends transactional email. Resend in production; tests collect messages instead. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Sends several in one request, when the provider can. Each message has its own recipient. */
  sendBatch?(messages: readonly MailMessage[]): Promise<void>;
}

/** A slow mail provider shouldn't hold a request (or a notice) open indefinitely. */
const TIMEOUT_MS = 10_000;
/** Resend's batch endpoint takes up to 100 emails a call. */
const BATCH_SIZE = 100;

export function createResendMailer(config: { apiKey: string; from: string }): Mailer {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`https://api.resend.com${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}: ${await response.text()}`);
  };
  const email = ({ to, subject, text }: MailMessage) => ({ from: config.from, to: [to], subject, text });
  return {
    send: (message) => post('/emails', email(message)),
    async sendBatch(messages) {
      for (let start = 0; start < messages.length; start += BATCH_SIZE) await post('/emails/batch', messages.slice(start, start + BATCH_SIZE).map(email));
    },
  };
}

/**
 * Sends every message, one failure never stopping the rest: in one batch where the mailer
 * can, otherwise one by one. Throws once at the end if any failed, naming how many.
 */
export async function sendAll(mailer: Mailer, messages: readonly MailMessage[]): Promise<void> {
  if (messages.length === 0) return;
  if (messages.length > 1 && mailer.sendBatch) return mailer.sendBatch(messages);
  const results = await Promise.allSettled(messages.map((message) => mailer.send(message)));
  const failed = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failed.length > 0) throw new AggregateError(failed, `${failed.length} of ${messages.length} emails not sent`);
}
