using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using GigaCAD.Plugins.Protocol;

namespace GigaCAD.Plugins.InteropClient
{
    /// <summary>
    /// Connects to the app's pipe as the SolidWorks add-in would and prints one JSON line per step:
    /// hello, getFileState, checkout (not implemented yet), then the next stateChanged notification.
    /// Usage: GigaCAD.Plugins.InteropClient &lt;pipe name&gt;
    /// </summary>
    internal static class Program
    {
        private static async Task<int> Main(string[] args)
        {
            if (args.Length != 1)
            {
                Console.Error.WriteLine("Usage: GigaCAD.Plugins.InteropClient <pipe name>");
                return 2;
            }

            var hello = new HelloParams
            {
                ClientId = "solidworks",
                ClientVersion = "interop",
                CadName = "Interop",
                CadVersion = RuntimeInformation.FrameworkDescription,
                ProcessId = Process.GetCurrentProcess().Id,
            };
            using (var client = await GigaCadHostClient.ConnectAsync(hello, args[0], TimeSpan.FromSeconds(10), CancellationToken.None))
            {
                var changed = new TaskCompletionSource<StateChangedParams>();
                client.StateChanged += (_, e) => changed.TrySetResult(e);
                Print(new { step = "hello", client.Host.HostVersion, client.Host.ProtocolVersion, client.Host.SignedInAs });

                var states = await client.GetFileStateAsync(new[] { @"C:\GigaCAD\alex\arm\Branches\dev\Arm.SLDPRT" }, CancellationToken.None);
                Print(new { step = "getFileState", states });

                string? error = null;
                try
                {
                    await client.CheckoutAsync(@"C:\GigaCAD\alex\arm\Branches\dev", CancellationToken.None);
                }
                catch (RpcException rpc)
                {
                    error = rpc.Code;
                }
                Print(new { step = "checkout", error });

                if (await Task.WhenAny(changed.Task, Task.Delay(TimeSpan.FromSeconds(10))) != changed.Task)
                {
                    Print(new { step = "stateChanged", error = "timeout" });
                    return 1;
                }
                Print(new { step = "stateChanged", paths = (await changed.Task).Paths });
                return 0;
            }
        }

        private static void Print(object line)
        {
            Console.Out.WriteLine(JsonSerializer.Serialize(line, ProtocolJson.Options));
            Console.Out.Flush();
        }
    }
}
