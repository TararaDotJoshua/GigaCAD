import { describe, expect, it } from 'vitest';
import { createResendMailer, sendAll, type MailMessage } from './mail.js';

const message = (to: string): MailMessage => ({ to, subject: 'Hello', text: 'Hi' });

describe('sending several emails', () => {
  it('sends the rest when one fails, then says how many failed', async () => {
    const sent: string[] = [];
    const mailer = {
      send: async ({ to }: MailMessage) => {
        if (to === 'b@test') throw new Error('Resend returned HTTP 429');
        sent.push(to);
      },
    };
    await expect(sendAll(mailer, ['a@test', 'b@test', 'c@test'].map(message))).rejects.toThrow('1 of 3 emails not sent');
    expect(sent).toEqual(['a@test', 'c@test']);
  });

  it('uses one batch when the mailer has one', async () => {
    const batches: string[][] = [];
    const mailer = { send: async () => expect.fail('sent one by one'), sendBatch: async (messages: readonly MailMessage[]) => void batches.push(messages.map((m) => m.to)) };
    await sendAll(mailer, ['a@test', 'b@test'].map(message));
    expect(batches).toEqual([['a@test', 'b@test']]);
  });
});

describe('the Resend mailer', () => {
  it('sends every batch even when one fails, then reports the failures together', async () => {
    const realFetch = globalThis.fetch;
    const batches: number[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      const size = (JSON.parse(String(init.body)) as unknown[]).length;
      batches.push(size);
      return new Response(batches.length === 1 ? 'rate limited' : '{}', { status: batches.length === 1 ? 429 : 200 });
    }) as typeof fetch;
    try {
      const mailer = createResendMailer({ apiKey: 're_test', from: 'GigaCAD <notices@test>' });
      const messages = Array.from({ length: 150 }, (_, index) => message(`p${index}@test`));
      await expect(mailer.sendBatch!(messages)).rejects.toThrow('1 of 2 email batches not sent');
      // The first batch of 100 failed; the next 50 still went out.
      expect(batches).toEqual([100, 50]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
