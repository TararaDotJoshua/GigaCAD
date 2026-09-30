import { randomUUID } from 'node:crypto';
import { chmod, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import {
  encodeFrame,
  ERROR_CODES,
  FrameReader,
  isRequest,
  METHODS,
  PROTOCOL_VERSION,
  ProtocolError,
  REQUEST_METHODS,
  RpcError,
  type HelloParams,
  type HelloResult,
  type Message,
} from './protocol.js';
import type { PluginRegistry } from './registry.js';
import type { AddInSession, GigaPlugin, PluginLog } from './types.js';

/** Answers one request. Throw RpcError to answer with a specific error code. */
export type RequestHandler = (params: unknown, session: AddInSession) => Promise<unknown> | unknown;

export interface PipeServerOptions {
  /** From pipePath(): a named pipe on Windows, a Unix socket elsewhere. */
  readonly path: string;
  readonly hostVersion: string;
  readonly registry: PluginRegistry;
  /** The signed-in handle, or null when signed out. */
  readonly signedInAs: () => string | null;
  readonly log: PluginLog;
  readonly platform?: NodeJS.Platform;
}

interface Connection {
  readonly socket: Socket;
  readonly session: AddInSession;
  readonly plugin: GigaPlugin;
}

/**
 * The pipe CAD add-ins connect to. Every connection must start with `host.hello`; the app then
 * routes the session to the plugin that owns the add-in's `clientId`. Nothing is sent to a
 * connection before its hello is accepted.
 *
 * Access: on Windows, Node creates the pipe with the default security descriptor, which lets
 * only the same user (and administrators and SYSTEM) open it for writing, so nobody else can
 * send a hello. Elsewhere the socket file is made readable and writable by its owner only.
 */
export class PluginPipeServer {
  private readonly handlers = new Map<string, RequestHandler>();
  private readonly connections = new Map<string, Connection>();
  private readonly sockets = new Set<Socket>();
  private server: Server | undefined;

  constructor(private readonly options: PipeServerOptions) {
    for (const method of REQUEST_METHODS) {
      this.handle(method, () => {
        throw new RpcError(ERROR_CODES.notImplemented, `This version of GigaCAD can't do ${method} yet`);
      });
    }
  }

  /** Adds or replaces the handler for `method`. */
  handle(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler);
  }

  get sessions(): readonly (AddInSession & { readonly pluginId: string })[] {
    return [...this.connections.values()].map(({ session, plugin }) => ({ ...session, pluginId: plugin.id }));
  }

  async listen(): Promise<void> {
    if (this.server) throw new Error('The plugin pipe is already open');
    const platform = this.options.platform ?? process.platform;
    // A socket file left by a crash would block listening. The app runs one instance, so it's stale.
    if (platform !== 'win32') await rm(this.options.path, { force: true });
    const server = createServer((socket) => this.serve(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.path, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => this.options.log('error', 'The plugin pipe failed', error));
    if (platform !== 'win32') await chmod(this.options.path, 0o600);
    this.server = server;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const socket of this.sockets) socket.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Sends a notification to every connected add-in. */
  broadcast(method: string, params: unknown): void {
    const frame = encodeFrame({ method, params });
    for (const { socket } of this.connections.values()) {
      if (!socket.destroyed) socket.write(frame);
    }
  }

  private serve(socket: Socket): void {
    this.sockets.add(socket);
    const reader = new FrameReader();
    let connection: Connection | undefined;
    let closed = false;

    const send = (message: Message) => {
      if (!socket.destroyed) socket.write(encodeFrame(message));
    };
    const refuse = (request: Message, error: RpcError) => {
      if (request.id !== undefined) send({ id: request.id, error: error.toBody() });
      this.options.log('warn', `Refused an add-in connection: ${error.message}`);
      socket.end();
      closed = true;
    };

    socket.on('data', (chunk: Buffer) => {
      if (closed) return;
      let messages: Message[];
      try {
        messages = reader.push(chunk);
      } catch (error) {
        this.options.log('warn', `Closed an add-in connection that broke the protocol: ${error instanceof ProtocolError ? error.message : String(error)}`);
        closed = true;
        socket.destroy();
        return;
      }
      for (const message of messages) {
        if (closed) return;
        if (!connection) {
          const accepted = this.handshake(message, send, refuse);
          if (!accepted) return;
          connection = { socket, ...accepted };
          this.connections.set(accepted.session.sessionId, connection);
          this.options.registry.notifyConnected(accepted.plugin, accepted.session);
          this.options.log('info', `${accepted.session.cadName} ${accepted.session.cadVersion} add-in connected (process ${accepted.session.processId})`);
        } else if (isRequest(message)) {
          // Requests run side by side, so a long commit doesn't hold up file-state lookups.
          void this.respond(connection.session, message, send);
        }
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      this.sockets.delete(socket);
      if (connection && this.connections.delete(connection.session.sessionId)) {
        this.options.registry.notifyDisconnected(connection.plugin, connection.session);
        this.options.log('info', `${connection.session.cadName} add-in disconnected (process ${connection.session.processId})`);
      }
    });
  }

  private handshake(
    message: Message,
    send: (message: Message) => void,
    refuse: (request: Message, error: RpcError) => void,
  ): { session: AddInSession; plugin: GigaPlugin } | undefined {
    if (!isRequest(message) || message.method !== METHODS.hello) {
      refuse(message, new RpcError(ERROR_CODES.badRequest, `Send ${METHODS.hello} first`));
      return undefined;
    }
    const hello = readHello(message.params);
    if (!hello) {
      refuse(message, new RpcError(ERROR_CODES.badRequest, `${METHODS.hello} needs clientId, clientVersion, protocolVersion, cadName, cadVersion, and processId`));
      return undefined;
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      refuse(
        message,
        new RpcError(
          ERROR_CODES.protocolVersion,
          `The add-in speaks protocol ${hello.protocolVersion}, but this GigaCAD app speaks ${PROTOCOL_VERSION}. Update GigaCAD.`,
          { hostProtocolVersion: PROTOCOL_VERSION },
        ),
      );
      return undefined;
    }
    const plugin = this.options.registry.addInOwner(hello.clientId);
    if (!plugin) {
      refuse(message, new RpcError(ERROR_CODES.unknownClient, `No GigaCAD plugin handles the add-in "${hello.clientId}"`));
      return undefined;
    }

    const signedInAs = this.options.signedInAs();
    const result: HelloResult = { hostVersion: this.options.hostVersion, protocolVersion: PROTOCOL_VERSION, ...(signedInAs ? { signedInAs } : {}) };
    send({ id: message.id!, result });
    const { clientId, clientVersion, cadName, cadVersion, processId } = hello;
    return { session: { sessionId: randomUUID(), clientId, clientVersion, cadName, cadVersion, processId }, plugin };
  }

  private async respond(session: AddInSession, request: Message, send: (message: Message) => void): Promise<void> {
    const id = request.id!;
    const method = request.method!;
    if (method === METHODS.hello) {
      send({ id, error: { code: ERROR_CODES.badRequest, message: 'This connection already said hello' } });
      return;
    }
    const handler = this.handlers.get(method);
    if (!handler) {
      send({ id, error: { code: ERROR_CODES.unknownMethod, message: `No method ${method}` } });
      return;
    }
    try {
      send({ id, result: (await handler(request.params, session)) ?? {} });
    } catch (error) {
      if (error instanceof RpcError) {
        send({ id, error: error.toBody() });
      } else {
        this.options.log('error', `${method} from ${session.clientId} failed`, error);
        send({ id, error: { code: ERROR_CODES.internal, message: `GigaCAD hit an error handling ${method}` } });
      }
    }
  }
}

function readHello(params: unknown): HelloParams | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const hello = params as Record<string, unknown>;
  const strings = ['clientId', 'clientVersion', 'cadName', 'cadVersion'] as const;
  if (!strings.every((key) => typeof hello[key] === 'string')) return undefined;
  if (!Number.isInteger(hello.protocolVersion) || !Number.isInteger(hello.processId)) return undefined;
  return hello as unknown as HelloParams;
}
