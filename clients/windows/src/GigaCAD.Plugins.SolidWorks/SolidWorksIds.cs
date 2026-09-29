namespace GigaCAD.Plugins.SolidWorks;

public static class SolidWorksIds
{
    public const string PluginId = "solidworks";

    /// <summary>The <c>clientId</c> the SolidWorks add-in sends in <c>host.hello</c>.</summary>
    public const string AddInClientId = "solidworks";

    /// <summary>
    /// The add-in's COM class id. SolidWorks lists add-ins under
    /// <c>HKLM\SOFTWARE\SolidWorks\Addins\{guid}</c>. Never change it: installed copies are registered under it.
    /// </summary>
    public static readonly Guid AddInGuid = new("418f9708-1a89-47aa-a633-86bb665d1fad");
}
