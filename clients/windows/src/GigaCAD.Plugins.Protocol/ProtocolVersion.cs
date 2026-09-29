namespace GigaCAD.Plugins.Protocol
{
    public static class ProtocolVersion
    {
        /// <summary>Sent in <c>host.hello</c>. The app closes connections from add-ins speaking another version.</summary>
        public const int Current = 1;
    }
}
