using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace GigaCAD.Plugins.Tests.Support
{
    /// <summary>Two connected in-memory streams, like both ends of a pipe. Disposing either end closes both directions.</summary>
    internal static class MemoryPipe
    {
        public static (Stream Client, Stream Server) Create()
        {
            var toServer = new Channel();
            var toClient = new Channel();
            return (new End(toClient, toServer), new End(toServer, toClient));
        }

        private sealed class Channel
        {
            private readonly object _gate = new object();
            private readonly Queue<byte[]> _chunks = new Queue<byte[]>();
            private readonly SemaphoreSlim _available = new SemaphoreSlim(0);
            private byte[]? _current;
            private int _offset;
            private bool _completed;

            public void Write(byte[] buffer, int offset, int count)
            {
                var chunk = new byte[count];
                Buffer.BlockCopy(buffer, offset, chunk, 0, count);
                lock (_gate)
                {
                    if (_completed) throw new IOException("The pipe is closed");
                    _chunks.Enqueue(chunk);
                }
                _available.Release();
            }

            public void Complete()
            {
                lock (_gate)
                {
                    if (_completed) return;
                    _completed = true;
                }
                _available.Release();
            }

            public async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            {
                while (true)
                {
                    lock (_gate)
                    {
                        if (_current == null && _chunks.Count > 0)
                        {
                            _current = _chunks.Dequeue();
                            _offset = 0;
                        }
                        if (_current != null)
                        {
                            var read = Math.Min(count, _current.Length - _offset);
                            Buffer.BlockCopy(_current, _offset, buffer, offset, read);
                            _offset += read;
                            if (_offset == _current.Length) _current = null;
                            return read;
                        }
                        if (_completed)
                        {
                            _available.Release(); // Let any other reader see the end too.
                            return 0;
                        }
                    }
                    await _available.WaitAsync(cancellationToken).ConfigureAwait(false);
                }
            }
        }

        private sealed class End : Stream
        {
            private readonly Channel _incoming;
            private readonly Channel _outgoing;

            public End(Channel incoming, Channel outgoing)
            {
                _incoming = incoming;
                _outgoing = outgoing;
            }

            public override bool CanRead => true;

            public override bool CanSeek => false;

            public override bool CanWrite => true;

            public override long Length => throw new NotSupportedException();

            public override long Position
            {
                get => throw new NotSupportedException();
                set => throw new NotSupportedException();
            }

            public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
                _incoming.ReadAsync(buffer, offset, count, cancellationToken);

            public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer, offset, count, CancellationToken.None).GetAwaiter().GetResult();

            public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            {
                Write(buffer, offset, count);
                return Task.CompletedTask;
            }

            public override void Write(byte[] buffer, int offset, int count) => _outgoing.Write(buffer, offset, count);

            public override void Flush()
            {
            }

            public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;

            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

            public override void SetLength(long value) => throw new NotSupportedException();

            protected override void Dispose(bool disposing)
            {
                _outgoing.Complete();
                _incoming.Complete();
                base.Dispose(disposing);
            }
        }
    }
}
