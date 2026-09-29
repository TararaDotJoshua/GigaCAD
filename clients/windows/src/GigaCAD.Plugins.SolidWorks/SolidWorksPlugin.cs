using System.Text.RegularExpressions;

namespace GigaCAD.Plugins.SolidWorks;

/// <summary>
/// SolidWorks support in the GigaCAD app: its file types, the temp files it writes, where it's
/// installed, and whether its add-in is running.
/// </summary>
public sealed partial class SolidWorksPlugin : IGigaPlugin, IFileTypeProvider, IIgnoreRuleProvider, ICadInstallationLocator, IAddInConnectionHandler
{
    internal const string SolidWorksKey = @"SOFTWARE\SolidWorks";

    private readonly IRegistryReader _registry;
    private readonly HashSet<Guid> _sessions = [];
    private readonly Lock _lock = new();
    private IPluginLog? _log;

    public SolidWorksPlugin()
        : this(new WindowsRegistryReader())
    {
    }

    internal SolidWorksPlugin(IRegistryReader registry)
    {
        _registry = registry;
    }

    public PluginInfo Info { get; } = new(SolidWorksIds.PluginId, "SolidWorks", "0.1.0");

    public IReadOnlyList<CadFileType> FileTypes { get; } =
    [
        new(".sldprt", "SolidWorks Part", CadFileKind.Part, hasReferences: false),
        new(".sldasm", "SolidWorks Assembly", CadFileKind.Assembly, hasReferences: true),
        new(".slddrw", "SolidWorks Drawing", CadFileKind.Drawing, hasReferences: true),
        new(".sldlfp", "SolidWorks Library Feature Part", CadFileKind.Other, hasReferences: false),
        new(".sldblk", "SolidWorks Block", CadFileKind.Other, hasReferences: false),
        new(".slddrt", "SolidWorks Sheet Format", CadFileKind.Other, hasReferences: false),
        new(".sldftp", "SolidWorks Form Tool", CadFileKind.Other, hasReferences: false),
    ];

    /// <summary>
    /// The SolidWorks entries of <c>DEFAULT_IGNORE_PATTERNS</c> in <c>packages/core/src/ignore.ts</c>.
    /// Keep the two lists the same; a test checks.
    /// </summary>
    public IReadOnlyList<string> IgnorePatterns { get; } =
    [
        "~$*",
        "*.tmp",
        "*.bak",
        "Backup of *",
        "Backup (*) of *",
        "AutoRecover of *",
    ];

    public string AddInClientId => SolidWorksIds.AddInClientId;

    /// <summary>How many SolidWorks windows have the add-in connected right now.</summary>
    public int ConnectedAddIns
    {
        get
        {
            lock (_lock) return _sessions.Count;
        }
    }

    public void Initialize(IPluginContext context)
    {
        _log = context.Log;
    }

    /// <summary>
    /// Each SolidWorks version has a key <c>HKLM\SOFTWARE\SolidWorks\SOLIDWORKS &lt;year&gt;</c> whose
    /// <c>Setup</c> subkey holds <c>SolidWorks Folder</c>. Versions without an install folder are skipped.
    /// </summary>
    public IReadOnlyList<CadInstallation> FindInstallations()
    {
        var addInRegistered = _registry.KeyExists($@"{SolidWorksKey}\Addins\{SolidWorksIds.AddInGuid:B}");
        var installations = new List<CadInstallation>();
        foreach (var name in _registry.GetSubKeyNames(SolidWorksKey))
        {
            var match = VersionKey().Match(name);
            if (!match.Success) continue;
            var folder = _registry.GetString($@"{SolidWorksKey}\{name}\Setup", "SolidWorks Folder");
            if (string.IsNullOrWhiteSpace(folder)) continue;
            installations.Add(new CadInstallation("SolidWorks", match.Groups[1].Value, folder, addInRegistered));
        }
        return installations.OrderByDescending(installation => installation.Version, StringComparer.Ordinal).ToList();
    }

    public void OnConnected(AddInSessionInfo session)
    {
        lock (_lock) _sessions.Add(session.SessionId);
        _log?.Info($"SolidWorks {session.CadVersion} connected (process {session.ProcessId}, add-in {session.ClientVersion})");
    }

    public void OnDisconnected(AddInSessionInfo session)
    {
        lock (_lock) _sessions.Remove(session.SessionId);
        _log?.Info($"SolidWorks disconnected (process {session.ProcessId})");
    }

    [GeneratedRegex(@"^SOLIDWORKS (\d{4})$", RegexOptions.IgnoreCase)]
    private static partial Regex VersionKey();
}
