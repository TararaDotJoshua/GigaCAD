using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using GigaCAD.Plugins.Protocol;
using Xunit;

namespace GigaCAD.Plugins.Tests.Protocol
{
    public class ContractTests
    {
        [Fact]
        public void RequestsUseCamelCaseAndLeaveOutNulls()
        {
            var request = Message.Request("7", Methods.CommitVersion, new CommitVersionParams { Path = @"C:\GigaCAD\a\b\branches\dev\Robot.SLDASM", Message = "Stronger gripper" });
            var json = Encoding.UTF8.GetString(ProtocolJson.Serialize(request));

            Assert.Equal("{\"id\":\"7\",\"method\":\"branch.commitVersion\",\"params\":{\"path\":\"C:\\\\GigaCAD\\\\a\\\\b\\\\branches\\\\dev\\\\Robot.SLDASM\",\"message\":\"Stronger gripper\"}}", json);
        }

        [Fact]
        public void ErrorsMatchTheApiShape()
        {
            var failure = Message.Failure("1", new ProtocolError { Code = "checked_out", Message = "Checked out by @alex" });
            Assert.Equal("{\"id\":\"1\",\"error\":{\"code\":\"checked_out\",\"message\":\"Checked out by @alex\"}}", Encoding.UTF8.GetString(ProtocolJson.Serialize(failure)));
        }

        [Fact]
        public void SuccessWithoutAResultSendsAnEmptyObject()
        {
            Assert.Equal("{\"id\":\"1\",\"result\":{}}", Encoding.UTF8.GetString(ProtocolJson.Serialize(Message.Success("1", null))));
        }

        [Fact]
        public void RebuildReportsMatchTheApi()
        {
            var report = new RebuildReport
            {
                CandidateManifestId = "0b9a6c1e-0000-4000-8000-000000000000",
                Status = RebuildStatus.PassedWithWarnings,
                Messages = new List<RebuildMessage> { new RebuildMessage { Level = "warning", Message = "Mate is over-defined", Path = "Robot.SLDASM" } },
            };
            var json = JsonSerializer.Serialize(report, ProtocolJson.Options);
            Assert.Equal("{\"candidateManifestId\":\"0b9a6c1e-0000-4000-8000-000000000000\",\"status\":\"passed_with_warnings\",\"messages\":[{\"level\":\"warning\",\"message\":\"Mate is over-defined\",\"path\":\"Robot.SLDASM\"}]}", json);
        }

        [Fact]
        public void ClassifiesMessages()
        {
            Assert.True(Message.Request("1", "m", null).IsRequest);
            Assert.True(Message.Notification("m", null).IsNotification);
            Assert.True(Message.Success("1", null).IsResponse);
        }

        [Fact]
        public void BadJsonIsAProtocolError()
        {
            Assert.Throws<ProtocolException>(() => ProtocolJson.Deserialize(Encoding.UTF8.GetBytes("{nope")));
            Assert.Throws<ProtocolException>(() => ProtocolJson.Deserialize(Encoding.UTF8.GetBytes("null")));
        }

        [Fact]
        public void MissingOrWrongParamsAreBadRequests()
        {
            Assert.Equal(ErrorCodes.BadRequest, Assert.Throws<RpcException>(() => ProtocolJson.Read<HelloParams>(null)).Code);
            var wrong = JsonDocument.Parse("{\"processId\":\"not a number\"}").RootElement;
            Assert.Equal(ErrorCodes.BadRequest, Assert.Throws<RpcException>(() => ProtocolJson.Read<HelloParams>(wrong)).Code);
        }

        [Fact]
        public void PipeNamesAreSafeAndPerUser()
        {
            Assert.Equal("GigaCAD.Host.acme.alex_smith", PipeNames.ForUser("ACME", "Alex Smith"));
            Assert.NotEqual(PipeNames.ForUser("pc", "alex"), PipeNames.ForUser("pc", "sam"));
            Assert.StartsWith(PipeNames.Prefix, PipeNames.ForCurrentUser());
        }
    }
}
