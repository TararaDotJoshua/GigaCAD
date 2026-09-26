/** Sends transactional email. Resend in production; tests collect messages instead. */
export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

export function createResendMailer(config: { apiKey: string; from: string }): Mailer {
  return {
    async send({ to, subject, text }) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.from, to: [to], subject, text }),
      });
      if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}: ${await response.text()}`);
    },
  };
}
