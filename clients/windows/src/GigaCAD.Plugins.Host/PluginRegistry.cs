using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace GigaCAD.Plugins.Hosting;

public sealed record RegisteredFileType(string PluginId, CadFileType FileType);

public sealed record RegisteredInstallation(string PluginId, CadInstallation Installation);

public sealed record RegisteredCommand(string PluginId, PluginCommand Command);

/// <summary>
/// What the loaded plugins add up to. Every call into a plugin is guarded: if a capability throws,
/// it's logged and turned off for that plugin until the app restarts, and the app carries on.
/// </summary>
public sealed class PluginRegistry
{
    public const string FileTypesCapability = "fileTypes";
    public const string IgnorePatternsCapability = "ignorePatterns";
    public const string InstallationsCapability = "installations";
    public const string CommandsCapability = "commands";
    public const string AddInCapability = "addIn";

    private readonly ILogger _logger;
    private readonly List<LoadedPlugin> _active;
    private readonly ConcurrentDictionary<(string Plugin, string Capability), bool> _turnedOff = new();
    private readonly Dictionary<string, RegisteredFileType> _fileTypes = new(StringComparer.Ordinal);
    private readonly List<string> _ignorePatterns = [];

    public PluginRegistry(IReadOnlyList<LoadedPlugin> plugins, ILogger<PluginRegistry> logger)
    {
        _logger = logger;
        Plugins = plugins;
        // Sorted by id so the first plugin to claim an extension is always the same one.
        _active = plugins.Where(plugin => plugin.State == PluginState.Loaded).OrderBy(plugin => plugin.Id, StringComparer.Ordinal).ToList();

        foreach (var plugin in _active)
        {
            if (plugin.Instance is IFileTypeProvider files)
            {
                foreach (var type in Guard(plugin, FileTypesCapability, () => files.FileTypes.ToList(), []))
                {
                    if (_fileTypes.TryGetValue(type.Extension, out var existing))
                        _logger.LogWarning("Plugins {Plugin} and {Existing} both claim {Extension}; {Existing} keeps it", plugin.Id, existing.PluginId, type.Extension, existing.PluginId);
                    else
                        _fileTypes[type.Extension] = new RegisteredFileType(plugin.Id, type);
                }
            }
            if (plugin.Instance is IIgnoreRuleProvider ignores)
            {
                foreach (var pattern in Guard(plugin, IgnorePatternsCapability, () => ignores.IgnorePatterns.ToList(), []))
                    if (!_ignorePatterns.Contains(pattern, StringComparer.OrdinalIgnoreCase)) _ignorePatterns.Add(pattern);
            }
        }
    }

    /// <summary>Every plugin folder found, including ones that failed or are turned off.</summary>
    public IReadOnlyList<LoadedPlugin> Plugins { get; }

    public IReadOnlyDictionary<string, RegisteredFileType> FileTypes => _fileTypes;

    /// <summary>Ignore patterns from every plugin, for the save pipeline. The generic ones live in the sync engine.</summary>
    public IReadOnlyList<string> IgnorePatterns => _ignorePatterns;

    public RegisteredFileType? FileTypeFor(string path) =>
        _fileTypes.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out var type) ? type : null;

    public bool IsTurnedOff(string pluginId, string capability) => _turnedOff.ContainsKey((pluginId, capability));

    /// <summary>Installed CAD programs. Asks the plugins each time, since programs get installed and removed.</summary>
    public IReadOnlyList<RegisteredInstallation> FindInstallations() =>
        _active
            .Where(plugin => plugin.Instance is ICadInstallationLocator)
            .SelectMany(plugin => Guard(plugin, InstallationsCapability, () => ((ICadInstallationLocator)plugin.Instance!).FindInstallations().ToList(), [])
                .Select(installation => new RegisteredInstallation(plugin.Id, installation)))
            .ToList();

    /// <summary>
    /// Commands for a selection. A command that names file kinds shows only when the selection has
    /// one of the plugin's own file types of that kind; one that names none always shows.
    /// </summary>
    public IReadOnlyList<RegisteredCommand> CommandsFor(IReadOnlyList<string> paths)
    {
        var types = paths.Select(FileTypeFor).OfType<RegisteredFileType>().ToList();
        var commands = new List<RegisteredCommand>();
        foreach (var plugin in _active)
        {
            if (plugin.Instance is not ICommandProvider provider) continue;
            foreach (var command in Guard(plugin, CommandsCapability, () => provider.Commands.ToList(), []))
            {
                var applies = command.AppliesTo.Count == 0 ||
                    types.Any(type => type.PluginId == plugin.Id && command.AppliesTo.Contains(type.FileType.Kind));
                if (applies) commands.Add(new RegisteredCommand(plugin.Id, command));
            }
        }
        return commands;
    }

    public async Task<CommandResult> ExecuteCommandAsync(string pluginId, string commandId, IReadOnlyList<string> paths, CancellationToken cancellationToken)
    {
        var plugin = _active.FirstOrDefault(candidate => candidate.Id == pluginId);
        if (plugin?.Instance is not ICommandProvider provider) return CommandResult.Fail($"No plugin {pluginId} with commands");
        if (IsTurnedOff(pluginId, CommandsCapability)) return CommandResult.Fail($"{plugin.Manifest!.Name} commands are off after an error. Restart GigaCAD to try again.");
        try
        {
            return await provider.ExecuteAsync(commandId, paths, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            TurnOff(plugin, CommandsCapability, error);
            return CommandResult.Fail($"{plugin.Manifest!.Name} failed: {error.Message}");
        }
    }

    /// <summary>The plugin whose add-in sends this <c>clientId</c>.</summary>
    internal (LoadedPlugin Plugin, IAddInConnectionHandler Handler)? AddInHandlerFor(string clientId)
    {
        foreach (var plugin in _active)
        {
            if (plugin.Instance is not IAddInConnectionHandler handler || IsTurnedOff(plugin.Id, AddInCapability)) continue;
            if (Guard(plugin, AddInCapability, () => handler.AddInClientId == clientId, false)) return (plugin, handler);
        }
        return null;
    }

    internal void NotifyAddInConnected(LoadedPlugin plugin, IAddInConnectionHandler handler, AddInSessionInfo session) =>
        Guard(plugin, AddInCapability, () => { handler.OnConnected(session); return true; }, false);

    internal void NotifyAddInDisconnected(LoadedPlugin plugin, IAddInConnectionHandler handler, AddInSessionInfo session) =>
        Guard(plugin, AddInCapability, () => { handler.OnDisconnected(session); return true; }, false);

    private T Guard<T>(LoadedPlugin plugin, string capability, Func<T> call, T fallback)
    {
        if (IsTurnedOff(plugin.Id, capability)) return fallback;
        try
        {
            return call();
        }
        catch (Exception error)
        {
            TurnOff(plugin, capability, error);
            return fallback;
        }
    }

    private void TurnOff(LoadedPlugin plugin, string capability, Exception error)
    {
        _turnedOff[(plugin.Id, capability)] = true;
        _logger.LogError(error, "Plugin {Plugin} failed in {Capability}; that's off until the app restarts", plugin.Id, capability);
    }
}
