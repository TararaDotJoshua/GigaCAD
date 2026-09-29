using System;
using System.Text.Json;

namespace GigaCAD.Plugins.Protocol
{
    /// <summary>
    /// Stable error codes. Errors from the GigaCAD API (<c>checked_out</c>, <c>stale_head</c>, …) pass
    /// through with the API's own code.
    /// </summary>
    public static class ErrorCodes
    {
        public const string NotImplemented = "not_implemented";
        public const string UnknownMethod = "unknown_method";
        public const string UnknownClient = "unknown_client";
        public const string BadRequest = "bad_request";
        public const string ProtocolVersion = "protocol_version";
        public const string Timeout = "timeout";
        public const string Disconnected = "disconnected";
        public const string Internal = "internal";
    }

    /// <summary>The error half of a response. Same shape as the API's <c>{ error: { code, message, details } }</c>.</summary>
    public sealed class ProtocolError
    {
        public string Code { get; set; } = ErrorCodes.Internal;

        public string Message { get; set; } = "";

        public JsonElement? Details { get; set; }
    }

    /// <summary>A request that failed with a protocol error, on either side.</summary>
    public sealed class RpcException : Exception
    {
        public RpcException(string code, string message, JsonElement? details = null)
            : base(message)
        {
            Code = code;
            Details = details;
        }

        public string Code { get; }

        public JsonElement? Details { get; }

        public ProtocolError ToError() => new ProtocolError { Code = Code, Message = Message, Details = Details };
    }

    /// <summary>The byte stream broke the framing rules. The connection can't be used afterwards.</summary>
    public sealed class ProtocolException : Exception
    {
        public ProtocolException(string message)
            : base(message)
        {
        }
    }
}
