using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace GigaCAD.Plugins.Hosting;

internal sealed class PluginContext(IPluginLog log, IPluginSettings settings, string dataDirectory, IHostServices host) : IPluginContext
{
    public IPluginLog Log { get; } = log;

    public IPluginSettings Settings { get; } = settings;

    public string DataDirectory { get; } = dataDirectory;

    public IHostServices Host { get; } = host;
}

internal sealed class PluginLog(ILogger logger) : IPluginLog
{
    public void Info(string message) => logger.LogInformation("{Message}", message);

    public void Warn(string message) => logger.LogWarning("{Message}", message);

    public void Error(string message, Exception? exception = null) => logger.LogError(exception, "{Message}", message);
}

/// <summary>A plugin's settings, kept in <c>settings.json</c> in its data folder.</summary>
internal sealed class JsonFilePluginSettings : IPluginSettings
{
    private readonly string _path;
    private readonly Dictionary<string, string> _values;
    private readonly Lock _lock = new();

    public JsonFilePluginSettings(string path, ILogger logger)
    {
        _path = path;
        _values = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!File.Exists(path)) return;
        try
        {
            var saved = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(path));
            if (saved is not null) _values = new Dictionary<string, string>(saved, StringComparer.Ordinal);
        }
        catch (Exception error) when (error is JsonException or IOException)
        {
            logger.LogWarning(error, "Couldn't read plugin settings at {Path}; starting with none", path);
        }
    }

    public string? Get(string key)
    {
        lock (_lock) return _values.TryGetValue(key, out var value) ? value : null;
    }

    public void Set(string key, string? value)
    {
        lock (_lock)
        {
            if (value is null) _values.Remove(key);
            else _values[key] = value;

            // Write then rename, so a crash never leaves half a file.
            var temp = _path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(_values));
            File.Move(temp, _path, overwrite: true);
        }
    }
}

/// <summary>Host services before the sync engine exists: signed out, and no file state.</summary>
internal sealed class UnavailableHostServices : IHostServices
{
    public string? SignedInAs => null;

    public Task<HostFileState> GetFileStateAsync(string path, CancellationToken cancellationToken) =>
        throw new NotSupportedException("The GigaCAD drive isn't available yet");
}
