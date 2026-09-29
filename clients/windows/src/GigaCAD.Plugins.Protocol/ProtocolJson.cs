using System.Text.Json;
using System.Text.Json.Serialization;

namespace GigaCAD.Plugins.Protocol
{
    /// <summary>camelCase names, nulls left out, like the API.</summary>
    public static class ProtocolJson
    {
        public static readonly JsonSerializerOptions Options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        public static byte[] Serialize(Message message) => JsonSerializer.SerializeToUtf8Bytes(message, Options);

        public static Message Deserialize(byte[] payload)
        {
            Message? message;
            try
            {
                message = JsonSerializer.Deserialize<Message>(payload, Options);
            }
            catch (JsonException error)
            {
                throw new ProtocolException("A frame isn't valid JSON: " + error.Message);
            }
            return message ?? throw new ProtocolException("A frame held JSON null instead of a message");
        }

        public static JsonElement? ToElement(object? value) =>
            value == null ? (JsonElement?)null : JsonSerializer.SerializeToElement(value, value.GetType(), Options);

        /// <summary>Reads a message's params or result as <typeparamref name="T"/>. Missing or malformed input is a <c>bad_request</c>.</summary>
        public static T Read<T>(JsonElement? element)
            where T : class
        {
            if (element == null || element.Value.ValueKind == JsonValueKind.Null)
                throw new RpcException(ErrorCodes.BadRequest, $"Expected {typeof(T).Name}, got nothing");
            try
            {
                return element.Value.Deserialize<T>(Options) ?? throw new RpcException(ErrorCodes.BadRequest, $"Expected {typeof(T).Name}");
            }
            catch (JsonException error)
            {
                throw new RpcException(ErrorCodes.BadRequest, $"Expected {typeof(T).Name}: {error.Message}");
            }
        }
    }
}
