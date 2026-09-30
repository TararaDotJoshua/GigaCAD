namespace GigaCAD.Plugins.Protocol
{
    /// <summary>Method names. Requests go from the add-in to the app, except notifications marked otherwise.</summary>
    public static class Methods
    {
        /// <summary>The first request on every connection. <see cref="HelloParams"/> → <see cref="HelloResult"/>.</summary>
        public const string Hello = "host.hello";

        /// <summary><see cref="GetFileStateParams"/> → <see cref="FileStateDto"/>[].</summary>
        public const string GetFileState = "files.getState";

        /// <summary><see cref="BranchPathParams"/> → <see cref="FileStateDto"/>.</summary>
        public const string Checkout = "branch.checkout";

        /// <summary><see cref="BranchPathParams"/> → <see cref="FileStateDto"/>.</summary>
        public const string Checkin = "branch.checkin";

        /// <summary><see cref="CommitVersionParams"/> → <see cref="CommitVersionResult"/>.</summary>
        public const string CommitVersion = "branch.commitVersion";

        /// <summary><see cref="ReportReferencesParams"/> → <see cref="EmptyResult"/>.</summary>
        public const string ReportReferences = "files.reportReferences";

        /// <summary><see cref="AttachExportParams"/> → <see cref="EmptyResult"/>.</summary>
        public const string AttachExport = "exports.attach";

        /// <summary><see cref="SubmitRebuildReportParams"/> → <see cref="EmptyResult"/>.</summary>
        public const string SubmitRebuildReport = "candidate.submitRebuildReport";

        /// <summary>Notification from the app to add-ins: <see cref="StateChangedParams"/>.</summary>
        public const string StateChanged = "files.stateChanged";

        /// <summary>Every request method in this protocol version, besides <see cref="Hello"/>.</summary>
        public static readonly string[] Requests =
        {
            GetFileState,
            Checkout,
            Checkin,
            CommitVersion,
            ReportReferences,
            AttachExport,
            SubmitRebuildReport,
        };
    }
}
