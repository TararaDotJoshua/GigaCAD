# GigaCAD for Windows

The Windows app: the GigaCAD drive in File Explorer, the tray app, and CAD add-ins. The design is in [docs/WINDOWS_APP_PLAN.md](../../docs/WINDOWS_APP_PLAN.md).

So far this folder holds the **plugin framework**, which is how CAD programs (SolidWorks first) plug into the app:

| Project | Target | What |
|---|---|---|
| `src/GigaCAD.Plugins.Abstractions` | netstandard2.0 | `IGigaPlugin` and the capability interfaces plugins implement |
| `src/GigaCAD.Plugins.Protocol` | netstandard2.0 | Pipe messages between a CAD add-in and the app, and `GigaCadHostClient` for add-ins |
| `src/GigaCAD.Plugins.Host` | net10.0 | `PluginHost`: loads plugins, combines them in `PluginRegistry`, and serves the add-in pipe |
| `src/GigaCAD.Plugins.SolidWorks` | net10.0 | The SolidWorks plugin: file types, ignore rules, installed versions, add-in sessions |
| `tests/GigaCAD.Plugins.Tests` | net10.0 (+ net48 on Windows) | xUnit tests |
| `tests/GigaCAD.Plugins.TestPlugin` | net10.0 | Plugins the loader tests load from disk |

## Build and test

Requires the .NET 10 SDK (`global.json`). On macOS or Linux without admin rights:

```sh
curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 10.0   # installs to ~/.dotnet
```

From the repository root:

```sh
pnpm test:windows                                   # or: dotnet test clients/windows/GigaCAD.Windows.sln
dotnet build clients/windows/tests/GigaCAD.Plugins.Tests -p:IncludeNet48=true   # compile-check the net48 target off Windows
```

On Windows the tests also run on .NET Framework 4.8, because the SolidWorks add-in runs inside SolidWorks on that runtime. CI runs everything on `windows-latest` (the `windows` job).

## Using the host

```csharp
var options = PluginHostOptions.ForApp(AppContext.BaseDirectory);   // <app>\plugins\*\plugin.json
await using var plugins = PluginHost.Load(options, loggerFactory);
plugins.Start();                                                     // opens the add-in pipe

plugins.Registry.FileTypeFor(@"C:\...\Robot.SLDASM");               // SolidWorks Assembly
plugins.Registry.IgnorePatterns;                                     // for the save pipeline
plugins.Registry.FindInstallations();                                // SolidWorks 2025 at C:\Program Files\...
plugins.Dispatcher.Register<GetFileStateParams, List<FileStateDto>>(Methods.GetFileState, handler);
await plugins.Pipe.BroadcastAsync(Methods.StateChanged, new StateChangedParams { Paths = paths }, ct);
```

Until the sync engine registers handlers, every add-in method except `host.hello` answers `not_implemented`.

## Adding a plugin

1. Create `src/GigaCAD.Plugins.<Cad>` targeting `net10.0` with `<EnableDynamicLoading>true</EnableDynamicLoading>`. Reference `GigaCAD.Plugins.Abstractions` with `Private="false" ExcludeAssets="runtime"`, so the app's copy is used.
2. Implement `IGigaPlugin` with a public parameterless constructor, plus whichever capabilities apply (`IFileTypeProvider`, `IIgnoreRuleProvider`, `ICadInstallationLocator`, `ICommandProvider`, `IAddInConnectionHandler`).
3. Add a `plugin.json` next to the dll (copied to the output):

   ```json
   { "id": "fusion", "name": "Fusion", "version": "0.1.0", "hostApi": 1,
     "assembly": "GigaCAD.Plugins.Fusion.dll", "entryType": "GigaCAD.Plugins.Fusion.FusionPlugin" }
   ```

4. The installer puts the output in `%ProgramFiles%\GigaCAD\plugins\<id>\`. For local runs of a Debug app, list extra plugin folders in `GIGACAD_PLUGIN_DIRS`.
5. The CAD add-in connects with `GigaCadHostClient.ConnectAsync(new HelloParams { ClientId = "<AddInClientId>", ... }, null, timeout, ct)`.

A plugin that throws while loading shows as failed, and the others still load. A capability that throws later is turned off for that plugin until the app restarts. Bump `HostApi.Version` when the contracts change incompatibly, and `ProtocolVersion.Current` when the pipe messages do.
