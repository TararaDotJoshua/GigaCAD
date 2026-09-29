using System.Text.Json;
using System.Text.RegularExpressions;

namespace GigaCAD.Plugins.Hosting;

/// <summary>
/// A plugin folder's <c>plugin.json</c>:
/// <code>{ "id": "solidworks", "name": "SolidWorks", "version": "0.1.0", "hostApi": 1,
///   "assembly": "GigaCAD.Plugins.SolidWorks.dll", "entryType": "GigaCAD.Plugins.SolidWorks.SolidWorksPlugin" }</code>
/// </summary>
public sealed partial record PluginManifest(string Id, string Name, string Version, int HostApi, string Assembly, string EntryType, string Directory)
{
    public const string FileName = "plugin.json";

    public string AssemblyPath => Path.Combine(Directory, Assembly);

    /// <summary>Reads and checks <c>plugin.json</c> in <paramref name="directory"/>. Throws <see cref="PluginManifestException"/> saying what's wrong.</summary>
    public static PluginManifest Load(string directory)
    {
        var path = Path.Combine(directory, FileName);
        if (!File.Exists(path)) throw new PluginManifestException($"{path} is missing");

        Fields? fields;
        try
        {
            fields = JsonSerializer.Deserialize<Fields>(File.ReadAllText(path), JsonOptions);
        }
        catch (JsonException error)
        {
            throw new PluginManifestException($"{path} isn't valid JSON: {error.Message}");
        }
        if (fields is null) throw new PluginManifestException($"{path} is empty");

        var id = Required(fields.Id, "id", path);
        if (!IdPattern().IsMatch(id)) throw new PluginManifestException($"{path}: id \"{id}\" must be lowercase letters, digits, and single dashes");
        var name = Required(fields.Name, "name", path);
        var version = Required(fields.Version, "version", path);
        if (fields.HostApi != Plugins.HostApi.Version)
            throw new PluginManifestException($"{path}: plugin {id} needs host API {fields.HostApi?.ToString() ?? "(none)"}, but this app has {Plugins.HostApi.Version}");
        var assembly = Required(fields.Assembly, "assembly", path);
        if (assembly != Path.GetFileName(assembly) || !assembly.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            throw new PluginManifestException($"{path}: assembly must be a .dll file name in the plugin folder");
        if (!File.Exists(Path.Combine(directory, assembly))) throw new PluginManifestException($"{path}: {assembly} isn't in the plugin folder");
        var entryType = Required(fields.EntryType, "entryType", path);

        return new PluginManifest(id, name, version, Plugins.HostApi.Version, assembly, entryType, Path.GetFullPath(directory));
    }

    private static string Required(string? value, string field, string path) =>
        string.IsNullOrWhiteSpace(value) ? throw new PluginManifestException($"{path}: {field} is required") : value.Trim();

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, ReadCommentHandling = JsonCommentHandling.Skip };

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex IdPattern();

    private sealed record Fields(string? Id, string? Name, string? Version, int? HostApi, string? Assembly, string? EntryType);
}

public sealed class PluginManifestException(string message) : Exception(message);
