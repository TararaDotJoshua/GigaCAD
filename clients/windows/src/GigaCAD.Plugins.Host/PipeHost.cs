using System.Collections.Concurrent;
using System.IO.Pipes;
using GigaCAD.Plugins.Protocol;
using Microsoft.Extensions.Logging;

namespace GigaCAD.Plugins.Hosting;

/// <summary>
/// The named pipe CAD add-ins connect to. <see cref="PipeOptions.CurrentUserOnly"/> limits it to the
/// user running the app. Every connection must start with <c>host.hello</c>; the app then routes the
/// session to the plugin that owns the add-in's <c>clientId</c>.
/// </summary>
public sealed class PipeHost(
    string pipeName,
    string hostVersion,
    RequestDispatcher dispatcher,
    PluginRegistry registry,
    Func<string?> signedInAs,
    ILogger<PipeHost> logger) : IAsyncDisposable
{
    private readonly CancellationTokenSource _stopping = new();
    private readonly ConcurrentDictionary<Guid, AddInSession> _sessions = new();
    private readonly ConcurrentDictionary<Task, bool> _running = new();
    private NamedPipeServerStream? _listening;
    private Task _acceptLoop = Task.CompletedTask;

    public string PipeName { get; } = pipeName;

    public IReadOnlyCollection<AddInSession> Sessions => _sessions.Values.ToList();

    /// <summary>Starts listening. Throws if the pipe can't be created, for example when another app already owns the name.</summary>
    public void Start()
    {
        if (_listening is not null) throw new InvalidOperationException("The pipe host is already running");
        _listening = CreateServer();
        _acceptLoop = AcceptLoopAsync(_listening, _stopping.Token);
    }

    /// <summary>Sends a notification to every connected add-in. Add-ins that have gone away are skipped.</summary>
    public async Task BroadcastAsync(string method, object? parameters, CancellationToken cancellationToken)
    {
        foreach (var session in _sessions.Values)
        {
            try
            {
                await session.NotifyAsync(method, parameters, cancellationToken);
            }
            catch (IOException)
            {
                // The read loop notices the closed pipe and removes the session.
            }
            catch (ObjectDisposedException)
            {
            }
        }
    }

    /// <summary>Serves one connection until it closes. The accept loop calls this for each pipe; tests call it with any stream.</summary>
    public async Task ServeAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var connection = new MessageConnection(stream);
        AddInSession? session = null;
        (LoadedPlugin Plugin, IAddInConnectionHandler Handler)? owner = null;
        try
        {
            var first = await connection.ReceiveAsync(cancellationToken);
            if (first is null) return;
            (session, owner) = await HandshakeAsync(connection, first, cancellationToken);
            if (session is null || owner is null) return;

            _sessions[session.Id] = session;
            registry.NotifyAddInConnected(owner.Value.Plugin, owner.Value.Handler, session.Info);
            logger.LogInformation("{Cad} {CadVersion} add-in connected (process {Process})", session.Info.CadName, session.Info.CadVersion, session.Info.ProcessId);

            while (await connection.ReceiveAsync(cancellationToken) is { } message)
            {
                if (!message.IsRequest) continue;
                if (message.Method == Methods.Hello)
                {
                    await session.SendAsync(Message.Failure(message.Id!, new ProtocolError { Code = ErrorCodes.BadRequest, Message = "This connection already said hello" }), cancellationToken);
                    continue;
                }
                // Requests run side by side, so a long commit doesn't hold up file-state lookups.
                Track(RespondAsync(session, message, cancellationToken));
            }
        }
        catch (ProtocolException error)
        {
            logger.LogWarning("Closed an add-in connection that broke the protocol: {Error}", error.Message);
        }
        catch (IOException)
        {
            // The add-in went away.
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        finally
        {
            if (session is not null && _sessions.TryRemove(session.Id, out _) && owner is not null)
            {
                registry.NotifyAddInDisconnected(owner.Value.Plugin, owner.Value.Handler, session.Info);
                logger.LogInformation("{Cad} add-in disconnected (process {Process})", session.Info.CadName, session.Info.ProcessId);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _stopping.CancelAsync();
        _listening?.Dispose();
        try
        {
            await _acceptLoop;
        }
        catch (OperationCanceledException)
        {
        }
        await Task.WhenAll(_running.Keys);
        _stopping.Dispose();
    }

    private async Task<(AddInSession?, (LoadedPlugin, IAddInConnectionHandler)?)> HandshakeAsync(MessageConnection connection, Message first, CancellationToken cancellationToken)
    {
        async Task<(AddInSession?, (LoadedPlugin, IAddInConnectionHandler)?)> Refuse(string code, string message, object? details = null)
        {
            if (first.Id is not null)
                await connection.SendAsync(Message.Failure(first.Id, new ProtocolError { Code = code, Message = message, Details = ProtocolJson.ToElement(details) }), cancellationToken);
            logger.LogWarning("Refused an add-in connection: {Message}", message);
            return (null, null);
        }

        if (!first.IsRequest || first.Method != Methods.Hello) return await Refuse(ErrorCodes.BadRequest, $"Send {Methods.Hello} first");

        HelloParams hello;
        try
        {
            hello = ProtocolJson.Read<HelloParams>(first.Params);
        }
        catch (RpcException error)
        {
            return await Refuse(error.Code, error.Message);
        }

        if (hello.ProtocolVersion != ProtocolVersion.Current)
            return await Refuse(ErrorCodes.ProtocolVersion, $"The add-in speaks protocol {hello.ProtocolVersion}, but this GigaCAD app speaks {ProtocolVersion.Current}. Update GigaCAD.", new { hostProtocolVersion = ProtocolVersion.Current });

        if (registry.AddInHandlerFor(hello.ClientId) is not { } owner)
            return await Refuse(ErrorCodes.UnknownClient, $"No GigaCAD plugin handles the add-in \"{hello.ClientId}\"");

        var info = new AddInSessionInfo(Guid.NewGuid(), hello.ClientId, hello.ClientVersion, hello.CadName, hello.CadVersion, hello.ProcessId);
        var session = new AddInSession(connection, info, owner.Plugin.Id);
        await connection.SendAsync(Message.Success(first.Id!, new HelloResult { HostVersion = hostVersion, ProtocolVersion = ProtocolVersion.Current, SignedInAs = signedInAs() }), cancellationToken);
        return (session, owner);
    }

    private async Task RespondAsync(AddInSession session, Message request, CancellationToken cancellationToken)
    {
        try
        {
            await session.SendAsync(await dispatcher.DispatchAsync(session, request, cancellationToken), cancellationToken);
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or OperationCanceledException)
        {
            // The add-in left or the app is stopping; nobody is waiting for the answer.
        }
    }

    private async Task AcceptLoopAsync(NamedPipeServerStream first, CancellationToken cancellationToken)
    {
        var server = first;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await server.WaitForConnectionAsync(cancellationToken);
            }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException)
            {
                await server.DisposeAsync();
                return;
            }
            catch (IOException error)
            {
                logger.LogWarning(error, "An add-in connection failed before it started");
                await server.DisposeAsync();
                server = CreateServer();
                continue;
            }

            Track(ServeAsync(server, cancellationToken));
            server = CreateServer();
            _listening = server;
        }
        await server.DisposeAsync();
    }

    private NamedPipeServerStream CreateServer() =>
        new(PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);

    private void Track(Task task)
    {
        _running[task] = true;
        task.ContinueWith(done => _running.TryRemove(done, out _), TaskScheduler.Default);
    }
}
