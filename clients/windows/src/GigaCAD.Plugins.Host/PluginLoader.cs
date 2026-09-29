using System.Reflection;
using Microsoft.Extensions.Logging;

namespace GigaCAD.Plugins.Hosting;

/// <summary>
/// Finds plugin folders (each with a <c>plugin.json</c>) and loads them. A plugin that fails is
/// recorded as <see cref="PluginState.Failed"/> and the rest still load.
/// </summary>
public sealed class PluginLoader(ILoggerFactory loggers, string dataDirectory, IHostServices host, IReadOnlySet<string> disabled)
{
    private readonly ILogger _logger = loggers.CreateLogger<PluginLoader>();

    /// <param name="roots">Folders whose subfolders are plugins, e.g. <c>C:\Program Files\GigaCAD\plugins</c>.</param>
    public IReadOnlyList<LoadedPlugin> LoadAll(IEnumerable<string> roots)
    {
        var plugins = new List<LoadedPlugin>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var root in roots)
        {
            if (!System.IO.Directory.Exists(root))
            {
                _logger.LogDebug("No plugins folder at {Root}", root);
                continue;
            }
            var folders = System.IO.Directory.GetDirectories(root)
                .Where(folder => File.Exists(Path.Combine(folder, PluginManifest.FileName)))
                .Order(StringComparer.Ordinal);
            foreach (var folder in folders)
            {
                var plugin = LoadOne(folder, ids);
                if (plugin.State == PluginState.Failed) _logger.LogError("Plugin {Plugin} in {Folder} didn't load: {Error}", plugin.Id, folder, plugin.Error);
                else _logger.LogInformation("Plugin {Plugin} {State}", plugin.Id, plugin.State);
                plugins.Add(plugin);
            }
        }
        return plugins;
    }

    private LoadedPlugin LoadOne(string folder, HashSet<string> ids)
    {
        PluginManifest manifest;
        try
        {
            manifest = PluginManifest.Load(folder);
        }
        catch (PluginManifestException error)
        {
            return LoadedPlugin.Failed(Path.GetFileName(folder), folder, null, error.Message);
        }

        if (!ids.Add(manifest.Id)) return LoadedPlugin.Failed(manifest.Id, folder, manifest, $"Another plugin already uses the id {manifest.Id}");
        if (disabled.Contains(manifest.Id)) return LoadedPlugin.Disabled(manifest);

        try
        {
            var context = new PluginLoadContext(manifest.AssemblyPath);
            var assembly = context.LoadFromAssemblyPath(manifest.AssemblyPath);
            var type = assembly.GetType(manifest.EntryType, throwOnError: false);
            if (type is null) return Fail($"{manifest.Assembly} has no type {manifest.EntryType}");
            if (!typeof(IGigaPlugin).IsAssignableFrom(type)) return Fail($"{manifest.EntryType} doesn't implement IGigaPlugin (host API {HostApi.Version})");
            if (type.GetConstructor(Type.EmptyTypes) is null) return Fail($"{manifest.EntryType} needs a public parameterless constructor");

            var instance = (IGigaPlugin)Activator.CreateInstance(type)!;
            if (instance.Info.Id != manifest.Id) return Fail($"{manifest.EntryType} says its id is {instance.Info.Id}, but plugin.json says {manifest.Id}");

            var data = Path.Combine(dataDirectory, "plugins", manifest.Id);
            System.IO.Directory.CreateDirectory(data);
            var logger = loggers.CreateLogger($"GigaCAD.Plugins.{manifest.Id}");
            instance.Initialize(new PluginContext(new PluginLog(logger), new JsonFilePluginSettings(Path.Combine(data, "settings.json"), logger), data, host));
            return LoadedPlugin.Loaded(manifest, instance);
        }
        catch (Exception error)
        {
            var cause = error is TargetInvocationException { InnerException: { } inner } ? inner : error;
            return Fail($"{cause.GetType().Name}: {cause.Message}");
        }

        LoadedPlugin Fail(string message) => LoadedPlugin.Failed(manifest.Id, folder, manifest, message);
    }
}
