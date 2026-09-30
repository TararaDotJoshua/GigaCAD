/**
 * The pipe protocol between CAD add-ins and the app. The add-in side is the C# library in
 * clients/windows/src/GigaCAD.Plugins.Protocol; test/plugins/fixtures/pipe-protocol.json keeps the two in step.
 *
 * Each frame is a 4-byte little-endian length, then that many bytes of UTF-8 JSON. Messages are
 * shaped like JSON-RPC 2.0 without the version field: a request has `id` and `method`, a
 * notification only `method`, and a response `id` with `result` or `error`.
 */

/** Sent in `host.hello`. Connections speaking another version are refused. */
export const PROTOCOL_VERSION = 1;

export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export const METHODS = {
  hello: 'host.hello',
  getFileState: 'files.getState',
  checkout: 'branch.checkout',
  checkin: 'branch.checkin',
  commitVersion: 'branch.commitVersion',
  reportReferences: 'files.reportReferences',
  attachExport: 'exports.attach',
  submitRebuildReport: 'candidate.submitRebuildReport',
  /** Notification from the app to add-ins. */
  stateChanged: 'files.stateChanged',
} as const;

/** Every request method besides `host.hello`. */
export const REQUEST_METHODS = [
  METHODS.getFileState,
  METHODS.checkout,
  METHODS.checkin,
  METHODS.commitVersion,
  METHODS.reportReferences,
  METHODS.attachExport,
  METHODS.submitRebuildReport,
] as const;

/** Stable error codes. API errors (`checked_out`, `stale_head`, …) pass through with the API's own code. */
export const ERROR_CODES = {
  notImplemented: 'not_implemented',
  unknownMethod: 'unknown_method',
  unknownClient: 'unknown_client',
  badRequest: 'bad_request',
  protocolVersion: 'protocol_version',
  internal: 'internal',
} as const;

export interface ProtocolErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface Message {
  readonly id?: string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: ProtocolErrorBody;
}

export const isRequest = (message: Message): boolean => message.id !== undefined && message.method !== undefined;
export const isNotification = (message: Message): boolean => message.id === undefined && message.method !== undefined;

export interface HelloParams {
  /** Picks the plugin that owns the add-in, e.g. `solidworks`. */
  readonly clientId: string;
  readonly clientVersion: string;
  readonly protocolVersion: number;
  readonly cadName: string;
  readonly cadVersion: string;
  readonly processId: number;
}

export interface HelloResult {
  readonly hostVersion: string;
  readonly protocolVersion: number;
  /** Left out when signed out. */
  readonly signedInAs?: string;
}

export interface GetFileStateParams {
  readonly paths: readonly string[];
}

export interface FileState {
  readonly path: string;
  readonly isGigaPath: boolean;
  /** `owner/project`. */
  readonly project?: string;
  readonly branch?: string;
  readonly writable: boolean;
  readonly checkedOutBy?: string;
}

export interface BranchPathParams {
  /** Any path inside the branch folder. */
  readonly path: string;
}

export interface CommitVersionParams {
  readonly path: string;
  readonly message: string;
  readonly label?: string;
}

export interface CommitVersionResult {
  readonly commitId: string;
}

export interface ReportReferencesParams {
  readonly path: string;
  readonly references: readonly { readonly path: string; readonly type: string }[];
}

export interface AttachExportParams {
  readonly sourcePath: string;
  readonly exportPath: string;
  readonly format: 'step' | 'stl';
}

/** The report `POST /v1/release-requests/:id/rebuild-report` takes. */
export interface RebuildReport {
  readonly candidateManifestId: string;
  readonly status: 'passed' | 'passed_with_warnings' | 'failed';
  readonly messages: readonly { readonly level: 'info' | 'warning' | 'error'; readonly message: string; readonly path?: string }[];
}

export interface SubmitRebuildReportParams {
  /** Any path inside the candidate folder. */
  readonly path: string;
  readonly report: RebuildReport;
}

export interface StateChangedParams {
  readonly paths: readonly string[];
}

/** A request failed with a protocol error code. Throw it from a handler to answer with that code. */
export class RpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }

  toBody(): ProtocolErrorBody {
    return this.details === undefined ? { code: this.code, message: this.message } : { code: this.code, message: this.message, details: this.details };
  }
}

/** The byte stream broke the framing rules; the connection can't be used afterwards. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export function encodeFrame(message: Message): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_FRAME_BYTES) throw new ProtocolError(`A frame of ${payload.length} bytes is over the ${MAX_FRAME_BYTES}-byte limit`);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** Collects bytes as they arrive and hands back whole messages. */
export class FrameReader {
  private buffered: Buffer = Buffer.alloc(0);

  /** Adds a chunk; returns every message it completes. Throws ProtocolError on a bad frame. */
  push(chunk: Buffer): Message[] {
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    const messages: Message[] = [];
    while (this.buffered.length >= 4) {
      const length = this.buffered.readUInt32LE(0);
      if (length > MAX_FRAME_BYTES) throw new ProtocolError(`A frame of ${length} bytes is over the ${MAX_FRAME_BYTES}-byte limit`);
      if (this.buffered.length < 4 + length) break;
      const payload = this.buffered.subarray(4, 4 + length);
      this.buffered = this.buffered.subarray(4 + length);
      messages.push(parseMessage(payload));
    }
    return messages;
  }

  /** Whether a frame is half-received, e.g. when the connection closes. */
  get pending(): boolean {
    return this.buffered.length > 0;
  }
}

function parseMessage(payload: Buffer): Message {
  let value: unknown;
  try {
    value = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    throw new ProtocolError(`A frame isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProtocolError('A frame held something other than a message object');
  const message = value as Record<string, unknown>;
  for (const key of ['id', 'method'] as const) {
    if (message[key] !== undefined && message[key] !== null && typeof message[key] !== 'string') throw new ProtocolError(`A message's ${key} must be a string`);
  }
  // C# writes absent fields as missing, but accept null too.
  return Object.fromEntries(Object.entries(message).filter(([, field]) => field !== null)) as Message;
}
