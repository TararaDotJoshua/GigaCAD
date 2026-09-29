using GigaCAD.Plugins.Hosting;
using GigaCAD.Plugins.Protocol;
using GigaCAD.Plugins.Tests.Support;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace GigaCAD.Plugins.Tests.Hosting;

public class PipeHostTests
{
    private static HelloParams Hello(string clientId = "cad-addin", int protocolVersion = ProtocolVersion.Current) =>
        new() { ClientId = clientId, ClientVersion = "0.1.0", ProtocolVersion = protocolVersion, CadName = "Cad", CadVersion = "2025", ProcessId = 1234 };

    [Fact]
    public async Task HandshakesAndTellsThePluginItsAddInConnected()
    {
        var cad = new FakePlugin("cad");
        await using var host = Host(cad);
        var (clientStream, serverStream) = MemoryPipe.Create();
        var serving = host.Pipe.ServeAsync(serverStream, CancellationToken.None);

        using (var client = await GigaCadHostClient.ConnectAsync(clientStream, Hello(), CancellationToken.None))
        {
            Assert.Equal(ProtocolVersion.Current, client.Host.ProtocolVersion);
            Assert.Equal("9.9.9", client.Host.HostVersion);
            await Eventually(() => cad.Connected.Count == 1);
            var session = Assert.Single(host.Pipe.Sessions);
            Assert.Equal("cad", session.PluginId);
            Assert.Equal(1234, session.Info.ProcessId);
        }

        await serving.WithTimeout();
        Assert.Single(cad.Disconnected);
        Assert.Empty(host.Pipe.Sessions);
    }

    [Fact]
    public async Task AnswersMethodsTheAppDoesntDoYetWithNotImplemented()
    {
        await using var host = Host(new FakePlugin("cad"));
        using var client = await ConnectAsync(host);

        foreach (var method in Methods.Requests)
        {
            var error = await Assert.ThrowsAsync<RpcException>(() => client.RequestAsync<EmptyResult>(method, new BranchPathParams { Path = "a" }, CancellationToken.None));
            Assert.Equal(ErrorCodes.NotImplemented, error.Code);
        }
        Assert.Equal(ErrorCodes.UnknownMethod, (await Assert.ThrowsAsync<RpcException>(() => client.RequestAsync<EmptyResult>("files.delete", null, CancellationToken.None))).Code);
        Assert.Equal(ErrorCodes.BadRequest, (await Assert.ThrowsAsync<RpcException>(() => client.RequestAsync<HelloResult>(Methods.Hello, Hello(), CancellationToken.None))).Code);
    }

    [Fact]
    public async Task RunsHandlersTheAppRegisters()
    {
        await using var host = Host(new FakePlugin("cad"));
        host.Dispatcher.Register<GetFileStateParams, List<FileStateDto>>(Methods.GetFileState, (session, input, _) =>
            Task.FromResult(input.Paths.Select(path => new FileStateDto { Path = path, CheckedOutBy = session.Info.CadName }).ToList()));
        using var client = await ConnectAsync(host);

        var state = Assert.Single(await client.GetFileStateAsync(["a.prt"], CancellationToken.None));

        Assert.Equal("a.prt", state.Path);
        Assert.Equal("Cad", state.CheckedOutBy);
    }

    [Fact]
    public async Task TurnsHandlerExceptionsIntoErrors()
    {
        await using var host = Host(new FakePlugin("cad"));
        host.Dispatcher.Register(Methods.Checkout, (_, _, _) => throw new RpcException("checked_out", "Checked out by @sam"));
        host.Dispatcher.Register(Methods.Checkin, (_, _, _) => throw new InvalidOperationException("secret detail"));
        using var client = await ConnectAsync(host);

        Assert.Equal("checked_out", (await Assert.ThrowsAsync<RpcException>(() => client.CheckoutAsync("a", CancellationToken.None))).Code);
        var internalError = await Assert.ThrowsAsync<RpcException>(() => client.CheckinAsync("a", CancellationToken.None));
        Assert.Equal(ErrorCodes.Internal, internalError.Code);
        Assert.DoesNotContain("secret", internalError.Message);
    }

    [Fact]
    public async Task BroadcastsStateChanges()
    {
        await using var host = Host(new FakePlugin("cad"));
        using var client = await ConnectAsync(host);
        var changed = new TaskCompletionSource<StateChangedParams>();
        client.StateChanged += (_, e) => changed.TrySetResult(e);

        await host.Pipe.BroadcastAsync(Methods.StateChanged, new StateChangedParams { Paths = ["a.prt"] }, CancellationToken.None);

        Assert.Equal("a.prt", Assert.Single((await changed.Task.WithTimeout()).Paths));
    }

    [Theory]
    [InlineData("nobody", ProtocolVersion.Current, ErrorCodes.UnknownClient)]
    [InlineData("cad-addin", ProtocolVersion.Current + 1, ErrorCodes.ProtocolVersion)]
    public async Task RefusesAndClosesBadHandshakes(string clientId, int protocolVersion, string code)
    {
        var cad = new FakePlugin("cad");
        await using var host = Host(cad);
        var (clientStream, serverStream) = MemoryPipe.Create();
        var serving = host.Pipe.ServeAsync(serverStream, CancellationToken.None);

        var error = await Assert.ThrowsAsync<RpcException>(() => GigaCadHostClient.ConnectAsync(clientStream, Hello(clientId, protocolVersion), CancellationToken.None));

        Assert.Equal(code, error.Code);
        await serving.WithTimeout();
        Assert.Empty(cad.Connected);
    }

    [Fact]
    public async Task ClosesConnectionsThatDontStartWithHello()
    {
        await using var host = Host(new FakePlugin("cad"));
        var (clientStream, serverStream) = MemoryPipe.Create();
        var serving = host.Pipe.ServeAsync(serverStream, CancellationToken.None);
        var addIn = new MessageConnection(clientStream);

        await addIn.SendAsync(Message.Request("1", Methods.Checkout, new BranchPathParams { Path = "a" }), CancellationToken.None);

        Assert.Equal(ErrorCodes.BadRequest, (await addIn.ReceiveAsync(CancellationToken.None))!.Error!.Code);
        await serving.WithTimeout();
        Assert.Null(await addIn.ReceiveAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ClosesConnectionsThatSendGarbage()
    {
        await using var host = Host(new FakePlugin("cad"));
        var (clientStream, serverStream) = MemoryPipe.Create();
        var serving = host.Pipe.ServeAsync(serverStream, CancellationToken.None);

        await MessageFraming.WriteFrameAsync(clientStream, "not json"u8.ToArray(), CancellationToken.None);

        await serving.WithTimeout();
    }

    /// <summary>The whole stack over a real named pipe (a Unix domain socket off Windows), loading the real SolidWorks plugin.</summary>
    [Fact]
    public async Task ServesTheSolidWorksAddInOverARealPipe()
    {
        using var temp = new TempDirectory();
        var options = new PluginHostOptions { PipeName = "gc" + Guid.NewGuid().ToString("N")[..8], DataDirectory = temp.Path, HostVersion = "0.1.0" };
        options.PluginDirectories.Add(Path.Combine(AppContext.BaseDirectory, "plugins"));
        await using var host = PluginHost.Load(options, NullLoggerFactory.Instance);
        host.Start();

        using var client = await GigaCadHostClient.ConnectAsync(Hello("solidworks"), options.PipeName, TimeSpan.FromSeconds(5), CancellationToken.None);

        Assert.Equal("0.1.0", client.Host.HostVersion);
        Assert.Null(client.Host.SignedInAs);
        await Eventually(() => host.Pipe.Sessions.Count == 1);
        Assert.Equal("solidworks", Assert.Single(host.Pipe.Sessions).PluginId);
        Assert.Equal(ErrorCodes.NotImplemented, (await Assert.ThrowsAsync<RpcException>(() => client.GetFileStateAsync(["a.SLDPRT"], CancellationToken.None))).Code);

        // A second SolidWorks window gets its own session.
        using var second = await GigaCadHostClient.ConnectAsync(Hello("solidworks"), options.PipeName, TimeSpan.FromSeconds(5), CancellationToken.None);
        await Eventually(() => host.Pipe.Sessions.Count == 2);
    }

    [Fact]
    public async Task ConnectingWithNoAppRunningTimesOut()
    {
        await Assert.ThrowsAsync<TimeoutException>(() =>
            GigaCadHostClient.ConnectAsync(Hello(), "gc" + Guid.NewGuid().ToString("N")[..8], TimeSpan.FromMilliseconds(200), CancellationToken.None));
    }

    private static PluginHostForTest Host(params FakePlugin[] plugins)
    {
        var registry = new PluginRegistry(plugins.Select(plugin => plugin.AsLoaded()).ToList(), NullLogger<PluginRegistry>.Instance);
        var dispatcher = new RequestDispatcher(NullLogger<RequestDispatcher>.Instance);
        foreach (var method in Methods.Requests) dispatcher.Register(method, RequestDispatcher.NotImplemented(method));
        var pipe = new PipeHost("unused", "9.9.9", dispatcher, registry, () => null, NullLogger<PipeHost>.Instance);
        return new PluginHostForTest(pipe, dispatcher);
    }

    private static async Task<GigaCadHostClient> ConnectAsync(PluginHostForTest host)
    {
        var (clientStream, serverStream) = MemoryPipe.Create();
        _ = host.Pipe.ServeAsync(serverStream, CancellationToken.None);
        return await GigaCadHostClient.ConnectAsync(clientStream, Hello(), CancellationToken.None);
    }

    private static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 100 && !condition(); i++) await Task.Delay(20);
        Assert.True(condition());
    }

    private sealed class PluginHostForTest(PipeHost pipe, RequestDispatcher dispatcher) : IAsyncDisposable
    {
        public PipeHost Pipe { get; } = pipe;

        public RequestDispatcher Dispatcher { get; } = dispatcher;

        public ValueTask DisposeAsync() => Pipe.DisposeAsync();
    }
}
