using System;
using System.Collections.Generic;

namespace GigaCAD.Plugins
{
    public sealed class PluginInfo
    {
        public PluginInfo(string id, string name, string version)
        {
            Id = id;
            Name = name;
            Version = version;
        }

        public string Id { get; }

        public string Name { get; }

        public string Version { get; }
    }

    public enum CadFileKind
    {
        Other,
        Part,
        Assembly,
        Drawing,
    }

    public sealed class CadFileType
    {
        /// <param name="extension">With or without the leading dot, any case. Stored as <c>.sldprt</c>.</param>
        public CadFileType(string extension, string displayName, CadFileKind kind, bool hasReferences)
        {
            if (string.IsNullOrWhiteSpace(extension)) throw new ArgumentException("An extension is required", nameof(extension));
            var trimmed = extension.Trim().ToLowerInvariant();
            Extension = trimmed.StartsWith(".", StringComparison.Ordinal) ? trimmed : "." + trimmed;
            DisplayName = displayName;
            Kind = kind;
            HasReferences = hasReferences;
        }

        public string Extension { get; }

        public string DisplayName { get; }

        public CadFileKind Kind { get; }

        /// <summary>Whether files of this type point at other files (assemblies, drawings).</summary>
        public bool HasReferences { get; }
    }

    public sealed class CadInstallation
    {
        public CadInstallation(string name, string version, string installPath, bool addInRegistered)
        {
            Name = name;
            Version = version;
            InstallPath = installPath;
            AddInRegistered = addInRegistered;
        }

        public string Name { get; }

        public string Version { get; }

        public string InstallPath { get; }

        /// <summary>Whether the GigaCAD add-in is registered with this installation.</summary>
        public bool AddInRegistered { get; }
    }

    public sealed class PluginCommand
    {
        /// <param name="appliesTo">
        /// Kinds of this plugin's own file types the command shows for. Empty means it shows for every selection.
        /// </param>
        public PluginCommand(string id, string label, IReadOnlyList<CadFileKind>? appliesTo = null)
        {
            Id = id;
            Label = label;
            AppliesTo = appliesTo ?? Array.Empty<CadFileKind>();
        }

        public string Id { get; }

        public string Label { get; }

        public IReadOnlyList<CadFileKind> AppliesTo { get; }
    }

    public sealed class CommandResult
    {
        private CommandResult(bool succeeded, string? message)
        {
            Succeeded = succeeded;
            Message = message;
        }

        public bool Succeeded { get; }

        public string? Message { get; }

        public static CommandResult Ok(string? message = null) => new CommandResult(true, message);

        public static CommandResult Fail(string message) => new CommandResult(false, message);
    }

    /// <summary>An add-in connected to the app from inside a CAD program.</summary>
    public sealed class AddInSessionInfo
    {
        public AddInSessionInfo(Guid sessionId, string clientId, string clientVersion, string cadName, string cadVersion, int processId)
        {
            SessionId = sessionId;
            ClientId = clientId;
            ClientVersion = clientVersion;
            CadName = cadName;
            CadVersion = cadVersion;
            ProcessId = processId;
        }

        public Guid SessionId { get; }

        public string ClientId { get; }

        public string ClientVersion { get; }

        public string CadName { get; }

        public string CadVersion { get; }

        public int ProcessId { get; }
    }

    public sealed class HostFileState
    {
        public HostFileState(string path, bool isGigaPath, string? project, string? branch, bool writable, string? checkedOutBy)
        {
            Path = path;
            IsGigaPath = isGigaPath;
            Project = project;
            Branch = branch;
            Writable = writable;
            CheckedOutBy = checkedOutBy;
        }

        public string Path { get; }

        /// <summary>Whether the path is inside the GigaCAD drive at all.</summary>
        public bool IsGigaPath { get; }

        /// <summary><c>owner/project</c>.</summary>
        public string? Project { get; }

        public string? Branch { get; }

        public bool Writable { get; }

        /// <summary>The handle holding the branch's checkout, if anyone does.</summary>
        public string? CheckedOutBy { get; }
    }
}
