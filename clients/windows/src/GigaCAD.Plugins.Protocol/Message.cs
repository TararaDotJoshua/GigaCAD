using System.Text.Json;
using System.Text.Json.Serialization;

namespace GigaCAD.Plugins.Protocol
{
    /// <summary>
    /// One frame's JSON, shaped like JSON-RPC 2.0 without the version field:
    /// a request has <c>id</c> and <c>method</c>, a notification has only <c>method</c>, and a
    /// response has <c>id</c> with either <c>result</c> or <c>error</c>.
    /// </summary>
    public sealed class Message
    {
        public string? Id { get; set; }

        public string? Method { get; set; }

        public JsonElement? Params { get; set; }

        public JsonElement? Result { get; set; }

        public ProtocolError? Error { get; set; }

        [JsonIgnore]
        public bool IsRequest => Id != null && Method != null;

        [JsonIgnore]
        public bool IsNotification => Id == null && Method != null;

        [JsonIgnore]
        public bool IsResponse => Id != null && Method == null;

        public static Message Request(string id, string method, object? parameters) =>
            new Message { Id = id, Method = method, Params = ProtocolJson.ToElement(parameters) };

        public static Message Notification(string method, object? parameters) =>
            new Message { Method = method, Params = ProtocolJson.ToElement(parameters) };

        public static Message Success(string id, object? result) =>
            new Message { Id = id, Result = ProtocolJson.ToElement(result ?? new EmptyResult()) };

        public static Message Failure(string id, ProtocolError error) => new Message { Id = id, Error = error };
    }
}
