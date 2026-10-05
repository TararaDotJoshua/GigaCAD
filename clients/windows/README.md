# GigaCAD for Windows: .NET

The GigaCAD app itself is `clients/desktop` (Electron) on both macOS and Windows; see [docs/clients/windows-app-plan.md](../../docs/clients/windows-app-plan.md). This folder holds the .NET side: what CAD add-ins need to talk to the app.

| Project | Target | What |
|---|---|---|
| `src/GigaCAD.Plugins.Protocol` | netstandard2.0 | The add-in side of the pipe protocol: framing, messages, `GigaCadHostClient`, `PipeNames` |
| `tests/GigaCAD.Plugins.Tests` | net10.0 (+ net48 on Windows) | xUnit tests, including the shared fixtures in `clients/desktop/test/plugins/fixtures/pipe-protocol.json` |
| `tests/GigaCAD.Plugins.InteropClient` | net10.0 (+ net48 on Windows) | A stand-in add-in for `clients/desktop/test/plugins/interop.test.ts` |
| `src/GigaCAD.SolidWorks.AddIn` | net48 | *Planned.* The SolidWorks COM add-in. Builds only where SolidWorks is installed (`SOLIDWORKS_INTEROP_DIR`). |

`netstandard2.0` lets the SolidWorks add-in, which runs inside SolidWorks on .NET Framework 4.8, use the library.

## Build and test

Requires the .NET 10 SDK (`global.json`). On macOS or Linux without admin rights:

```sh
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0   # installs to ~/.dotnet
```

From the repository root:

```sh
pnpm test:windows                                                   # or: dotnet test clients/windows/GigaCAD.Windows.sln
dotnet build clients/windows/GigaCAD.Windows.sln -p:IncludeNet48=true   # compile-check the net48 targets off Windows

# The C# client against the app's real pipe server:
dotnet build clients/windows/tests/GigaCAD.Plugins.InteropClient
GIGACAD_INTEROP=1 pnpm vitest run clients/desktop/test/plugins/interop.test.ts
```

On Windows the tests also run on .NET Framework 4.8. The `windows` CI job runs all of it on `windows-latest`, with the interop test using the .NET Framework 4.8 client over a real named pipe.

## Talking to the app from an add-in

```csharp
var hello = new HelloParams
{
    ClientId = "solidworks",            // picks the app's plugin; must match its addIn.clientId
    ClientVersion = "0.1.0",
    CadName = "SolidWorks",
    CadVersion = "2025",
    ProcessId = Process.GetCurrentProcess().Id,
};
using var app = await GigaCadHostClient.ConnectAsync(hello, pipeName: null, TimeSpan.FromSeconds(2), ct);   // TimeoutException: app not running
app.StateChanged += (_, e) => RefreshBanner(e.Paths);

var state = (await app.GetFileStateAsync(new[] { path }, ct))[0];
if (!state.Writable) ShowBanner($"Checked out by @{state.CheckedOutBy}");
```

Failed requests throw `RpcException` with a stable `Code`: `not_implemented`, `unknown_client`, `protocol_version`, or an API code such as `checked_out`. Change `ProtocolVersion.Current` and the TypeScript `PROTOCOL_VERSION` together when messages change incompatibly, and update the shared fixtures.
