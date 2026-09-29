using System.Collections.Generic;

namespace GigaCAD.Plugins.Protocol
{
    public sealed class HelloParams
    {
        /// <summary>Picks the plugin that owns this add-in, e.g. <c>solidworks</c>.</summary>
        public string ClientId { get; set; } = "";

        public string ClientVersion { get; set; } = "";

        public int ProtocolVersion { get; set; } = Protocol.ProtocolVersion.Current;

        public string CadName { get; set; } = "";

        public string CadVersion { get; set; } = "";

        public int ProcessId { get; set; }
    }

    public sealed class HelloResult
    {
        public string HostVersion { get; set; } = "";

        public int ProtocolVersion { get; set; }

        /// <summary>The signed-in handle, or <c>null</c> when signed out.</summary>
        public string? SignedInAs { get; set; }
    }

    public sealed class GetFileStateParams
    {
        public List<string> Paths { get; set; } = new List<string>();
    }

    public sealed class FileStateDto
    {
        public string Path { get; set; } = "";

        public bool IsGigaPath { get; set; }

        /// <summary><c>owner/project</c>.</summary>
        public string? Project { get; set; }

        public string? Branch { get; set; }

        public bool Writable { get; set; }

        public string? CheckedOutBy { get; set; }
    }

    /// <summary>Any path inside the branch folder picks the branch.</summary>
    public sealed class BranchPathParams
    {
        public string Path { get; set; } = "";
    }

    public sealed class CommitVersionParams
    {
        public string Path { get; set; } = "";

        public string Message { get; set; } = "";

        public string? Label { get; set; }
    }

    public sealed class CommitVersionResult
    {
        public string CommitId { get; set; } = "";
    }

    public sealed class FileReference
    {
        public string Path { get; set; } = "";

        /// <summary>How the file is referenced, e.g. <c>component</c> or <c>drawing_view</c>.</summary>
        public string Type { get; set; } = "";
    }

    /// <summary>What a part, assembly, or drawing points at, from the CAD program (SolidWorks: <c>GetDependencies2</c>).</summary>
    public sealed class ReportReferencesParams
    {
        public string Path { get; set; } = "";

        public List<FileReference> References { get; set; } = new List<FileReference>();
    }

    public static class ExportFormats
    {
        public const string Step = "step";
        public const string Stl = "stl";
    }

    public sealed class AttachExportParams
    {
        public string SourcePath { get; set; } = "";

        public string ExportPath { get; set; } = "";

        /// <summary><see cref="ExportFormats.Step"/> or <see cref="ExportFormats.Stl"/>.</summary>
        public string Format { get; set; } = "";
    }

    public static class RebuildStatus
    {
        public const string Passed = "passed";
        public const string PassedWithWarnings = "passed_with_warnings";
        public const string Failed = "failed";
    }

    public sealed class RebuildMessage
    {
        /// <summary><c>info</c>, <c>warning</c>, or <c>error</c>.</summary>
        public string Level { get; set; } = "info";

        public string Message { get; set; } = "";

        public string? Path { get; set; }
    }

    /// <summary>The same report <c>POST /v1/release-requests/:id/rebuild-report</c> takes.</summary>
    public sealed class RebuildReport
    {
        public string CandidateManifestId { get; set; } = "";

        /// <summary>A <see cref="RebuildStatus"/> value.</summary>
        public string Status { get; set; } = RebuildStatus.Passed;

        public List<RebuildMessage> Messages { get; set; } = new List<RebuildMessage>();
    }

    /// <summary>Any path inside the <c>candidates\RR-n</c> folder picks the release request.</summary>
    public sealed class SubmitRebuildReportParams
    {
        public string Path { get; set; } = "";

        public RebuildReport Report { get; set; } = new RebuildReport();
    }

    public sealed class StateChangedParams
    {
        public List<string> Paths { get; set; } = new List<string>();
    }

    public sealed class EmptyResult
    {
    }
}
