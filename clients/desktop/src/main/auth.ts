import { homedir } from 'node:os';
import { giga } from './cli.js';

export interface PendingSignIn {
  readonly userCode: string;
  readonly verificationUri: string;
}

/** `giga login` prints this notice even with --json. */
const NOTICE = /open (\S+) and enter the code (\S+)/;

/**
 * Signs in with the device flow by running `giga login` in-process, so the token lands in the
 * same place the terminal `giga` reads it from: signing in here signs the terminal in too.
 */
export class SignIn {
  pending: PendingSignIn | null = null;
  private attempt = 0;

  constructor(
    private readonly onChange: () => void,
    private readonly openBrowser: (url: string) => Promise<void>,
  ) {}

  /** Resolves true once approved in the browser, false if cancelled or replaced by a newer attempt. */
  async start(apiUrl: string): Promise<boolean> {
    const attempt = ++this.attempt;
    try {
      await giga(['login'], {
        cwd: homedir(),
        apiUrl,
        openBrowser: this.openBrowser,
        onMessage: (line) => {
          const match = line.match(NOTICE);
          if (match && attempt === this.attempt) {
            this.pending = { verificationUri: match[1]!, userCode: match[2]! };
            this.onChange();
          }
        },
      });
      return attempt === this.attempt;
    } finally {
      if (attempt === this.attempt) {
        this.pending = null;
        this.onChange();
      }
    }
  }

  /** Stops showing the code. The browser approval, if it still happens, is ignored. */
  cancel(): void {
    this.attempt++;
    this.pending = null;
    this.onChange();
  }

  async signOut(apiUrl: string): Promise<void> {
    await giga(['logout'], { cwd: homedir(), apiUrl });
  }
}
