import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { pipePath } from '../../src/main/plugins/pipeName.js';
import { PluginPipeServer } from '../../src/main/plugins/pipeServer.js';
import { METHODS } from '../../src/main/plugins/protocol.js';
import { PluginRegistry } from '../../src/main/plugins/registry.js';
import { createSolidWorksPlugin } from '../../src/main/plugins/solidworks.js';

/**
 * The C# add-in library (clients/windows) against this pipe server, over a real named pipe on
 * Windows or a Unix socket elsewhere. It needs the .NET SDK and a built interop client:
 *
 *   dotnet build clients/windows/tests/GigaCAD.Plugins.InteropClient
 *   GIGACAD_INTEROP=1 [GIGACAD_INTEROP_TFM=net48] pnpm vitest run clients/desktop/test/plugins/interop.test.ts
 */
const enabled = process.env.GIGACAD_INTEROP === '1';
const framework = process.env.GIGACAD_INTEROP_TFM ?? 'net10.0';
const configuration = process.env.GIGACAD_INTEROP_CONFIGURATION ?? 'Debug';
const project = fileURLToPath(new URL('../../../windows/tests/GigaCAD.Plugins.InteropClient', import.meta.url));

let server: PluginPipeServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe.skipIf(!enabled)(`the C# add-in client (${framework})`, () => {
  it('handshakes, calls methods, and receives notifications', async () => {
    const name = `gc-interop-${randomBytes(4).toString('hex')}`;
    const plugin = createSolidWorksPlugin();
    server = new PluginPipeServer({
      path: pipePath(name),
      hostVersion: '9.9.9',
      registry: new PluginRegistry([plugin], () => undefined),
      signedInAs: () => 'alex',
      log: () => undefined,
    });
    server.handle(METHODS.getFileState, (params) =>
      (params as { paths: string[] }).paths.map((path) => ({ path, isGigaPath: true, project: 'alex/arm', branch: 'dev', writable: false, checkedOutBy: 'sam' })),
    );
    await server.listen();
    const running = server;

    const child = spawn('dotnet', ['run', '--no-build', '-c', configuration, '-f', framework, '--project', project, '--', name], { stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: Record<string, unknown>[] = [];
    let stderr = '';
    let buffered = '';
    let sessionSeen: { cadVersion: string } | undefined;
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffered.slice(0, newline)) as Record<string, unknown>;
        buffered = buffered.slice(newline + 1);
        lines.push(line);
        if (line.step === 'checkout') {
          sessionSeen = running.sessions[0];
          running.broadcast(METHODS.stateChanged, { paths: ['C:\\GigaCAD\\alex\\arm\\Branches\\dev'] });
        }
      }
    });
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));

    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    expect(lines).toEqual([
      { step: 'hello', hostVersion: '9.9.9', protocolVersion: 1, signedInAs: 'alex' },
      {
        step: 'getFileState',
        states: [{ path: 'C:\\GigaCAD\\alex\\arm\\Branches\\dev\\Arm.SLDPRT', isGigaPath: true, project: 'alex/arm', branch: 'dev', writable: false, checkedOutBy: 'sam' }],
      },
      { step: 'checkout', error: 'not_implemented' },
      { step: 'stateChanged', paths: ['C:\\GigaCAD\\alex\\arm\\Branches\\dev'] },
    ]);
    expect(sessionSeen?.cadVersion).toContain(framework === 'net48' ? '.NET Framework' : '.NET');
    // The server hears the disconnect on its own schedule, not necessarily before the process exits.
    for (let tries = 0; plugin.connectedAddIns > 0 && tries < 100; tries++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(plugin.connectedAddIns).toBe(0);
  }, 120_000);
});
