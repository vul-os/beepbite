package channel

import "errors"

// ErrUnsupported is returned by Send only when a Message asks for something the
// rail cannot degrade honestly — in practice, a Template on a rail that has no
// template concept.
//
// Every other richness degrades: a list becomes numbered text, buttons become
// numbered text, an image becomes its caption plus the URL. A template cannot,
// because a template is used exactly when the rail refuses free-form messages
// outside a service window; sending the body as plain text there would be
// dropped by the provider while looking like a success here.
//
// A caller seeing this should fall back to a plain Message and accept that the
// notification may not arrive — which is the truth — rather than record a
// notification it did not send.
var ErrUnsupported = errors.New("channel: message kind not supported by this rail")

// ErrNotConfigured is returned when a rail is compiled in but has no
// credentials. It exists so the caller can tell "the operator has not turned
// this on" apart from "the rail rejected the message", which are different
// events for an audit log and for a retry decision.
var ErrNotConfigured = errors.New("channel: rail not configured")
