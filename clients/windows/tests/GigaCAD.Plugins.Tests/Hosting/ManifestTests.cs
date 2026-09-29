using GigaCAD.Plugins.Hosting;
using GigaCAD.Plugins.Tests.Support;
using Xunit;

namespace GigaCAD.Plugins.Tests.Hosting;

public class ManifestTests
{
    [Fact]
    public void ReadsAValidManifest()
    {
        using var folder = new TempDirectory();
        Write(folder, """{ "id": "solidworks", "name": "SolidWorks", "version": "0.1.0", "hostApi": 1, "assembly": "Plugin.dll", "entryType": "A.B" }""");

        var manifest = PluginManifest.Load(folder.Path);

        Assert.Equal("solidworks", manifest.Id);
        Assert.Equal(Path.Combine(folder.Path, "Plugin.dll"), manifest.AssemblyPath);
    }

    [Theory]
    [InlineData("""{ "name": "X", "version": "1", "hostApi": 1, "assembly": "Plugin.dll", "entryType": "A.B" }""", "id is required")]
    [InlineData("""{ "id": "Solid_Works", "name": "X", "version": "1", "hostApi": 1, "assembly": "Plugin.dll", "entryType": "A.B" }""", "lowercase letters")]
    [InlineData("""{ "id": "x", "version": "1", "hostApi": 1, "assembly": "Plugin.dll", "entryType": "A.B" }""", "name is required")]
    [InlineData("""{ "id": "x", "name": "X", "hostApi": 1, "assembly": "Plugin.dll", "entryType": "A.B" }""", "version is required")]
    [InlineData("""{ "id": "x", "name": "X", "version": "1", "hostApi": 2, "assembly": "Plugin.dll", "entryType": "A.B" }""", "needs host API 2")]
    [InlineData("""{ "id": "x", "name": "X", "version": "1", "assembly": "Plugin.dll", "entryType": "A.B" }""", "needs host API (none)")]
    [InlineData("""{ "id": "x", "name": "X", "version": "1", "hostApi": 1, "assembly": "../Plugin.dll", "entryType": "A.B" }""", "file name in the plugin folder")]
    [InlineData("""{ "id": "x", "name": "X", "version": "1", "hostApi": 1, "assembly": "Plugin.exe", "entryType": "A.B" }""", "file name in the plugin folder")]
    [InlineData("""{ "id": "x", "name": "X", "version": "1", "hostApi": 1, "assembly": "Missing.dll", "entryType": "A.B" }""", "Missing.dll isn't in the plugin folder")]
    [InlineData("""{ "id": "x", "name": "X", "version": "1", "hostApi": 1, "assembly": "Plugin.dll" }""", "entryType is required")]
    [InlineData("""{ "id": """, "isn't valid JSON")]
    [InlineData("null", "is empty")]
    public void SaysWhatsWrong(string json, string expected)
    {
        using var folder = new TempDirectory();
        Write(folder, json);

        var error = Assert.Throws<PluginManifestException>(() => PluginManifest.Load(folder.Path));

        Assert.Contains(expected, error.Message);
    }

    [Fact]
    public void ReportsAMissingManifest()
    {
        using var folder = new TempDirectory();
        Assert.Contains("plugin.json is missing", Assert.Throws<PluginManifestException>(() => PluginManifest.Load(folder.Path)).Message);
    }

    private static void Write(TempDirectory folder, string json)
    {
        File.WriteAllText(folder.Combine(PluginManifest.FileName), json);
        File.WriteAllBytes(folder.Combine("Plugin.dll"), []);
    }
}
