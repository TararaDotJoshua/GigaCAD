using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using GigaCAD.Plugins.Protocol;
using GigaCAD.Plugins.Tests.Support;
using Xunit;

namespace GigaCAD.Plugins.Tests.Protocol
{
    /// <summary>The add-in client against a scripted app on the other end of an in-memory pipe.</summary>
    public class ClientTests
    {
        private static readonly HelloParams Hello = new HelloParams { ClientId = "solidworks", ClientVersion = "0.1.0", CadName = "SolidWorks", CadVersion = "2025", ProcessId = 42 };

        [Fact]
        public async Task HandshakesAndKeepsTheHostsAnswer()
        {
            var (client, server) = MemoryPipe.Create();
            var app = new MessageConnection(server);
            var connecting = GigaCadHostClient.ConnectAsync(client, Hello, CancellationToken.None);

            var hello = (await app.ReceiveAsync(CancellationToken.None))!;
            Assert.Equal(Methods.Hello, hello.Method);
            var sent = ProtocolJson.Read<HelloParams>(hello.Params);
            Assert.Equal("solidworks", sent.ClientId);
            Assert.Equal(ProtocolVersion.Current, sent.ProtocolVersion);
            await app.SendAsync(Message.Success(hello.Id!, new HelloResult { HostVersion = "0.1.0", ProtocolVersion = 1, SignedInAs = "alex" }), CancellationToken.None);

            using (var connected = await connecting)
            {
                Assert.Equal("alex", connected.Host.SignedInAs);
                Assert.True(connected.IsConnected);
            }
        }

        [Fact]
        public async Task RefusedHandshakesThrowTheHostsError()
        {
            var (client, server) = MemoryPipe.Create();
            var app = new MessageConnection(server);
            var connecting = GigaCadHostClient.ConnectAsync(client, Hello, CancellationToken.None);

            var hello = (await app.ReceiveAsync(CancellationToken.None))!;
            await app.SendAsync(Message.Failure(hello.Id!, new ProtocolError { Code = ErrorCodes.ProtocolVersion, Message = "Update GigaCAD" }), CancellationToken.None);

            var error = await Assert.ThrowsAsync<RpcException>(() => connecting);
            Assert.Equal(ErrorCodes.ProtocolVersion, error.Code);
        }

        [Fact]
        public async Task MatchesResponsesToRequestsOutOfOrder()
        {
            var (client, app) = await ConnectedAsync();
            var first = client.GetFileStateAsync(new[] { "a.SLDPRT" }, CancellationToken.None);
            var second = client.CheckoutAsync("b.SLDPRT", CancellationToken.None);

            var firstRequest = (await app.ReceiveAsync(CancellationToken.None))!;
            var secondRequest = (await app.ReceiveAsync(CancellationToken.None))!;
            Assert.Equal(Methods.Checkout, secondRequest.Method);
            await app.SendAsync(Message.Success(secondRequest.Id!, new FileStateDto { Path = "b.SLDPRT", Writable = true }), CancellationToken.None);
            await app.SendAsync(Message.Success(firstRequest.Id!, new List<FileStateDto> { new FileStateDto { Path = "a.SLDPRT", CheckedOutBy = "sam" } }), CancellationToken.None);

            Assert.True((await second).Writable);
            Assert.Equal("sam", Assert.Single(await first).CheckedOutBy);
        }

        [Fact]
        public async Task ErrorResponsesThrowWithTheirCode()
        {
            var (client, app) = await ConnectedAsync();
            var checkout = client.CheckoutAsync("a.SLDPRT", CancellationToken.None);
            var request = (await app.ReceiveAsync(CancellationToken.None))!;
            await app.SendAsync(Message.Failure(request.Id!, new ProtocolError { Code = "checked_out", Message = "Checked out by @sam" }), CancellationToken.None);

            var error = await Assert.ThrowsAsync<RpcException>(() => checkout);
            Assert.Equal("checked_out", error.Code);
            Assert.Equal("Checked out by @sam", error.Message);
        }

        [Fact]
        public async Task TimesOutWhenTheHostDoesntAnswer()
        {
            var (client, _) = await ConnectedAsync();
            client.RequestTimeout = TimeSpan.FromMilliseconds(100);
            var error = await Assert.ThrowsAsync<RpcException>(() => client.CheckinAsync("a.SLDPRT", CancellationToken.None));
            Assert.Equal(ErrorCodes.Timeout, error.Code);
        }

        [Fact]
        public async Task RaisesStateChangedNotifications()
        {
            var (client, app) = await ConnectedAsync();
            var changed = new TaskCompletionSource<StateChangedParams>();
            client.StateChanged += (_, e) => changed.TrySetResult(e);

            await app.SendAsync(Message.Notification(Methods.StateChanged, new StateChangedParams { Paths = new List<string> { "a.SLDPRT" } }), CancellationToken.None);

            Assert.Equal("a.SLDPRT", Assert.Single((await changed.Task.WithTimeout()).Paths));
        }

        [Fact]
        public async Task FailsPendingRequestsWhenTheHostGoesAway()
        {
            var (client, app) = await ConnectedAsync();
            var disconnected = new TaskCompletionSource<bool>();
            client.Disconnected += (_, _) => disconnected.TrySetResult(true);
            var pending = client.CheckinAsync("a.SLDPRT", CancellationToken.None);
            await app.ReceiveAsync(CancellationToken.None);

            app.Dispose();

            Assert.Equal(ErrorCodes.Disconnected, (await Assert.ThrowsAsync<RpcException>(() => pending)).Code);
            Assert.True(await disconnected.Task.WithTimeout());
            Assert.False(client.IsConnected);
            Assert.Equal(ErrorCodes.Disconnected, (await Assert.ThrowsAsync<RpcException>(() => client.CheckinAsync("a", CancellationToken.None))).Code);
        }

        private static async Task<(GigaCadHostClient Client, MessageConnection App)> ConnectedAsync()
        {
            var (clientStream, serverStream) = MemoryPipe.Create();
            var app = new MessageConnection(serverStream);
            var connecting = GigaCadHostClient.ConnectAsync(clientStream, Hello, CancellationToken.None);
            var hello = (await app.ReceiveAsync(CancellationToken.None))!;
            await app.SendAsync(Message.Success(hello.Id!, new HelloResult { HostVersion = "0.1.0", ProtocolVersion = 1 }), CancellationToken.None);
            return (await connecting, app);
        }
    }
}
