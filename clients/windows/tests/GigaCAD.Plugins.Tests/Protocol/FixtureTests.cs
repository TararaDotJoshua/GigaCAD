using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using GigaCAD.Plugins.Protocol;
using GigaCAD.Plugins.Tests.Support;
using Xunit;

namespace GigaCAD.Plugins.Tests.Protocol
{
    /// <summary>
    /// The app side of the protocol is TypeScript. Both sides check the same fixtures
    /// (clients/desktop/test/plugins/fixtures/pipe-protocol.json), so neither can drift.
    /// </summary>
    public class FixtureTests
    {
        private const string Branch = @"C:\Users\alex\GigaCAD\alex\arm\Branches\dev";

        private static readonly Dictionary<string, Message> Built = new Dictionary<string, Message>
        {
            ["helloRequest"] = Message.Request("1", Methods.Hello, new HelloParams { ClientId = "solidworks", ClientVersion = "0.1.0", CadName = "SolidWorks", CadVersion = "2025", ProcessId = 4242 }),
            ["helloResult"] = Message.Success("1", new HelloResult { HostVersion = "0.2.0", ProtocolVersion = 1, SignedInAs = "alex" }),
            ["helloResultSignedOut"] = Message.Success("1", new HelloResult { HostVersion = "0.2.0", ProtocolVersion = 1 }),
            ["getFileStateRequest"] = Message.Request("2", Methods.GetFileState, new GetFileStateParams { Paths = new List<string> { Branch + @"\Arm.SLDPRT" } }),
            ["getFileStateResult"] = Message.Success("2", new List<FileStateDto>
            {
                new FileStateDto { Path = Branch + @"\Arm.SLDPRT", IsGigaPath = true, Project = "alex/arm", Branch = "dev", Writable = false, CheckedOutBy = "sam" },
            }),
            ["commitVersionRequest"] = Message.Request("3", Methods.CommitVersion, new CommitVersionParams { Path = Branch, Message = "Stronger gripper" }),
            ["errorResponse"] = Message.Failure("4", new RpcException(ErrorCodes.ProtocolVersion, "Update GigaCAD", ProtocolJson.ToElement(new { hostProtocolVersion = 1 })).ToError()),
            ["submitRebuildReportRequest"] = Message.Request("5", Methods.SubmitRebuildReport, new SubmitRebuildReportParams
            {
                Path = @"C:\Users\alex\GigaCAD\alex\arm\Candidates\RR-3",
                Report = new RebuildReport
                {
                    CandidateManifestId = "0b9a6c1e-0000-4000-8000-000000000000",
                    Status = RebuildStatus.PassedWithWarnings,
                    Messages = new List<RebuildMessage> { new RebuildMessage { Level = "warning", Message = "Mate is over-defined", Path = "Robot.SLDASM" } },
                },
            }),
            ["stateChangedNotification"] = Message.Notification(Methods.StateChanged, new StateChangedParams { Paths = new List<string> { Branch } }),
        };

        public static IEnumerable<object[]> Names()
        {
            foreach (var name in Built.Keys) yield return new object[] { name };
        }

        [Fact]
        public void CoversEveryFixture()
        {
            var names = new List<string>();
            foreach (var property in Cases().EnumerateObject()) names.Add(property.Name);
            names.Sort(System.StringComparer.Ordinal);
            var built = new List<string>(Built.Keys);
            built.Sort(System.StringComparer.Ordinal);
            Assert.Equal(names, built);
        }

        [Theory]
        [MemberData(nameof(Names))]
        public void WritesTheSameJson(string name)
        {
            using (var written = JsonDocument.Parse(ProtocolJson.Serialize(Built[name])))
            {
                Assert.True(JsonElement.DeepEquals(Cases().GetProperty(name), written.RootElement), $"{name} differs: {Encoding.UTF8.GetString(ProtocolJson.Serialize(Built[name]))}");
            }
        }

        [Fact]
        public void ReadsTheFixtures()
        {
            var hello = ProtocolJson.Read<HelloParams>(Read("helloRequest").Params);
            Assert.Equal("solidworks", hello.ClientId);
            Assert.Equal(4242, hello.ProcessId);

            var result = Read("getFileStateResult");
            Assert.True(result.IsResponse);
            var state = Assert.Single(ProtocolJson.Read<List<FileStateDto>>(result.Result));
            Assert.Equal("sam", state.CheckedOutBy);
            Assert.False(state.Writable);

            Assert.Null(ProtocolJson.Read<HelloResult>(Read("helloResultSignedOut").Result).SignedInAs);
            Assert.Null(ProtocolJson.Read<CommitVersionParams>(Read("commitVersionRequest").Params).Label);

            var error = Read("errorResponse").Error!;
            Assert.Equal(ErrorCodes.ProtocolVersion, error.Code);
            Assert.Equal(1, error.Details!.Value.GetProperty("hostProtocolVersion").GetInt32());

            var report = ProtocolJson.Read<SubmitRebuildReportParams>(Read("submitRebuildReportRequest").Params).Report;
            Assert.Equal(RebuildStatus.PassedWithWarnings, report.Status);
            Assert.Equal("Robot.SLDASM", Assert.Single(report.Messages).Path);

            var notification = Read("stateChangedNotification");
            Assert.True(notification.IsNotification);
            Assert.Equal(Branch, Assert.Single(ProtocolJson.Read<StateChangedParams>(notification.Params).Paths));
        }

        private static Message Read(string name) => ProtocolJson.Deserialize(Encoding.UTF8.GetBytes(Cases().GetProperty(name).GetRawText()));

        private static JsonElement Cases()
        {
            var path = Path.Combine(RepoRoot.Find(), "clients", "desktop", "test", "plugins", "fixtures", "pipe-protocol.json");
            return JsonDocument.Parse(File.ReadAllText(path)).RootElement.GetProperty("cases");
        }
    }
}
