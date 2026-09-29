namespace GigaCAD.Plugins.Hosting;

public enum PluginState
{
    Loaded,

    /// <summary>The plugin couldn't load. <see cref="LoadedPlugin.Error"/> says why.</summary>
    Failed,

    /// <summary>Turned off in settings.</summary>
    Disabled,
}

/// <summary>A plugin folder the app found, whether or not it loaded.</summary>
public sealed class LoadedPlugin
{
    private LoadedPlugin(string id, string directory, PluginManifest? manifest, PluginState state, string? error, IGigaPlugin? instance)
    {
        Id = id;
        Directory = directory;
        Manifest = manifest;
        State = state;
        Error = error;
        Instance = instance;
    }

    /// <summary>The manifest id, or the folder name when the manifest couldn't be read.</summary>
    public string Id { get; }

    public string Directory { get; }

    public PluginManifest? Manifest { get; }

    public PluginState State { get; }

    public string? Error { get; }

    /// <summary>Set only when <see cref="State"/> is <see cref="PluginState.Loaded"/>.</summary>
    public IGigaPlugin? Instance { get; }

    internal static LoadedPlugin Loaded(PluginManifest manifest, IGigaPlugin instance) =>
        new(manifest.Id, manifest.Directory, manifest, PluginState.Loaded, null, instance);

    internal static LoadedPlugin Failed(string id, string directory, PluginManifest? manifest, string error) =>
        new(id, directory, manifest, PluginState.Failed, error, null);

    internal static LoadedPlugin Disabled(PluginManifest manifest) =>
        new(manifest.Id, manifest.Directory, manifest, PluginState.Disabled, null, null);
}
