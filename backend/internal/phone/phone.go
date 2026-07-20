// Package phone turns the many ways a human writes a telephone number into the
// one way a database should store it: E.164, the ITU format that is "+", a
// country calling code, and the national number, with no spaces, punctuation or
// leading zeros — "+27821234567".
//
// # Why this package exists
//
// A phone number is an identity key in BeepBite. It is what links a WhatsApp
// conversation to a customer row, what a returning customer is recognised by,
// and what a receipt is delivered to. Storing it unnormalised means the same
// person arrives as several different people:
//
//	"082 123 4567"    →  a customer row
//	"+27 82 123 4567" →  a second customer row
//	"0821234567"      →  a third
//	"27821234567"     →  a fourth
//
// Each one has its own order history, its own loyalty balance, and its own
// half of the conversation. Nothing errors; the data just quietly forks. That
// is why normalisation happens at the point of *entry* rather than at the point
// of comparison — a lookup can only match what was actually written down.
//
// # Why guessing a country is worse than failing
//
// The interesting case is a bare national number with no "+": "0821234567".
// Read as South African it is +27821234567. Read as British it is +44821234567.
// Both are syntactically valid numbers, and there is nothing in the string that
// says which one is meant. The country is not in the input; it has to come from
// somewhere else.
//
// So Normalize requires the caller to supply it, and returns an error when it
// cannot. It never falls back to a built-in default country, because the
// failure mode of guessing is far worse than the failure mode of erroring:
//
//   - Erroring is loud, immediate, and lands on the person who can fix it. The
//     operator sees "phone number needs a country code", adds one, moves on.
//
//   - Guessing is silent and produces a well-formed, confidently wrong number.
//     +44821234567 looks exactly as valid as +27821234567. It gets stored, it
//     gets used as a customer key, and it gets sent messages — which either
//     vanish or, worse, reach a stranger who is now receiving another person's
//     order updates and delivery address. Nobody finds out until a customer
//     complains, and by then the bad key has propagated through orders, links
//     and audit records that all have to be untangled by hand.
//
// A default country baked into this package would be a default that is correct
// for exactly one country's operators and silently wrong for everyone else's,
// with no signal at the boundary. The country belongs to the *location* — see
// locations.Settings.PhoneCountryCode, which is the value callers should pass —
// and a location that has not configured one is telling us it wants E.164 input
// only. Honouring that is the whole point.
//
// # What this package is not
//
// This is shape normalisation, not carrier validation. It checks that a number
// could be an E.164 number; it cannot tell you the line exists, is reachable,
// or is a mobile. For that you need a lookup against the numbering plan (the
// libphonenumber metadata) or the carrier itself. Deliberately, no country's
// numbering rules are hardcoded here: length limits are the ITU-wide ones, so
// this package does not need editing when a country opens a new prefix range.
package phone

import (
	"errors"
	"fmt"
	"strings"
)

// Errors returned by Normalize. They are distinguished so a caller can tell an
// unusable input ("this is not a phone number") from a merely under-specified
// one ("this could be a phone number, but which country?") — the latter is
// often worth surfacing to the operator as a settings prompt rather than as a
// validation failure on the customer's field.
var (
	// ErrEmpty is returned for input with no digits in it at all.
	ErrEmpty = errors.New("phone: no number given")

	// ErrNoCountry is returned for a national-format number when the caller
	// supplied no default country code. This is the "would have to guess" case.
	ErrNoCountry = errors.New("phone: number is not in E.164 form and no country code was supplied")

	// ErrInvalid is returned when the input cannot be a valid E.164 number —
	// wrong length, stray letters, or a leading zero after the "+".
	ErrInvalid = errors.New("phone: not a valid E.164 number")

	// ErrAmbiguous is returned for a number with no "+" and no trunk prefix
	// that already begins with the default country's calling code, e.g.
	// "27821234567" against country code "27". Such a string is either an
	// international number missing its "+" or a national number that happens to
	// start with those digits, and nothing in the input distinguishes them.
	// The caller must disambiguate by supplying the "+".
	ErrAmbiguous = errors.New("phone: number is ambiguous; prefix it with '+' if it is already international")
)

// E.164 length bounds, counting every digit after the "+" including the country
// calling code.
//
// The maximum of 15 is fixed by ITU-T E.164 itself. The minimum is not — the
// shortest numbers in live use are 7 digits total (Saint Helena, +290 XXXX), so
// that is the floor. Both bounds are deliberately the global ones rather than
// any country's stricter rule: rejecting a valid foreign number is the same
// class of bug as guessing a country, and numbering plans lengthen over time.
const (
	minE164Digits = 7
	maxE164Digits = 15

	// maxCountryCodeDigits is the E.164 ceiling for a country calling code
	// (1 for NANP, 2 for most of Europe and Africa, 3 for the rest).
	maxCountryCodeDigits = 3
)

// IsE164 reports whether s is already a canonical E.164 string: a leading "+",
// then 7 to 15 digits, the first of which is non-zero, and nothing else — no
// spaces, no punctuation, no letters.
//
// It is strict on purpose. Its job is to answer "is this safe to store and
// compare as a key", and " +27 82 123 4567" is not, even though it describes a
// perfectly good number. Run such input through Normalize first.
func IsE164(s string) bool {
	if len(s) < 2 || s[0] != '+' {
		return false
	}
	digits := s[1:]
	if len(digits) < minE164Digits || len(digits) > maxE164Digits {
		return false
	}
	// A country calling code never starts with 0; "+0…" is malformed rather
	// than a number with an unusual prefix.
	if digits[0] == '0' {
		return false
	}
	for i := 0; i < len(digits); i++ {
		if digits[i] < '0' || digits[i] > '9' {
			return false
		}
	}
	return true
}

// Normalize converts a raw, human-entered phone number into canonical E.164.
//
// defaultCountryCode is the E.164 calling code of the country a bare national
// number should be read as, written without the "+" ("27", "1", "44", "351").
// Pass locations.Settings.PhoneCountryCode. Pass "" when the caller has no
// location context — Normalize will then accept only input that already carries
// its own country code, and error rather than guess.
//
// The accepted forms, in the order they are tried:
//
//	"+27 82 123 4567"  →  "+27821234567"   already international; punctuation stripped
//	"0027821234567"    →  "+27821234567"   "00" is the ITU international prefix
//	"082 123 4567"     →  "+27821234567"   national with trunk "0"; needs cc "27"
//	"(212) 555-0123"   →  "+12125550123"   national without trunk; needs cc "1"
//	"082 123 4567"     →  ErrNoCountry     national, but cc was ""
//
// Separators — spaces (including non-breaking), hyphens, dots, slashes,
// parentheses — are discarded wherever they appear, because they are typography
// rather than data and every country punctuates differently.
//
// # The two ambiguities, and how they are resolved
//
// First: input without a "+" is read as a national number for
// defaultCountryCode, never as an international number that happens to be
// missing its plus — except that when it *also* already starts with the country
// code, both readings are plausible and Normalize returns ErrAmbiguous instead
// of choosing. "27821234567" with cc "27" is either +27821234567 or
// +2727821234567; both are well-formed, so a wrong guess here would sail
// through every downstream check. Callers holding numbers that are already
// international must present them with the "+" (or "00"); IsE164 tells them
// whether they already have one.
//
// Second: a single leading "0" is treated as a trunk prefix and dropped. This
// is correct for most of the world but *not* universal — Italian numbers keep
// their leading zero (+39 06 …), and a few other plans have their own rules.
// Operators in those countries should leave the location's phone_country_code
// unset and store E.164 directly, which this function passes through untouched.
// Encoding per-country trunk rules here would mean shipping and maintaining a
// numbering-plan database; that is libphonenumber's job, and the seam for
// adopting it later is exactly this function.
func Normalize(raw string, defaultCountryCode string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", fmt.Errorf("%w: %q", ErrEmpty, raw)
	}

	// An international prefix in either notation means the number carries its
	// own country code and the default is irrelevant.
	intl := false
	switch {
	case strings.HasPrefix(s, "+"):
		intl, s = true, s[1:]
	case strings.HasPrefix(s, "00"):
		// "00" is the most common international access code (ITU-T E.123
		// recommends it); handling it here saves every caller from having to.
		intl, s = true, s[2:]
	}

	digits, err := onlyDigits(s)
	if err != nil {
		return "", fmt.Errorf("%w: %q contains non-digit characters", ErrInvalid, raw)
	}
	if digits == "" {
		return "", fmt.Errorf("%w: %q", ErrEmpty, raw)
	}

	if intl {
		out := "+" + digits
		if !IsE164(out) {
			return "", fmt.Errorf("%w: %q normalises to %q", ErrInvalid, raw, out)
		}
		return out, nil
	}

	// From here the number is national, so a country code is required. This is
	// the branch that must never invent one.
	cc, err := normalizeCountryCode(defaultCountryCode)
	if err != nil {
		return "", err
	}
	if cc == "" {
		return "", fmt.Errorf("%w: %q", ErrNoCountry, raw)
	}

	// A leading "0" marks the number as unambiguously national, so drop it as a
	// trunk prefix. Only one: "00…" was already consumed as an international
	// prefix above, so a number still starting "00" here is malformed and
	// should fail the length check rather than be repaired.
	national := digits
	if strings.HasPrefix(national, "0") {
		national = national[1:]
		if national == "" {
			return "", fmt.Errorf("%w: %q is all zeros", ErrInvalid, raw)
		}
	} else if strings.HasPrefix(national, cc) {
		// No trunk prefix *and* it already starts with the country code. Both
		// readings are plausible and both produce a well-formed number:
		// "27821234567" with cc "27" is either +27821234567 (the plus was
		// dropped) or +2727821234567 (a national number starting "27"). Picking
		// one would be the same silent guess this package refuses to make for
		// the country itself — and here the wrong pick yields a number that
		// passes every downstream validity check while belonging to nobody.
		return "", fmt.Errorf("%w: %q with country code %q", ErrAmbiguous, raw, cc)
	}

	out := "+" + cc + national
	if !IsE164(out) {
		return "", fmt.Errorf("%w: %q with country code %q normalises to %q", ErrInvalid, raw, cc, out)
	}
	return out, nil
}

// MustNormalize is Normalize for contexts where the input is a compile-time
// constant known to be valid — test fixtures and seed data. It panics on error,
// so it must never be reached from a request path where the input is untrusted.
func MustNormalize(raw, defaultCountryCode string) string {
	out, err := Normalize(raw, defaultCountryCode)
	if err != nil {
		panic(err)
	}
	return out
}

// normalizeCountryCode validates a caller-supplied dial code and returns it as
// bare digits. It tolerates a leading "+" so that a value copied from a settings
// field ("+27") works as well as the stored form ("27"), and treats empty as
// "no country configured" rather than as an error — that distinction is the
// caller's to act on.
func normalizeCountryCode(cc string) (string, error) {
	c := strings.TrimSpace(cc)
	c = strings.TrimPrefix(c, "+")
	if c == "" {
		return "", nil
	}
	digits, err := onlyDigits(c)
	if err != nil || digits == "" {
		return "", fmt.Errorf("%w: country code %q is not numeric", ErrInvalid, cc)
	}
	if len(digits) > maxCountryCodeDigits || digits[0] == '0' {
		return "", fmt.Errorf("%w: %q is not a country calling code", ErrInvalid, cc)
	}
	return digits, nil
}

// onlyDigits strips the punctuation humans use to group phone numbers and
// returns an error if anything else survives.
//
// Letters are rejected rather than ignored: a vanity number like "0800-FLOWERS"
// cannot be dialled as written by most of the world, and silently dropping the
// letters would turn it into a short, valid-looking, entirely different number.
func onlyDigits(s string) (string, error) {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '\t' || r == ' ' || r == ' ' ||
			r == '-' || r == '‐' || r == '‑' || r == '–' ||
			r == '.' || r == '/' || r == '(' || r == ')' || r == '[' || r == ']':
			// Grouping and separator characters: typography, not data.
		default:
			return "", ErrInvalid
		}
	}
	return b.String(), nil
}
