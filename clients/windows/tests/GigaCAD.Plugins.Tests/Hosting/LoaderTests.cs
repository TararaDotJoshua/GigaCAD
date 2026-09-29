using GigaCAD.Plugins.Hosting;
using GigaCAD.Plugins.Tests.Support;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GigaCAD.Plugins.Tests.Hosting;

public class LoaderTests
{
    private const string TestAssembly = "GigaCAD.Plugins.TestPlugin.dll";

    [Fact]
    public void LoadsAPluginAndGivesItADataFolder()
    {
        using var temp = new TempDirectory();
        AddTestPlugin(temp, "test", "GoodPlugin");

        var plugin = Assert.Single(LoadAll(temp));

        Assert.Equal(PluginState.Loaded, plugin.State);
        Assert.Null(plugin.Error);
        // The contracts come from the app, so the plugin's types are the app's types.
        var files = Assert.IsAssignableFrom<IFileTypeProvider>(plugin.Instance);
        Assert.Equal(".tst", Assert.Single(files.FileTypes).Extension);
        var data = temp.Combine("data", "plugins", "test");
        Assert.Contains(data.Replace("\\", "\\\\"), File.ReadAllText(Path.Combine(data, "settings.json")));
    }

    [Fact]
    public void LoadsTheRealSolidWorksPluginFromItsInstalledLayout()
    {
        using var temp = new TempDirectory();
        var plugins = new PluginLoader(NullLoggerFactory.Instance, temp.Path, new UnavailableHostServices(), new HashSet<string>())
            .LoadAll([Path.Combine(AppContext.BaseDirectory, "plugins")]);

        var solidworks = Assert.Single(plugins);
        Assert.Equal(PluginState.Loaded, solidworks.State);
        Assert.Equal("solidworks", solidworks.Id);
        Assert.Contains(Assert.IsAssignableFrom<IFileTypeProvider>(solidworks.Instance).FileTypes, type => type.Extension == ".sldasm");
    }

    [Theory]
    [InlineData("ThrowingPlugin", "InvalidOperationException: boom")]
    [InlineData("WrongIdPlugin", "says its id is someone-else")]
    [InlineData("NeedsArgumentsPlugin", "public parameterless constructor")]
    [InlineData("NotAPlugin", "doesn't implement IGigaPlugin")]
    [InlineData("Missing", "has no type GigaCAD.Plugins.TestPlugin.Missing")]
    public void RecordsFailuresAndKeepsLoadingTheRest(string entryType, string expected)
    {
        using var temp = new TempDirectory();
        AddTestPlugin(temp, "test", entryType, folder: "a-broken");
        AddTestPlugin(temp, "other", "OtherPlugin", folder: "b-other");

        var plugins = LoadAll(temp);

        Assert.Equal(2, plugins.Count);
        Assert.Equal(PluginState.Failed, plugins[0].State);
        Assert.Contains(expected, plugins[0].Error);
        Assert.Null(plugins[0].Instance);
        Assert.Equal(PluginState.Loaded, plugins[1].State);
    }

    [Fact]
    public void FailsPluginsWithBadManifestsUnderTheirFolderName()
    {
        using var temp = new TempDirectory();
        var folder = temp.Combine("plugins", "odd");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "plugin.json"), "{}");

        var plugin = Assert.Single(LoadAll(temp));

        Assert.Equal("odd", plugin.Id);
        Assert.Equal(PluginState.Failed, plugin.State);
        Assert.Contains("id is required", plugin.Error);
    }

    [Fact]
    public void RefusesASecondPluginWithTheSameId()
    {
        using var temp = new TempDirectory();
        AddTestPlugin(temp, "test", "GoodPlugin", folder: "a");
        AddTestPlugin(temp, "test", "GoodPlugin", folder: "b");

        var plugins = LoadAll(temp);

        Assert.Equal([PluginState.Loaded, PluginState.Failed], plugins.Select(plugin => plugin.State));
        Assert.Contains("already uses the id test", plugins[1].Error);
    }

    [Fact]
    public void SkipsDisabledPluginsWithoutLoadingThem()
    {
        using var temp = new TempDirectory();
        AddTestPlugin(temp, "test", "ThrowingPlugin");

        var plugin = Assert.Single(LoadAll(temp, disabled: ["test"]));

        Assert.Equal(PluginState.Disabled, plugin.State);
        Assert.Null(plugin.Error);
    }

    [Fact]
    public void IgnoresMissingRootsAndFoldersWithoutAManifest()
    {
        using var temp = new TempDirectory();
        Directory.CreateDirectory(temp.Combine("plugins", "not-a-plugin"));

        var plugins = new PluginLoader(NullLoggerFactory.Instance, temp.Combine("data"), new UnavailableHostServices(), new HashSet<string>())
            .LoadAll([temp.Combine("plugins"), temp.Combine("nowhere")]);

        Assert.Empty(plugins);
    }

    private static IReadOnlyList<LoadedPlugin> LoadAll(TempDirectory temp, string[]? disabled = null) =>
        new PluginLoader(NullLoggerFactory.Instance, temp.Combine("data"), new UnavailableHostServices(), new HashSet<string>(disabled ?? []))
            .LoadAll([temp.Combine("plugins")]);

    /// <summary>Lays out the test plugin dll with a manifest naming one of its classes.</summary>
    private static void AddTestPlugin(TempDirectory temp, string id, string entryType, string? folder = null)
    {
        var directory = temp.Combine("plugins", folder ?? id);
        Directory.CreateDirectory(directory);
        File.Copy(Path.Combine(AppContext.BaseDirectory, "testplugin", TestAssembly), Path.Combine(directory, TestAssembly));
        File.WriteAllText(Path.Combine(directory, "plugin.json"), $$"""
            { "id": "{{id}}", "name": "Test", "version": "1.0.0", "hostApi": {{HostApi.Version}},
              "assembly": "{{TestAssembly}}", "entryType": "GigaCAD.Plugins.TestPlugin.{{entryType}}" }
            """);
    }
}
