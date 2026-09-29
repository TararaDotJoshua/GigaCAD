using System;
using System.Threading;
using System.Threading.Tasks;

namespace GigaCAD.Plugins
{
    /// <summary>What the app gives a plugin.</summary>
    public interface IPluginContext
    {
        IPluginLog Log { get; }

        /// <summary>Settings kept for this plugin across restarts.</summary>
        IPluginSettings Settings { get; }

        /// <summary>A folder only this plugin writes to. It exists before <see cref="IGigaPlugin.Initialize"/> runs.</summary>
        string DataDirectory { get; }

        IHostServices Host { get; }
    }

    public interface IPluginLog
    {
        void Info(string message);

        void Warn(string message);

        void Error(string message, Exception? exception = null);
    }

    public interface IPluginSettings
    {
        string? Get(string key);

        /// <summary>Saves the value right away. <c>null</c> removes the key.</summary>
        void Set(string key, string? value);
    }

    /// <summary>The app's state, as plugins see it.</summary>
    public interface IHostServices
    {
        /// <summary>The signed-in handle, or <c>null</c> when signed out.</summary>
        string? SignedInAs { get; }

        /// <summary>Where a path sits in the GigaCAD drive and whether it can be written.</summary>
        Task<HostFileState> GetFileStateAsync(string path, CancellationToken cancellationToken);
    }
}
