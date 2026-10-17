import { describe, expect, it } from 'vitest';
import { sendAll, type MailMessage } from './mail.js';

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
