using GigaCAD.Plugins.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GigaCAD.Plugins.Tests.Hosting;

public class RegistryTests
{
    [Fact]
    public void CombinesFileTypesAndIgnorePatterns()
    {
        var cad = new FakePlugin("cad");
        cad.Types.Add(new CadFileType("PRT", "Part", CadFileKind.Part, false));
        cad.Patterns.AddRange(["~$*", "*.bak"]);
        var other = new FakePlugin("other");
        other.Types.Add(new CadFileType(".asm", "Assembly", CadFileKind.Assembly, true));
        other.Patterns.AddRange(["*.BAK", "*.lck"]);

        var registry = Registry(cad, other);

        Assert.Equal("cad", registry.FileTypeFor(@"C:\GigaCAD\a\p\main\Arm.PRT")!.PluginId);
        Assert.Equal(CadFileKind.Assembly, registry.FileTypeFor("robot.ASM")!.FileType.Kind);
        Assert.Null(registry.FileTypeFor("notes.txt"));
        Assert.Null(registry.FileTypeFor("no-extension"));
        Assert.Equal(["~$*", "*.bak", "*.lck"], registry.IgnorePatterns);
    }

    [Fact]
    public void GivesAContestedExtensionToTheFirstPluginById()
    {
        var zeta = new FakePlugin("zeta");
        zeta.Types.Add(new CadFileType(".prt", "Zeta part", CadFileKind.Part, false));
        var alpha = new FakePlugin("alpha");
        alpha.Types.Add(new CadFileType(".prt", "Alpha part", CadFileKind.Part, false));

        Assert.Equal("alpha", Registry(zeta, alpha).FileTypeFor("x.prt")!.PluginId);
    }

    [Fact]
    public void LeavesOutPluginsThatDidntLoad()
    {
        var registry = new PluginRegistry(
            [LoadedPlugin.Failed("broken", "/x", null, "nope")],
            NullLogger<PluginRegistry>.Instance);

        Assert.Single(registry.Plugins);
        Assert.Empty(registry.FileTypes);
        Assert.Empty(registry.FindInstallations());
    }

    [Fact]
    public void TurnsOffACapabilityThatThrowsAndKeepsTheRest()
    {
        var broken = new FakePlugin("broken") { ThrowOnFileTypes = true };
        broken.Patterns.Add("*.tmp");
        var fine = new FakePlugin("fine");
        fine.Types.Add(new CadFileType(".ok", "OK", CadFileKind.Part, false));

        var registry = Registry(broken, fine);

        Assert.True(registry.IsTurnedOff("broken", PluginRegistry.FileTypesCapability));
        Assert.False(registry.IsTurnedOff("broken", PluginRegistry.IgnorePatternsCapability));
        Assert.Equal(["*.tmp"], registry.IgnorePatterns);
        Assert.NotNull(registry.FileTypeFor("a.ok"));
    }

    [Fact]
    public void AsksForInstallationsEachTimeAndSurvivesALocatorThatThrows()
    {
        var calls = 0;
        var cad = new FakePlugin("cad") { Installations = () => [new CadInstallation("Cad", (++calls).ToString(), "/opt/cad", false)] };
        var broken = new FakePlugin("broken") { Installations = () => throw new UnauthorizedAccessException() };
        var registry = Registry(cad, broken);

        Assert.Equal("1", Assert.Single(registry.FindInstallations()).Installation.Version);
        Assert.Equal("2", Assert.Single(registry.FindInstallations()).Installation.Version);
        Assert.True(registry.IsTurnedOff("broken", PluginRegistry.InstallationsCapability));
    }

    [Fact]
    public void ShowsCommandsForThePluginsOwnFileKinds()
    {
        var cad = new FakePlugin("cad");
        cad.Types.Add(new CadFileType(".prt", "Part", CadFileKind.Part, false));
        cad.CommandList.Add(new PluginCommand("open", "Open in Cad", [CadFileKind.Part]));
        cad.CommandList.Add(new PluginCommand("about", "About Cad"));
        var other = new FakePlugin("other");
        other.Types.Add(new CadFileType(".oprt", "Other part", CadFileKind.Part, false));

        var registry = Registry(cad, other);

        Assert.Equal(["open", "about"], registry.CommandsFor(["a.prt", "b.txt"]).Select(command => command.Command.Id));
        Assert.Equal(["about"], registry.CommandsFor(["c.oprt"]).Select(command => command.Command.Id));
    }

    [Fact]
    public async Task RunsCommandsAndTurnsOffOnesThatThrow()
    {
        var cad = new FakePlugin("cad") { Execute = (id, paths) => Task.FromResult(CommandResult.Ok($"{id} {paths.Count}")) };
        var broken = new FakePlugin("broken") { Execute = (_, _) => throw new IOException("disk") };
        var registry = Registry(cad, broken);

        Assert.Equal("open 2", (await registry.ExecuteCommandAsync("cad", "open", ["a", "b"], CancellationToken.None)).Message);

        var failed = await registry.ExecuteCommandAsync("broken", "open", ["a"], CancellationToken.None);
        Assert.False(failed.Succeeded);
        Assert.Contains("disk", failed.Message);
        Assert.Contains("Restart GigaCAD", (await registry.ExecuteCommandAsync("broken", "open", ["a"], CancellationToken.None)).Message);
        Assert.False((await registry.ExecuteCommandAsync("nobody", "open", ["a"], CancellationToken.None)).Succeeded);
    }

    [Fact]
    public void FindsTheAddInsOwner()
    {
        var cad = new FakePlugin("cad") { ClientId = "cad-addin" };
        var registry = Registry(cad, new FakePlugin("other"));

        Assert.Same(cad, registry.AddInHandlerFor("cad-addin")!.Value.Handler);
        Assert.Null(registry.AddInHandlerFor("unknown"));
    }

    private static PluginRegistry Registry(params FakePlugin[] plugins) =>
        new(plugins.Select(plugin => plugin.AsLoaded()).ToList(), NullLogger<PluginRegistry>.Instance);
}
