using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using GigaCAD.Plugins.Protocol;
using Xunit;

namespace GigaCAD.Plugins.Tests.Protocol
{
    public class FramingTests
    {
        [Fact]
        public async Task RoundTripsFrames()
        {
            var stream = new MemoryStream();
            await MessageFraming.WriteFrameAsync(stream, Encoding.UTF8.GetBytes("{\"a\":1}"), CancellationToken.None);
            await MessageFraming.WriteFrameAsync(stream, new byte[0], CancellationToken.None);
            stream.Position = 0;

            Assert.Equal("{\"a\":1}", Encoding.UTF8.GetString((await MessageFraming.ReadFrameAsync(stream, CancellationToken.None))!));
            Assert.Empty((await MessageFraming.ReadFrameAsync(stream, CancellationToken.None))!);
            Assert.Null(await MessageFraming.ReadFrameAsync(stream, CancellationToken.None));
        }

        [Fact]
        public async Task WritesTheLengthLittleEndianFirst()
        {
            var stream = new MemoryStream();
            await MessageFraming.WriteFrameAsync(stream, new byte[258], CancellationToken.None);
            var bytes = stream.ToArray();
            Assert.Equal(new byte[] { 2, 1, 0, 0 }, new[] { bytes[0], bytes[1], bytes[2], bytes[3] });
            Assert.Equal(262, bytes.Length);
        }

        [Fact]
        public async Task ReadsFramesThatArriveInPieces()
        {
            var stream = new TrickleStream(new byte[] { 3, 0, 0, 0, (byte)'a', (byte)'b', (byte)'c' });
            Assert.Equal("abc", Encoding.UTF8.GetString((await MessageFraming.ReadFrameAsync(stream, CancellationToken.None))!));
        }

        [Fact]
        public async Task RejectsFramesOverTheLimit()
        {
            var length = MessageFraming.MaxFrameBytes + 1;
            var stream = new MemoryStream(new[] { (byte)length, (byte)(length >> 8), (byte)(length >> 16), (byte)(length >> 24) });
            await Assert.ThrowsAsync<ProtocolException>(() => MessageFraming.ReadFrameAsync(stream, CancellationToken.None));
            await Assert.ThrowsAsync<ProtocolException>(() => MessageFraming.WriteFrameAsync(new MemoryStream(), new byte[MessageFraming.MaxFrameBytes + 1], CancellationToken.None));
        }

        [Fact]
        public async Task RejectsNegativeLengths()
        {
            var stream = new MemoryStream(new byte[] { 0xff, 0xff, 0xff, 0xff });
            await Assert.ThrowsAsync<ProtocolException>(() => MessageFraming.ReadFrameAsync(stream, CancellationToken.None));
        }

        [Fact]
        public async Task RejectsStreamsThatEndMidFrame()
        {
            await Assert.ThrowsAsync<ProtocolException>(() => MessageFraming.ReadFrameAsync(new MemoryStream(new byte[] { 5, 0 }), CancellationToken.None));
            await Assert.ThrowsAsync<ProtocolException>(() => MessageFraming.ReadFrameAsync(new MemoryStream(new byte[] { 5, 0, 0, 0, 1, 2 }), CancellationToken.None));
        }

        /// <summary>Hands out one byte per read.</summary>
        private sealed class TrickleStream : MemoryStream
        {
            public TrickleStream(byte[] bytes)
                : base(bytes)
            {
            }

            public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
                base.ReadAsync(buffer, offset, Math.Min(count, 1), cancellationToken);
        }
    }
}
