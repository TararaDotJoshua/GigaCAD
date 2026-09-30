using System;
using System.IO;

namespace GigaCAD.Plugins.Tests.Support
{
    internal static class RepoRoot
    {
        /// <summary>The GigaCAD repository root, found by walking up from the test output folder.</summary>
        public static string Find()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory != null && !File.Exists(Path.Combine(directory.FullName, "pnpm-workspace.yaml")))
                directory = directory.Parent;
            return directory?.FullName ?? throw new InvalidOperationException("Run the tests from inside the GigaCAD repository");
        }
    }
}
