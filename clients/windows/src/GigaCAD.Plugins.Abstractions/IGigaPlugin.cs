namespace GigaCAD.Plugins
{
    /// <summary>
    /// A CAD integration loaded into the GigaCAD app. A plugin adds capabilities by also
    /// implementing <see cref="IFileTypeProvider"/>, <see cref="IIgnoreRuleProvider"/>,
    /// <see cref="ICadInstallationLocator"/>, <see cref="ICommandProvider"/>, or
    /// <see cref="IAddInConnectionHandler"/>. It needs a public parameterless constructor.
    /// </summary>
    public interface IGigaPlugin
    {
        PluginInfo Info { get; }

        /// <summary>Called once after loading, before any capability is used. Throwing fails the plugin.</summary>
        void Initialize(IPluginContext context);
    }
}
