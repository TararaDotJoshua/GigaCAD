using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace GigaCAD.Plugins.Protocol
{
    /// <summary>
    /// How a CAD add-in talks to the GigaCAD app. Connect with <see cref="ConnectAsync(HelloParams, string, TimeSpan, CancellationToken)"/>,
    /// which also runs the <c>host.hello</c> handshake. Requests that fail throw <see cref="RpcException"/>.
    /// </summary>
    public sealed class GigaCadHostClient : IDisposable
    {
        private readonly MessageConnection _connection;
        private readonly ConcurrentDictionary<string, TaskCompletionSource<Message>> _pending = new ConcurrentDictionary<string, TaskCompletionSource<Message>>();
        private readonly CancellationTokenSource _closing = new CancellationTokenSource();
        private Task _readLoop = Task.CompletedTask;
        private long _nextId;
        private int _disconnected;

        private GigaCadHostClient(Stream stream)
        {
            _connection = new MessageConnection(stream);
        }

        /// <summary>What the app said in the handshake.</summary>
        public HelloResult Host { get; private set; } = new HelloResult();

        public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(30);

        public bool IsConnected => Volatile.Read(ref _disconnected) == 0;

        /// <summary>The app says these paths changed state (checkout, new commit, …). Raised on a background thread.</summary>
        public event EventHandler<StateChangedParams>? StateChanged;

        /// <summary>The connection closed. Raised once, on a background thread.</summary>
        public event EventHandler? Disconnected;

        /// <summary>Connects to the app's pipe. Throws <see cref="TimeoutException"/> when the app isn't running.</summary>
        public static async Task<GigaCadHostClient> ConnectAsync(HelloParams hello, string? pipeName, TimeSpan connectTimeout, CancellationToken cancellationToken)
        {
            var pipe = new NamedPipeClientStream(".", pipeName ?? PipeNames.ForCurrentUser(), PipeDirection.InOut, PipeOptions.Asynchronous);
            try
            {
                await pipe.ConnectAsync((int)connectTimeout.TotalMilliseconds, cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                pipe.Dispose();
                throw;
            }
            return await ConnectAsync(pipe, hello, cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Runs the handshake over an already-open stream. The client owns the stream afterwards.</summary>
        public static async Task<GigaCadHostClient> ConnectAsync(Stream stream, HelloParams hello, CancellationToken cancellationToken)
        {
            var client = new GigaCadHostClient(stream);
            client._readLoop = Task.Run(client.ReadLoopAsync);
            try
            {
                client.Host = await client.RequestAsync<HelloResult>(Methods.Hello, hello, cancellationToken).ConfigureAwait(false);
            }
            catch
            {
                client.Dispose();
                throw;
            }
            return client;
        }

        public async Task<TResult> RequestAsync<TResult>(string method, object? parameters, CancellationToken cancellationToken)
            where TResult : class
        {
            if (!IsConnected) throw new RpcException(ErrorCodes.Disconnected, "Not connected to the GigaCAD app");

            var id = Interlocked.Increment(ref _nextId).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var response = new TaskCompletionSource<Message>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pending[id] = response;
            try
            {
                await _connection.SendAsync(Message.Request(id, method, parameters), cancellationToken).ConfigureAwait(false);

                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
                {
                    timeout.CancelAfter(RequestTimeout);
                    using (timeout.Token.Register(() => response.TrySetCanceled()))
                    {
                        Message message;
                        try
                        {
                            message = await response.Task.ConfigureAwait(false);
                        }
                        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && IsConnected)
                        {
                            throw new RpcException(ErrorCodes.Timeout, $"The GigaCAD app didn't answer {method} within {RequestTimeout.TotalSeconds:0} s");
                        }

                        if (message.Error != null) throw new RpcException(message.Error.Code, message.Error.Message, message.Error.Details);
                        return ProtocolJson.Read<TResult>(message.Result);
                    }
                }
            }
            finally
            {
                _pending.TryRemove(id, out _);
            }
        }

        public async Task<IReadOnlyList<FileStateDto>> GetFileStateAsync(IEnumerable<string> paths, CancellationToken cancellationToken) =>
            await RequestAsync<List<FileStateDto>>(Methods.GetFileState, new GetFileStateParams { Paths = paths.ToList() }, cancellationToken).ConfigureAwait(false);

        public Task<FileStateDto> CheckoutAsync(string path, CancellationToken cancellationToken) =>
            RequestAsync<FileStateDto>(Methods.Checkout, new BranchPathParams { Path = path }, cancellationToken);

        public Task<FileStateDto> CheckinAsync(string path, CancellationToken cancellationToken) =>
            RequestAsync<FileStateDto>(Methods.Checkin, new BranchPathParams { Path = path }, cancellationToken);

        public Task<CommitVersionResult> CommitVersionAsync(CommitVersionParams commit, CancellationToken cancellationToken) =>
            RequestAsync<CommitVersionResult>(Methods.CommitVersion, commit, cancellationToken);

        public Task ReportReferencesAsync(ReportReferencesParams references, CancellationToken cancellationToken) =>
            RequestAsync<EmptyResult>(Methods.ReportReferences, references, cancellationToken);

        public Task AttachExportAsync(AttachExportParams export, CancellationToken cancellationToken) =>
            RequestAsync<EmptyResult>(Methods.AttachExport, export, cancellationToken);

        public Task SubmitRebuildReportAsync(SubmitRebuildReportParams report, CancellationToken cancellationToken) =>
            RequestAsync<EmptyResult>(Methods.SubmitRebuildReport, report, cancellationToken);

        public void Dispose()
        {
            _closing.Cancel();
            _connection.Dispose();
            MarkDisconnected();
        }

        private async Task ReadLoopAsync()
        {
            try
            {
                while (!_closing.IsCancellationRequested)
                {
                    var message = await _connection.ReceiveAsync(_closing.Token).ConfigureAwait(false);
                    if (message == null) break;

                    if (message.IsResponse)
                    {
                        if (_pending.TryGetValue(message.Id!, out var waiter)) waiter.TrySetResult(message);
                    }
                    else if (message.IsNotification && message.Method == Methods.StateChanged)
                    {
                        StateChangedParams changed;
                        try
                        {
                            changed = ProtocolJson.Read<StateChangedParams>(message.Params);
                        }
                        catch (RpcException)
                        {
                            continue;
                        }
                        StateChanged?.Invoke(this, changed);
                    }
                }
            }
            catch (Exception)
            {
                // A broken or closed stream ends the connection; pending requests fail below.
            }
            finally
            {
                MarkDisconnected();
            }
        }

        private void MarkDisconnected()
        {
            if (Interlocked.Exchange(ref _disconnected, 1) != 0) return;
            foreach (var waiter in _pending.Values)
                waiter.TrySetException(new RpcException(ErrorCodes.Disconnected, "The connection to the GigaCAD app closed"));
            Disconnected?.Invoke(this, EventArgs.Empty);
        }
    }
}
