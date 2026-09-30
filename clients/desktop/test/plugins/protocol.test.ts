import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  encodeFrame,
  FrameReader,
  isNotification,
  isRequest,
  MAX_FRAME_BYTES,
  METHODS,
  PROTOCOL_VERSION,
  ProtocolError,
  RpcError,
  type CommitVersionParams,
  type FileState,
  type HelloParams,
  type HelloResult,
  type Message,
  type SubmitRebuildReportParams,
} from '../../src/main/plugins/protocol.js';
import { pipeNameFor, pipePath } from '../../src/main/plugins/pipeName.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/pipe-protocol.json', import.meta.url), 'utf8')).cases as Record<string, Message>;
const branch = 'C:\\Users\\alex\\GigaCAD\\alex\\arm\\Branches\\dev';

/** What the app's own types and helpers produce for each fixture. */
const built: Record<string, Message> = {
  helloRequest: {
    id: '1',
    method: METHODS.hello,
    params: { clientId: 'solidworks', clientVersion: '0.1.0', protocolVersion: PROTOCOL_VERSION, cadName: 'SolidWorks', cadVersion: '2025', processId: 4242 } satisfies HelloParams,
  },
  helloResult: { id: '1', result: { hostVersion: '0.2.0', protocolVersion: 1, signedInAs: 'alex' } satisfies HelloResult },
  helloResultSignedOut: { id: '1', result: { hostVersion: '0.2.0', protocolVersion: 1 } satisfies HelloResult },
  getFileStateRequest: { id: '2', method: METHODS.getFileState, params: { paths: [`${branch}\\Arm.SLDPRT`] } },
  getFileStateResult: {
    id: '2',
    result: [{ path: `${branch}\\Arm.SLDPRT`, isGigaPath: true, project: 'alex/arm', branch: 'dev', writable: false, checkedOutBy: 'sam' }] satisfies FileState[],
  },
  commitVersionRequest: { id: '3', method: METHODS.commitVersion, params: { path: branch, message: 'Stronger gripper' } satisfies CommitVersionParams },
  errorResponse: { id: '4', error: new RpcError('protocol_version', 'Update GigaCAD', { hostProtocolVersion: 1 }).toBody() },
  submitRebuildReportRequest: {
    id: '5',
    method: METHODS.submitRebuildReport,
    params: {
      path: 'C:\\Users\\alex\\GigaCAD\\alex\\arm\\Candidates\\RR-3',
      report: {
        candidateManifestId: '0b9a6c1e-0000-4000-8000-000000000000',
        status: 'passed_with_warnings',
        messages: [{ level: 'warning', message: 'Mate is over-defined', path: 'Robot.SLDASM' }],
      },
    } satisfies SubmitRebuildReportParams,
  },
  stateChangedNotification: { method: METHODS.stateChanged, params: { paths: [branch] } },
};

describe('shared protocol fixtures', () => {
  it('covers every fixture', () => {
    expect(Object.keys(built).sort()).toEqual(Object.keys(fixtures).sort());
  });

  it.each(Object.keys(fixtures))('%s: builds and reads the same message', (name) => {
    const fixture = fixtures[name]!;
    expect(JSON.parse(JSON.stringify(built[name]))).toEqual(fixture);
    expect(new FrameReader().push(encodeFrame(fixture))).toEqual([fixture]);
  });
});

describe('framing', () => {
  it('writes a little-endian length before the JSON', () => {
    const frame = encodeFrame({ id: '1', result: {} });
    const json = '{"id":"1","result":{}}';
    expect(frame.readUInt32LE(0)).toBe(json.length);
    expect(frame.subarray(4).toString('utf8')).toBe(json);
  });

  it('reads frames split across chunks and several in one chunk', () => {
    const frames = Buffer.concat([encodeFrame({ id: '1', method: 'a' }), encodeFrame({ method: 'b' }), encodeFrame({ id: '2', result: 'é' })]);
    const reader = new FrameReader();
    const messages = [...frame(reader, frames.subarray(0, 3)), ...frame(reader, frames.subarray(3, 20)), ...frame(reader, frames.subarray(20))];
    expect(messages).toEqual([{ id: '1', method: 'a' }, { method: 'b' }, { id: '2', result: 'é' }]);
    expect(reader.pending).toBe(false);
  });

  it('knows when a frame is half received', () => {
    const reader = new FrameReader();
    reader.push(encodeFrame({ id: '1' }).subarray(0, 6));
    expect(reader.pending).toBe(true);
  });

  it('refuses oversize frames, bad JSON, and non-objects', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_FRAME_BYTES + 1, 0);
    expect(() => new FrameReader().push(header)).toThrow(ProtocolError);
    expect(() => new FrameReader().push(raw('{nope'))).toThrow(/valid JSON/);
    expect(() => new FrameReader().push(raw('[1]'))).toThrow(/message object/);
    expect(() => new FrameReader().push(raw('null'))).toThrow(/message object/);
    expect(() => new FrameReader().push(raw('{"id":5}'))).toThrow(/id must be a string/);
  });

  it('drops null fields, which C# may write', () => {
    expect(new FrameReader().push(raw('{"id":"1","method":"m","params":null,"error":null}'))).toEqual([{ id: '1', method: 'm' }]);
  });

  it('tells requests from notifications', () => {
    expect(isRequest({ id: '1', method: 'm' })).toBe(true);
    expect(isNotification({ method: 'm' })).toBe(true);
    expect(isRequest({ id: '1', result: {} })).toBe(false);
  });
});

describe('pipe names', () => {
  it('matches the C# add-in library', () => {
    expect(pipeNameFor('ACME', 'Alex Smith')).toBe('GigaCAD.Host.acme.alex_smith');
    expect(pipeNameFor('pc', 'josé')).toBe('GigaCAD.Host.pc.josé');
  });

  it('is a named pipe on Windows and the .NET Unix socket elsewhere', () => {
    expect(pipePath('GigaCAD.Host.x', 'win32')).toBe('\\\\.\\pipe\\GigaCAD.Host.x');
    expect(pipePath('GigaCAD.Host.x', 'darwin', '/tmp')).toBe('/tmp/CoreFxPipe_GigaCAD.Host.x');
  });
});

function frame(reader: FrameReader, chunk: Buffer): Message[] {
  return reader.push(chunk);
}

function raw(json: string): Buffer {
  const payload = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}
