using System;
using System.Collections.Generic;

namespace GigaCAD.Plugins.TestPlugin
{
    public sealed class GoodPlugin : IGigaPlugin, IFileTypeProvider
    {
        public PluginInfo Info { get; } = new PluginInfo("test", "Test", "1.0.0");

        public IReadOnlyList<CadFileType> FileTypes { get; } = new[] { new CadFileType(".tst", "Test Part", CadFileKind.Part, false) };

        public void Initialize(IPluginContext context) => context.Settings.Set("initializedIn", context.DataDirectory);
    }

    public sealed class OtherPlugin : IGigaPlugin
    {
        public PluginInfo Info { get; } = new PluginInfo("other", "Other", "1.0.0");

        public void Initialize(IPluginContext context)
        {
        }
    }

    public sealed class ThrowingPlugin : IGigaPlugin
    {
        public PluginInfo Info { get; } = new PluginInfo("test", "Test", "1.0.0");

        public void Initialize(IPluginContext context) => throw new InvalidOperationException("boom");
    }

    public sealed class WrongIdPlugin : IGigaPlugin
    {
        public PluginInfo Info { get; } = new PluginInfo("someone-else", "Test", "1.0.0");

        public void Initialize(IPluginContext context)
        {
        }
    }

    public sealed class NeedsArgumentsPlugin : IGigaPlugin
    {
        public NeedsArgumentsPlugin(string setting)
        {
            Info = new PluginInfo(setting, "Test", "1.0.0");
        }

        public PluginInfo Info { get; }

        public void Initialize(IPluginContext context)
        {
        }
    }

    public sealed class NotAPlugin
    {
    }
}
