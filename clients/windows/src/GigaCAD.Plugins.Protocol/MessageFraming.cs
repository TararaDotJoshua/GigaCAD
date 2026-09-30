using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace GigaCAD.Plugins.Protocol
{
    /// <summary>Each frame is a 4-byte little-endian length, then that many bytes of UTF-8 JSON.</summary>
    public static class MessageFraming
    {
        public const int MaxFrameBytes = 16 * 1024 * 1024;

        /// <summary>Reads one frame. Returns <c>null</c> when the stream ends cleanly between frames.</summary>
        public static async Task<byte[]?> ReadFrameAsync(Stream stream, CancellationToken cancellationToken)
        {
            var header = new byte[4];
            var read = await ReadExactlyAsync(stream, header, cancellationToken).ConfigureAwait(false);
            if (read == 0) return null;
            if (read < header.Length) throw new ProtocolException("The connection closed in the middle of a frame header");

            var length = header[0] | (header[1] << 8) | (header[2] << 16) | (header[3] << 24);
            if (length < 0 || length > MaxFrameBytes) throw new ProtocolException($"A frame of {(uint)length} bytes is over the {MaxFrameBytes}-byte limit");

            var payload = new byte[length];
            if (await ReadExactlyAsync(stream, payload, cancellationToken).ConfigureAwait(false) < length)
                throw new ProtocolException("The connection closed in the middle of a frame");
            return payload;
        }

        public static async Task WriteFrameAsync(Stream stream, byte[] payload, CancellationToken cancellationToken)
        {
            if (payload.Length > MaxFrameBytes) throw new ProtocolException($"A frame of {payload.Length} bytes is over the {MaxFrameBytes}-byte limit");

            // One write per frame, so a frame never interleaves with another writer's bytes.
            var frame = new byte[4 + payload.Length];
            frame[0] = (byte)payload.Length;
            frame[1] = (byte)(payload.Length >> 8);
            frame[2] = (byte)(payload.Length >> 16);
            frame[3] = (byte)(payload.Length >> 24);
            Buffer.BlockCopy(payload, 0, frame, 4, payload.Length);
            await stream.WriteAsync(frame, 0, frame.Length, cancellationToken).ConfigureAwait(false);
            await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        }

        /// <summary>Fills the buffer unless the stream ends first. Returns the bytes read.</summary>
        private static async Task<int> ReadExactlyAsync(Stream stream, byte[] buffer, CancellationToken cancellationToken)
        {
            var total = 0;
            while (total < buffer.Length)
            {
                var read = await stream.ReadAsync(buffer, total, buffer.Length - total, cancellationToken).ConfigureAwait(false);
                if (read == 0) break;
                total += read;
            }
            return total;
        }
    }
}
