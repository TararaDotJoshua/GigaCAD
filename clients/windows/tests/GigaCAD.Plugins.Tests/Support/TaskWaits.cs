using System;
using System.Threading.Tasks;

namespace GigaCAD.Plugins.Tests.Support
{
    internal static class TaskWaits
    {
        public static async Task WithTimeout(this Task task, int milliseconds = 5000)
        {
            if (await Task.WhenAny(task, Task.Delay(milliseconds)) != task) throw new TimeoutException("Timed out waiting in a test");
            await task;
        }

        public static async Task<T> WithTimeout<T>(this Task<T> task, int milliseconds = 5000)
        {
            if (await Task.WhenAny(task, Task.Delay(milliseconds)) != task) throw new TimeoutException("Timed out waiting in a test");
            return await task;
        }
    }
}
