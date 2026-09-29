using System.Text.RegularExpressions;
using GigaCAD.Plugins.SolidWorks;
using GigaCAD.Plugins.Tests.Support;
using Xunit;

namespace GigaCAD.Plugins.Tests.SolidWorks;

public class SolidWorksPluginTests
{
    [Fact]
    public void KnowsSolidWorksFileTypes()
    {
        var types = new SolidWorksPlugin().FileTypes.ToDictionary(type => type.Extension);

        Assert.Equal(CadFileKind.Part, types[".sldprt"].Kind);
        Assert.True(types[".sldasm"].HasReferences);
        Assert.True(types[".slddrw"].HasReferences);
        Assert.False(types[".sldprt"].HasReferences);
        Assert.Equal(7, types.Count);
    }

    /// <summary>The CLI and API ignore these through packages/core; the Windows app must ignore the same files.</summary>
    [Fact]
    public void IgnoresTheSameSolidWorksFilesAsCore()
    {
        var source = File.ReadAllText(Path.Combine(RepoRoot.Find(), "packages", "core", "src", "ignore.ts"));
        var list = Regex.Match(source, @"DEFAULT_IGNORE_PATTERNS[^=]*=\s*\[(.*?)\];", RegexOptions.Singleline).Groups[1].Value;
        var section = Regex.Match(list, @"// SolidWorks[^\n]*\n(.*?)(?=\n\s*//)", RegexOptions.Singleline).Groups[1].Value;
        var core = Regex.Matches(section, "'([^']*)'").Select(match => match.Groups[1].Value).ToList();

        Assert.NotEmpty(core);
        Assert.Equal(core, new SolidWorksPlugin().IgnorePatterns);
    }

    [Fact]
    public void FindsInstalledVersionsNewestFirst()
    {
        var registry = new FakeRegistry();
        registry.SubKeys[@"SOFTWARE\SolidWorks"] = ["SOLIDWORKS 2023", "SolidWorks 2025", "Applications", "SOLIDWORKS 2024", "Addins"];
        registry.Values[(@"SOFTWARE\SolidWorks\SOLIDWORKS 2023\Setup", "SolidWorks Folder")] = @"C:\Program Files\SOLIDWORKS Corp 2023\SOLIDWORKS\";
        registry.Values[(@"SOFTWARE\SolidWorks\SolidWorks 2025\Setup", "SolidWorks Folder")] = @"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\";
        // 2024 was uninstalled but left its key behind.
        registry.Keys.Add(@"SOFTWARE\SolidWorks\Addins\{418f9708-1a89-47aa-a633-86bb665d1fad}");

        var installations = new SolidWorksPlugin(registry).FindInstallations();

        Assert.Equal(["2025", "2023"], installations.Select(installation => installation.Version));
        Assert.Equal(@"C:\Program Files\SOLIDWORKS Corp\SOLIDWORKS\", installations[0].InstallPath);
        Assert.All(installations, installation => Assert.True(installation.AddInRegistered));
    }

    [Fact]
    public void FindsNothingWithoutSolidWorks()
    {
        Assert.Empty(new SolidWorksPlugin(new FakeRegistry()).FindInstallations());
    }

    [Fact]
    public void CountsConnectedSolidWorksWindows()
    {
        var plugin = new SolidWorksPlugin(new FakeRegistry());
        var first = new AddInSessionInfo(Guid.NewGuid(), "solidworks", "0.1.0", "SolidWorks", "2025", 1);
        var second = new AddInSessionInfo(Guid.NewGuid(), "solidworks", "0.1.0", "SolidWorks", "2025", 2);

        plugin.OnConnected(first);
        plugin.OnConnected(second);
        plugin.OnDisconnected(first);

        Assert.Equal(1, plugin.ConnectedAddIns);
        Assert.Equal("solidworks", plugin.AddInClientId);
    }

    private sealed class FakeRegistry : IRegistryReader
    {
        public Dictionary<string, string[]> SubKeys { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<(string, string), string> Values { get; } = [];

        public HashSet<string> Keys { get; } = new(StringComparer.OrdinalIgnoreCase);

        public IReadOnlyList<string> GetSubKeyNames(string path) => SubKeys.TryGetValue(path, out var names) ? names : [];

        public string? GetString(string path, string name) => Values.TryGetValue((path, name), out var value) ? value : null;

        public bool KeyExists(string path) => Keys.Contains(path);
    }
}
