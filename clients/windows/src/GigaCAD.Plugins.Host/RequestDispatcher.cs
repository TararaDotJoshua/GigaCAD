using System.Collections.Concurrent;
using System.Text.Json;
using GigaCAD.Plugins.Protocol;
using Microsoft.Extensions.Logging;

namespace GigaCAD.Plugins.Hosting;

/// <summary>Handles one request. Throw <see cref="RpcException"/> to answer with a specific error code.</summary>
public delegate Task<object?> RequestHandler(AddInSession session, JsonElement? parameters, CancellationToken cancellationToken);

/// <summary>Routes add-in requests to handlers by method name.</summary>
public sealed class RequestDispatcher(ILogger<RequestDispatcher> logger)
{
    private readonly ConcurrentDictionary<string, RequestHandler> _handlers = new(StringComparer.Ordinal);

    /// <summary>Adds or replaces the handler for <paramref name="method"/>.</summary>
    public void Register(string method, RequestHandler handler) => _handlers[method] = handler;

    public void Register<TParams, TResult>(string method, Func<AddInSession, TParams, CancellationToken, Task<TResult>> handler)
        where TParams : class =>
        Register(method, async (session, parameters, cancellationToken) => await handler(session, ProtocolJson.Read<TParams>(parameters), cancellationToken));

    public bool Handles(string method) => _handlers.ContainsKey(method);

    /// <summary>A handler for methods the app doesn't do yet.</summary>
    public static RequestHandler NotImplemented(string method) =>
        (_, _, _) => throw new RpcException(ErrorCodes.NotImplemented, $"This version of GigaCAD can't do {method} yet");

    /// <summary>Runs the request's handler and turns the outcome, success or failure, into its response.</summary>
    public async Task<Message> DispatchAsync(AddInSession session, Message request, CancellationToken cancellationToken)
    {
        var id = request.Id ?? throw new ArgumentException("Only requests can be dispatched", nameof(request));
        if (request.Method is not { } method || !_handlers.TryGetValue(method, out var handler))
            return Message.Failure(id, new ProtocolError { Code = ErrorCodes.UnknownMethod, Message = $"No method {request.Method}" });

        try
        {
            return Message.Success(id, await handler(session, request.Params, cancellationToken));
        }
        catch (RpcException error)
        {
            return Message.Failure(id, error.ToError());
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            logger.LogError(error, "{Method} from {Client} failed", method, session.Info.ClientId);
            return Message.Failure(id, new ProtocolError { Code = ErrorCodes.Internal, Message = $"GigaCAD hit an error handling {method}" });
        }
    }
}
