using GigaCAD.Plugins.Hosting;

namespace GigaCAD.Plugins.Tests.Hosting;

/// <summary>Plugins built in the test assembly, for registry and pipe tests that don't need the loader.</summary>
internal sealed class FakePlugin(string id) : IGigaPlugin, IFileTypeProvider, IIgnoreRuleProvider, ICadInstallationLocator, ICommandProvider, IAddInConnectionHandler
{
    public PluginInfo Info { get; } = new(id, id, "1.0.0");

    public List<CadFileType> Types { get; } = [];

    public List<string> Patterns { get; } = [];

    public List<PluginCommand> CommandList { get; } = [];

    public Func<IReadOnlyList<CadInstallation>> Installations { get; set; } = () => [];

    public Func<string, IReadOnlyList<string>, Task<CommandResult>> Execute { get; set; } = (_, _) => Task.FromResult(CommandResult.Ok());

    public bool ThrowOnFileTypes { get; set; }

    public string ClientId { get; set; } = id + "-addin";

    public List<AddInSessionInfo> Connected { get; } = [];

    public List<AddInSessionInfo> Disconnected { get; } = [];

    public IReadOnlyList<CadFileType> FileTypes => ThrowOnFileTypes ? throw new InvalidOperationException("broken") : Types;

    public IReadOnlyList<string> IgnorePatterns => Patterns;

    public IReadOnlyList<PluginCommand> Commands => CommandList;

    public string AddInClientId => ClientId;

    public void Initialize(IPluginContext context)
    {
    }

    public IReadOnlyList<CadInstallation> FindInstallations() => Installations();

    public Task<CommandResult> ExecuteAsync(string commandId, IReadOnlyList<string> paths, CancellationToken cancellationToken) => Execute(commandId, paths);

    public void OnConnected(AddInSessionInfo session)
    {
        lock (Connected) Connected.Add(session);
    }

    public void OnDisconnected(AddInSessionInfo session)
    {
        lock (Disconnected) Disconnected.Add(session);
    }

    public LoadedPlugin AsLoaded() =>
        LoadedPlugin.Loaded(new PluginManifest(Info.Id, Info.Name, Info.Version, HostApi.Version, "fake.dll", typeof(FakePlugin).FullName!, "/fake/" + Info.Id), this);
}
