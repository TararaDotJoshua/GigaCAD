using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace GigaCAD.Plugins.Protocol
{
    /// <summary>Sends and receives whole messages over a stream. Sends are safe from several threads; receive from one.</summary>
    public sealed class MessageConnection : IDisposable
    {
        private readonly Stream _stream;
        private readonly SemaphoreSlim _writeLock = new SemaphoreSlim(1, 1);

        public MessageConnection(Stream stream)
        {
            _stream = stream;
        }

        public async Task SendAsync(Message message, CancellationToken cancellationToken)
        {
            var payload = ProtocolJson.Serialize(message);
            await _writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await MessageFraming.WriteFrameAsync(_stream, payload, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _writeLock.Release();
            }
        }

        /// <summary>The next message, or <c>null</c> once the other side closes the connection.</summary>
        public async Task<Message?> ReceiveAsync(CancellationToken cancellationToken)
        {
            var payload = await MessageFraming.ReadFrameAsync(_stream, cancellationToken).ConfigureAwait(false);
            return payload == null ? null : ProtocolJson.Deserialize(payload);
        }

        public void Dispose()
        {
            _stream.Dispose();
            _writeLock.Dispose();
        }
    }
}
