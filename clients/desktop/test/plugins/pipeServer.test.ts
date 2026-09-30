import { randomBytes } from 'node:crypto';
import { statSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pipePath } from '../../src/main/plugins/pipeName.js';
import { PluginPipeServer } from '../../src/main/plugins/pipeServer.js';
import { encodeFrame, FrameReader, METHODS, PROTOCOL_VERSION, REQUEST_METHODS, RpcError, type Message } from '../../src/main/plugins/protocol.js';
import { PluginRegistry } from '../../src/main/plugins/registry.js';
import type { AddInSession, GigaPlugin, PluginLog } from '../../src/main/plugins/types.js';

const hello = (overrides: Record<string, unknown> = {}) => ({
  id: '0',
  method: METHODS.hello,
  params: { clientId: 'cad-addin', clientVersion: '0.1.0', protocolVersion: PROTOCOL_VERSION, cadName: 'Cad', cadVersion: '2025', processId: 1234, ...overrides },
});

/** A raw add-in: sends frames and collects every message the app sends back. */
class TestClient {
  readonly received: Message[] = [];
  closed = false;
  private readonly reader = new FrameReader();
  private waiters: (() => void)[] = [];

  private constructor(readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.received.push(...this.reader.push(chunk));
      this.wake();
    });
    socket.on('close', () => {
      this.closed = true;
      this.wake();
    });
    socket.on('error', () => undefined);
  }

  static connect(path: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(path, () => resolve(new TestClient(socket)));
      socket.once('error', reject);
    });
  }

  send(message: Message): void {
    this.socket.write(encodeFrame(message));
  }

  /** Waits for the reply to `id` (or a notification when `id` is undefined). */
  async next(id?: string): Promise<Message> {
    const find = () => this.received.find((message) => (id === undefined ? message.id === undefined : message.id === id));
    await this.until(() => find() !== undefined, `a reply to ${id ?? 'a notification'}`);
    return find()!;
  }

  async request(id: string, method: string, params?: unknown): Promise<Message> {
    this.send({ id, method, params });
    return this.next(id);
  }

  until(condition: () => boolean, what: string): Promise<void> {
    if (condition()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${what}`)), 3000);
      const check = () => {
        if (condition()) {
          clearTimeout(timer);
          resolve();
        } else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }
}

const servers: PluginPipeServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.destroy();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start(options: { plugins?: GigaPlugin[]; signedInAs?: string | null; log?: PluginLog } = {}) {
  const connected: AddInSession[] = [];
  const disconnected: AddInSession[] = [];
  const cad: GigaPlugin = {
    id: 'cad',
    name: 'Cad',
    version: '1.0.0',
    addIn: { clientId: 'cad-addin', onConnected: (session) => connected.push(session), onDisconnected: (session) => disconnected.push(session) },
  };
  const log = options.log ?? (() => undefined);
  const path = pipePath(`gc-test-${randomBytes(4).toString('hex')}`);
  const server = new PluginPipeServer({
    path,
    hostVersion: '9.9.9',
    registry: new PluginRegistry(options.plugins ?? [cad], log),
    signedInAs: () => (options.signedInAs === undefined ? 'alex' : options.signedInAs),
    log,
  });
  await server.listen();
  servers.push(server);
  const client = async () => {
    const created = await TestClient.connect(path);
    clients.push(created);
    return created;
  };
  const helloed = async () => {
    const created = await client();
    expect((await created.request('0', METHODS.hello, hello().params)).result).toBeDefined();
    return created;
  };
  return { server, path, client, helloed, connected, disconnected };
}

describe('PluginPipeServer', () => {
  it('accepts a hello and tells the owning plugin', async () => {
    const { server, client, connected, disconnected } = await start();
    const addIn = await client();

    const reply = await addIn.request('0', METHODS.hello, hello().params);

    expect(reply).toEqual({ id: '0', result: { hostVersion: '9.9.9', protocolVersion: PROTOCOL_VERSION, signedInAs: 'alex' } });
    await addIn.until(() => connected.length === 1, 'onConnected');
    expect(connected[0]).toMatchObject({ clientId: 'cad-addin', cadVersion: '2025', processId: 1234 });
    expect(server.sessions).toMatchObject([{ pluginId: 'cad', processId: 1234 }]);

    addIn.socket.end();
    await addIn.until(() => disconnected.length === 1, 'onDisconnected');
    expect(server.sessions).toEqual([]);
  });

  it('leaves signedInAs out when signed out', async () => {
    const { client } = await start({ signedInAs: null });
    const addIn = await client();
    expect((await addIn.request('0', METHODS.hello, hello().params)).result).toEqual({ hostVersion: '9.9.9', protocolVersion: PROTOCOL_VERSION });
  });

  it("answers the methods the app doesn't do yet with not_implemented", async () => {
    const { helloed } = await start();
    const addIn = await helloed();

    for (const [index, method] of REQUEST_METHODS.entries()) {
      expect((await addIn.request(`m${index}`, method, { path: 'a' })).error?.code).toBe('not_implemented');
    }
    expect((await addIn.request('x', 'files.delete')).error?.code).toBe('unknown_method');
    expect((await addIn.request('y', METHODS.hello, hello().params)).error?.code).toBe('bad_request');
  });

  it('runs handlers the app registers, side by side', async () => {
    const { server, helloed } = await start();
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    server.handle(METHODS.commitVersion, async () => {
      await slow;
      return { commitId: 'c1' };
    });
    server.handle(METHODS.getFileState, (params, session) =>
      (params as { paths: string[] }).paths.map((path) => ({ path, isGigaPath: true, writable: false, checkedOutBy: session.cadName })),
    );
    const addIn = await helloed();

    addIn.send({ id: 'commit', method: METHODS.commitVersion, params: { path: 'a', message: 'm' } });
    const state = await addIn.request('state', METHODS.getFileState, { paths: ['a.prt'] });
    expect(state.result).toEqual([{ path: 'a.prt', isGigaPath: true, writable: false, checkedOutBy: 'Cad' }]);

    release();
    expect((await addIn.next('commit')).result).toEqual({ commitId: 'c1' });
  });

  it('passes RpcError codes through and hides other errors', async () => {
    const log = vi.fn<PluginLog>();
    const { server, helloed } = await start({ log });
    server.handle(METHODS.checkout, () => {
      throw new RpcError('checked_out', 'Checked out by @sam');
    });
    server.handle(METHODS.checkin, () => {
      throw new Error('secret detail');
    });
    const addIn = await helloed();

    expect((await addIn.request('1', METHODS.checkout, { path: 'a' })).error).toEqual({ code: 'checked_out', message: 'Checked out by @sam' });
    const internal = (await addIn.request('2', METHODS.checkin, { path: 'a' })).error;
    expect(internal?.code).toBe('internal');
    expect(internal?.message).not.toContain('secret');
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('branch.checkin'), expect.any(Error));
  });

  it('broadcasts to connected add-ins only', async () => {
    const { server, client, helloed } = await start();
    const addIn = await helloed();
    const stranger = await client();

    server.broadcast(METHODS.stateChanged, { paths: ['a.prt'] });

    expect(await addIn.next()).toEqual({ method: METHODS.stateChanged, params: { paths: ['a.prt'] } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stranger.received).toEqual([]);
  });

  it.each([
    ['an unknown client', hello({ clientId: 'nobody' }), 'unknown_client'],
    ['another protocol version', hello({ protocolVersion: PROTOCOL_VERSION + 1 }), 'protocol_version'],
    ['a malformed hello', hello({ processId: 'x' }), 'bad_request'],
    ['a request before hello', { id: '0', method: METHODS.checkout, params: { path: 'a' } }, 'bad_request'],
  ])('refuses %s and closes the connection', async (_name, first, code) => {
    const { client, connected } = await start();
    const addIn = await client();

    addIn.send(first);

    expect((await addIn.next('0')).error?.code).toBe(code);
    await addIn.until(() => addIn.closed, 'the connection to close');
    expect(connected).toEqual([]);
  });

  it('closes connections that send garbage', async () => {
    const { client } = await start();
    const addIn = await client();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(8, 0);

    addIn.socket.write(Buffer.concat([header, Buffer.from('not json')]));

    await addIn.until(() => addIn.closed, 'the connection to close');
    expect(addIn.received).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('makes the socket private to its owner', async () => {
    const { path } = await start();
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('can be closed and opened again at the same path', async () => {
    const { server, path } = await start();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    const again = new PluginPipeServer({ path, hostVersion: '1', registry: new PluginRegistry([], () => undefined), signedInAs: () => null, log: () => undefined });
    await again.listen();
    servers.push(again);
    const addIn = await TestClient.connect(path);
    clients.push(addIn);
    addIn.send(hello());
    expect((await addIn.next('0')).error?.code).toBe('unknown_client');
  });
});
