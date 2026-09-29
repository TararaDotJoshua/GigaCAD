using System.Reflection;
using System.Runtime.Loader;

namespace GigaCAD.Plugins.Hosting;

/// <summary>
/// Each plugin loads in its own context, so plugins can depend on different versions of the same
/// library. The contracts assembly always comes from the app, so <see cref="IGigaPlugin"/> is the same type on both sides.
/// </summary>
internal sealed class PluginLoadContext(string assemblyPath) : AssemblyLoadContext(Path.GetFileNameWithoutExtension(assemblyPath))
{
    private static readonly string SharedAssembly = typeof(IGigaPlugin).Assembly.GetName().Name!;

    private readonly AssemblyDependencyResolver _resolver = new(assemblyPath);

    protected override Assembly? Load(AssemblyName assemblyName)
    {
        if (assemblyName.Name == SharedAssembly) return null;
        var path = _resolver.ResolveAssemblyToPath(assemblyName);
        return path is null ? null : LoadFromAssemblyPath(path);
    }

    protected override IntPtr LoadUnmanagedDll(string unmanagedDllName)
    {
        var path = _resolver.ResolveUnmanagedDllToPath(unmanagedDllName);
        return path is null ? IntPtr.Zero : LoadUnmanagedDllFromPath(path);
    }
}
