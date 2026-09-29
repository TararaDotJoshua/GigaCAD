using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace GigaCAD.Plugins
{
    /// <summary>File types the plugin understands. Extensions are unique across plugins; the first plugin by id wins.</summary>
    public interface IFileTypeProvider
    {
        IReadOnlyList<CadFileType> FileTypes { get; }
    }

    /// <summary>Temp, lock, and backup files the CAD program writes. Gitignore syntax, matched case-insensitively.</summary>
    public interface IIgnoreRuleProvider
    {
        IReadOnlyList<string> IgnorePatterns { get; }
    }

    /// <summary>Finds installed copies of the CAD program, for the tray app's plugin list.</summary>
    public interface ICadInstallationLocator
    {
        IReadOnlyList<CadInstallation> FindInstallations();
    }

    /// <summary>Commands the plugin adds to the Explorer context menu and the tray app.</summary>
    public interface ICommandProvider
    {
        IReadOnlyList<PluginCommand> Commands { get; }

        Task<CommandResult> ExecuteAsync(string commandId, IReadOnlyList<string> paths, CancellationToken cancellationToken);
    }

    /// <summary>Hears when the plugin's add-in inside the CAD program connects to or leaves the app.</summary>
    public interface IAddInConnectionHandler
    {
        /// <summary>The <c>clientId</c> the add-in sends in <c>host.hello</c>.</summary>
        string AddInClientId { get; }

        void OnConnected(AddInSessionInfo session);

        void OnDisconnected(AddInSessionInfo session);
    }
}
