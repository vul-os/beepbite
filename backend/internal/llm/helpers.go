package llm

import "encoding/json"

// llmErrMsg extracts a human-readable error string from a provider HTTP error
// response body.  It handles the two most common shapes:
//
//	{"error": {"message": "..."}}   — OpenAI / Moonshot / Anthropic style
//	{"message": "..."}              — simple flat body
//
// Falls back to the raw body (truncated to 300 bytes) if no message field is found.
func llmErrMsg(body []byte) string {
	var envelope struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &envelope); err == nil {
		if envelope.Error != nil && envelope.Error.Message != "" {
			return envelope.Error.Message
		}
		if envelope.Message != "" {
			return envelope.Message
		}
	}
	if len(body) > 300 {
		return string(body[:300])
	}
	return string(body)
}
