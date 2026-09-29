using Microsoft.Win32;

namespace GigaCAD.Plugins.SolidWorks;

/// <summary>Reads <c>HKEY_LOCAL_MACHINE</c>. Behind an interface so installation lookup is testable off Windows.</summary>
internal interface IRegistryReader
{
    IReadOnlyList<string> GetSubKeyNames(string path);

    string? GetString(string path, string name);

    bool KeyExists(string path);
}

/// <summary>The 64-bit registry view, which is where SolidWorks (64-bit only) registers.</summary>
internal sealed class WindowsRegistryReader : IRegistryReader
{
    public IReadOnlyList<string> GetSubKeyNames(string path)
    {
        if (!OperatingSystem.IsWindows()) return [];
        using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key = root.OpenSubKey(path);
        return key?.GetSubKeyNames() ?? [];
    }

    public string? GetString(string path, string name)
    {
        if (!OperatingSystem.IsWindows()) return null;
        using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key = root.OpenSubKey(path);
        return key?.GetValue(name) as string;
    }

    public bool KeyExists(string path)
    {
        if (!OperatingSystem.IsWindows()) return false;
        using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key = root.OpenSubKey(path);
        return key is not null;
    }
}
