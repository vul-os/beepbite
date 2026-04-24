package main

// Verifies the WhatsApp webhook's GET handshake and the rejection path.
// POSTing a full Meta webhook envelope is possible in principle but requires
// real phone_number_id + bot rows, so we only sanity-check that a malformed
// body doesn't 5xx.

func suiteWhatsApp(r *Runner) {
	// When WHATSAPP_WEBHOOK_VERIFY_TOKEN isn't set, our handler should 403
	// the handshake (never fake-accept it).
	resp := r.GET("/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc")
	r.CheckStatus(resp.status, 403, "handshake with wrong token 403")

	// Malformed POST — should 200 or 4xx, never 5xx.
	resp = r.POST("/webhooks/whatsapp", map[string]any{"object": "something_else"})
	r.Check(resp.status == 200 || (resp.status >= 400 && resp.status < 500),
		"malformed POST doesn't 5xx (got "+toStr(resp.status)+")")
}

func toStr(n int) string {
	if n == 0 {
		return "0"
	}
	b := []byte{}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}
