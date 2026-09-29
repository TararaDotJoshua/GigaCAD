using System;
using System.IO;

namespace GigaCAD.Plugins.Tests.Support
{
    internal sealed class TempDirectory : IDisposable
    {
        public TempDirectory()
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "gigacad-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public string Combine(params string[] parts) => System.IO.Path.Combine(Path, System.IO.Path.Combine(parts));

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch (IOException)
            {
                // A loaded plugin dll can stay locked on Windows; the OS cleans temp later.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
