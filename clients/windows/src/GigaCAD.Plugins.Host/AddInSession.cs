using GigaCAD.Plugins.Protocol;

namespace GigaCAD.Plugins.Hosting;

/// <summary>One connected add-in.</summary>
public sealed class AddInSession
{
    private readonly MessageConnection _connection;

    internal AddInSession(MessageConnection connection, AddInSessionInfo info, string pluginId)
    {
        _connection = connection;
        Info = info;
        PluginId = pluginId;
    }

    public Guid Id => Info.SessionId;

    public AddInSessionInfo Info { get; }

    /// <summary>The plugin that owns this add-in.</summary>
    public string PluginId { get; }

    public Task NotifyAsync(string method, object? parameters, CancellationToken cancellationToken) =>
        _connection.SendAsync(Message.Notification(method, parameters), cancellationToken);

    internal Task SendAsync(Message message, CancellationToken cancellationToken) => _connection.SendAsync(message, cancellationToken);
}
