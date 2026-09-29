using GigaCAD.Plugins.Protocol;
using Microsoft.Extensions.Logging;

namespace GigaCAD.Plugins.Hosting;

public sealed class PluginHostOptions
{
    /// <summary>Folders whose subfolders are plugins.</summary>
    public List<string> PluginDirectories { get; } = [];

    public string PipeName { get; set; } = PipeNames.ForCurrentUser();

    /// <summary>Where the app keeps its data. Each plugin gets <c>plugins\&lt;id&gt;</c> inside it.</summary>
    public string DataDirectory { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GigaCAD");

    /// <summary>Plugin ids turned off in settings.</summary>
    public HashSet<string> DisabledPlugins { get; } = new(StringComparer.Ordinal);

    public string HostVersion { get; set; } = typeof(PluginHost).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    /// <summary>
    /// The installed app's options: plugins only from <c>&lt;app folder&gt;\plugins</c>, which only
    /// administrators can write to. Debug builds also load the folders in <c>GIGACAD_PLUGIN_DIRS</c>.
    /// </summary>
    public static PluginHostOptions ForApp(string appDirectory)
    {
        var options = new PluginHostOptions();
        options.PluginDirectories.Add(Path.Combine(appDirectory, "plugins"));
#if DEBUG
        var extra = Environment.GetEnvironmentVariable("GIGACAD_PLUGIN_DIRS");
        if (!string.IsNullOrWhiteSpace(extra))
            options.PluginDirectories.AddRange(extra.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
#endif
        return options;
    }
}

/// <summary>
/// Everything plugin-related the app runs: loads the plugins, builds the registry, and serves the
/// add-in pipe. Every add-in method answers <c>not_implemented</c> until the sync engine registers
/// real handlers on <see cref="Dispatcher"/>.
/// </summary>
public sealed class PluginHost : IAsyncDisposable
{
    private PluginHost(PluginRegistry registry, RequestDispatcher dispatcher, PipeHost pipe)
    {
        Registry = registry;
        Dispatcher = dispatcher;
        Pipe = pipe;
    }

    public PluginRegistry Registry { get; }

    public RequestDispatcher Dispatcher { get; }

    public PipeHost Pipe { get; }

    /// <summary>Loads plugins. Call <see cref="Start"/> to open the pipe.</summary>
    public static PluginHost Load(PluginHostOptions options, ILoggerFactory loggers, IHostServices? host = null)
    {
        host ??= new UnavailableHostServices();
        var plugins = new PluginLoader(loggers, options.DataDirectory, host, options.DisabledPlugins).LoadAll(options.PluginDirectories);
        var registry = new PluginRegistry(plugins, loggers.CreateLogger<PluginRegistry>());

        var dispatcher = new RequestDispatcher(loggers.CreateLogger<RequestDispatcher>());
        foreach (var method in Methods.Requests) dispatcher.Register(method, RequestDispatcher.NotImplemented(method));

        var pipe = new PipeHost(options.PipeName, options.HostVersion, dispatcher, registry, () => host.SignedInAs, loggers.CreateLogger<PipeHost>());
        return new PluginHost(registry, dispatcher, pipe);
    }

    public void Start() => Pipe.Start();

    public ValueTask DisposeAsync() => Pipe.DisposeAsync();
}
