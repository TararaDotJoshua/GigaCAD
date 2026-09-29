using System;
using System.Text;

namespace GigaCAD.Plugins.Protocol
{
    public static class PipeNames
    {
        public const string Prefix = "GigaCAD.Host.";

        /// <summary>
        /// The app's pipe for the signed-in Windows user. Each user runs their own app, and the pipe
        /// only accepts connections from its owner.
        /// </summary>
        public static string ForCurrentUser() => ForUser(Environment.UserDomainName, Environment.UserName);

        public static string ForUser(string domain, string user)
        {
            var name = new StringBuilder(Prefix);
            foreach (var c in (domain + "." + user).ToLowerInvariant())
                name.Append(char.IsLetterOrDigit(c) || c == '.' || c == '-' ? c : '_');
            return name.ToString();
        }
    }
}
