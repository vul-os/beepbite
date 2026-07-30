package emit

// value.go — the deterministic encoding of a column value and of a whole row.
//
// # Why there is an encoding here at all
//
// An operation's payload is opaque to the substrate (`ext-value` carries a byte
// string, and internal/sync/substrate keeps it that way on purpose). Something
// still has to decide what bytes a Postgres value becomes, and that decision has
// three requirements:
//
//   - Deterministic. The same value must produce the same bytes every time, or
//     a replayed emit produces a different content address for the same fact and
//     the log grows a duplicate the engine cannot recognise as one.
//   - Unambiguous. NULL, the empty string and the empty byte string are three
//     different facts about a column and must not encode to the same bytes.
//     Every value is therefore tagged, and every variable-length field is
//     length-prefixed through internal/canon rather than concatenated.
//   - Exact. Nothing goes through a float on the way in or out. Postgres
//     numeric arrives as pgtype.Numeric and is written as its own integer
//     mantissa and exponent; money is minor units and arrives as an integer.
//
// # Floats
//
// float32 and float64 ARE encodable, by their exact IEEE-754 bits, because this
// schema has five genuine floating-point columns and all five are GPS
// (driver_location_pings.lat/lng/accuracy_m/heading_deg/speed_mps). Encoding
// them by bits rather than by a formatted decimal keeps the round trip exact and
// keeps the bytes stable across Go versions.
//
// The rule that money is never a float is enforced where it can actually be
// broken — in the schema — by TestNoMoneyColumnIsAFloat in
// internal/sync/ownership/schema_test.go, which fails if a replicated table
// grows a money-shaped column of a floating type. A guard in this file could
// only refuse a value after somebody had already designed the column, and would
// refuse GPS along with it.

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/beepbite/backend/internal/canon"
)

// Value tags. These are part of the encoding: changing one changes every
// content address this product has ever computed, so they are append-only.
const (
	tagNull    byte = 0
	tagText    byte = 1
	tagInt     byte = 2 // int64, 8 bytes big-endian
	tagBool    byte = 3
	tagBytes   byte = 4
	tagNumeric byte = 5 // exact decimal: mantissa "e" exponent
	tagTime    byte = 6 // RFC3339 with nanoseconds, normalised to UTC
	tagJSON    byte = 7
	tagFloat   byte = 8 // IEEE-754 float64 bits, 8 bytes big-endian
)

// EncodeValue renders one column value as tagged bytes.
//
// It refuses a type it does not recognise rather than falling back on
// fmt.Sprint. A value rendered by %v is a value whose bytes depend on a Go
// version's formatting, and a fact whose identity depends on that is not a fact
// two nodes can agree about.
func EncodeValue(v any) ([]byte, error) {
	switch t := v.(type) {
	case nil:
		return []byte{tagNull}, nil

	case string:
		return append([]byte{tagText}, t...), nil
	case []byte:
		return append([]byte{tagBytes}, t...), nil

	case bool:
		b := byte(0)
		if t {
			b = 1
		}
		return []byte{tagBool, b}, nil

	case int:
		return encodeInt(int64(t)), nil
	case int8:
		return encodeInt(int64(t)), nil
	case int16:
		return encodeInt(int64(t)), nil
	case int32:
		return encodeInt(int64(t)), nil
	case int64:
		return encodeInt(t), nil
	case uint8:
		return encodeInt(int64(t)), nil
	case uint16:
		return encodeInt(int64(t)), nil
	case uint32:
		return encodeInt(int64(t)), nil
	case uint64:
		if t > math.MaxInt64 {
			return nil, fmt.Errorf("emit: uint64 %d does not fit an int64", t)
		}
		return encodeInt(int64(t)), nil

	case float32:
		return encodeFloat(float64(t)), nil
	case float64:
		return encodeFloat(t), nil

	case time.Time:
		// UTC, so a value read back through a connection with a different
		// TimeZone setting encodes identically. RFC3339Nano trims trailing
		// zeros from the fraction, which is exactly what makes it canonical:
		// 12:00:00.100 and 12:00:00.1 are one instant and become one string.
		return append([]byte{tagTime}, t.UTC().Format(time.RFC3339Nano)...), nil

	case pgtype.Numeric:
		return encodeNumeric(t)
	case *pgtype.Numeric:
		if t == nil {
			return []byte{tagNull}, nil
		}
		return encodeNumeric(*t)

	case json.RawMessage:
		return append([]byte{tagJSON}, t...), nil
	case map[string]any, []any:
		// jsonb. encoding/json sorts object keys, so the same document
		// produces the same bytes.
		b, err := json.Marshal(t)
		if err != nil {
			return nil, fmt.Errorf("emit: encoding a json value: %w", err)
		}
		return append([]byte{tagJSON}, b...), nil

	case net.IP:
		return append([]byte{tagText}, t.String()...), nil
	case netip.Addr:
		return append([]byte{tagText}, t.String()...), nil
	case netip.Prefix:
		return append([]byte{tagText}, t.String()...), nil
	case *net.IPNet:
		if t == nil {
			return []byte{tagNull}, nil
		}
		return append([]byte{tagText}, t.String()...), nil

	default:
		return nil, fmt.Errorf(
			"emit: no deterministic encoding for %T — add one rather than letting it "+
				"fall back on a formatted string, whose bytes are a Go version's choice", v)
	}
}

func encodeInt(v int64) []byte {
	out := make([]byte, 9)
	out[0] = tagInt
	binary.BigEndian.PutUint64(out[1:], uint64(v))
	return out
}

func encodeFloat(v float64) []byte {
	out := make([]byte, 9)
	out[0] = tagFloat
	// Canonicalise the two NaN payloads and the signed zero, so a value that
	// compares equal encodes equal.
	if math.IsNaN(v) {
		v = math.NaN()
	} else if v == 0 {
		v = 0
	}
	binary.BigEndian.PutUint64(out[1:], math.Float64bits(v))
	return out
}

// encodeNumeric writes a Postgres numeric exactly, as "<mantissa>e<exponent>".
//
// Not as a float: converting 1234567890123456789.01 to a float64 and back does
// not return the same number, and a ledger summed from values that have been
// through a float is a ledger that reconciles to within a cent rather than to
// the cent.
//
// Trailing zeros are stripped so that 1.50 and 1.5 — which Postgres considers
// equal and which differ only in the scale a column happened to declare —
// produce one encoding rather than two.
func encodeNumeric(n pgtype.Numeric) ([]byte, error) {
	if !n.Valid {
		return []byte{tagNull}, nil
	}
	if n.NaN {
		return append([]byte{tagNumeric}, "NaN"...), nil
	}
	switch n.InfinityModifier {
	case pgtype.Infinity:
		return append([]byte{tagNumeric}, "Infinity"...), nil
	case pgtype.NegativeInfinity:
		return append([]byte{tagNumeric}, "-Infinity"...), nil
	}
	if n.Int == nil {
		return []byte{tagNull}, nil
	}

	mant := new(big.Int).Set(n.Int)
	exp := n.Exp
	if mant.Sign() == 0 {
		// Every spelling of zero is one value.
		return append([]byte{tagNumeric}, "0e0"...), nil
	}
	ten := big.NewInt(10)
	q, r := new(big.Int), new(big.Int)
	for {
		q.QuoRem(mant, ten, r)
		if r.Sign() != 0 {
			break
		}
		mant.Set(q)
		exp++
	}
	return append([]byte{tagNumeric}, fmt.Sprintf("%se%d", mant.String(), exp)...), nil
}

// EncodeRow renders a whole row as one deterministic byte string: every column
// in name order, each name and each value length-prefixed through
// internal/canon so no pair of (name, value) boundaries is ambiguous.
//
// This is what a ledger member's payload is. The row's own primary key is part
// of it, which matters for §4.3: two stock movements that record the same
// quantity of the same ingredient are two different rows and must stay two
// members. The engine additionally stamps every element with wall‖counter‖author
// (see internal/sync/substrate's ledgerElement) — so identity survives even for
// two facts whose payloads really are identical — but a payload that carries the
// row's identity means the two mechanisms have to fail together rather than
// separately.
func EncodeRow(row map[string]any) ([]byte, error) {
	names := make([]string, 0, len(row))
	for name := range row {
		names = append(names, name)
	}
	sort.Strings(names)

	var buf []byte
	for _, name := range names {
		v, err := EncodeValue(row[name])
		if err != nil {
			return nil, fmt.Errorf("emit: column %q: %w", name, err)
		}
		buf = canon.AppendChunk(buf, []byte(name))
		buf = canon.AppendChunk(buf, v)
	}
	return buf, nil
}

// DecodeRow reads back what EncodeRow wrote: a map from column name to that
// column's still-tagged value bytes.
//
// It exists because the read side of a ledger is a SUM over its members, and a
// SUM needs the quantity back out of the payload. Values stay tagged so a
// caller has to say which type it expects — DecodeNumeric on a text column
// fails rather than guessing — which is the same fail-closed rule the encoder
// follows in the other direction.
func DecodeRow(b []byte) (map[string][]byte, error) {
	out := make(map[string][]byte)
	for len(b) > 0 {
		name, rest, err := readChunk(b)
		if err != nil {
			return nil, fmt.Errorf("emit: decoding a row's column name: %w", err)
		}
		value, rest2, err := readChunk(rest)
		if err != nil {
			return nil, fmt.Errorf("emit: decoding column %q: %w", name, err)
		}
		if _, dup := out[string(name)]; dup {
			return nil, fmt.Errorf("emit: column %q appears twice in one row", name)
		}
		out[string(name)] = value
		b = rest2
	}
	return out, nil
}

func readChunk(b []byte) (chunk, rest []byte, err error) {
	if len(b) < 4 {
		return nil, nil, fmt.Errorf("%d bytes left, too few for a length prefix", len(b))
	}
	n := int(binary.BigEndian.Uint32(b[:4]))
	if n < 0 || len(b) < 4+n {
		return nil, nil, fmt.Errorf("length prefix says %d bytes, %d remain", n, len(b)-4)
	}
	return b[4 : 4+n], b[4+n:], nil
}

// DecodeNumeric reads a tagged value back as an exact rational.
//
// big.Rat rather than float64 because the whole reason the encoder writes a
// mantissa and an exponent is that a shop's cash position must reconcile to the
// cent and not to within a cent. A caller summing a ledger adds Rats.
//
// It accepts the integer tag as well as the numeric one, because a quantity
// column may be either (amount_cents is bigint; stock_movements.quantity is
// numeric) and a SUM over a ledger should not have to know which.
func DecodeNumeric(tagged []byte) (*big.Rat, error) {
	if len(tagged) == 0 {
		return nil, fmt.Errorf("emit: empty value")
	}
	switch tagged[0] {
	case tagInt:
		if len(tagged) != 9 {
			return nil, fmt.Errorf("emit: integer value is %d bytes, want 9", len(tagged))
		}
		return new(big.Rat).SetInt64(int64(binary.BigEndian.Uint64(tagged[1:]))), nil

	case tagNumeric:
		s := string(tagged[1:])
		mant, expStr, ok := strings.Cut(s, "e")
		if !ok {
			return nil, fmt.Errorf("emit: %q is not an exact numeric (NaN and infinities have no rational value)", s)
		}
		m, ok := new(big.Int).SetString(mant, 10)
		if !ok {
			return nil, fmt.Errorf("emit: %q has no integer mantissa", s)
		}
		exp, err := strconv.Atoi(expStr)
		if err != nil {
			return nil, fmt.Errorf("emit: %q has no integer exponent", s)
		}
		r := new(big.Rat).SetInt(m)
		scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(abs(exp))), nil)
		if exp >= 0 {
			r.Mul(r, new(big.Rat).SetInt(scale))
		} else {
			r.Quo(r, new(big.Rat).SetInt(scale))
		}
		return r, nil

	case tagNull:
		return nil, fmt.Errorf("emit: value is NULL, which is not a quantity")

	default:
		return nil, fmt.Errorf("emit: value has tag %d, which is not a number", tagged[0])
	}
}

// DecodeText reads a tagged value back as a string, refusing any other tag.
func DecodeText(tagged []byte) (string, error) {
	if len(tagged) == 0 || tagged[0] != tagText {
		return "", fmt.Errorf("emit: value is not text")
	}
	return string(tagged[1:]), nil
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// KeyString renders a column value as the §4.1 target component that addresses a
// row: an op's Key, or a ledger's grouping value.
//
// It is deliberately narrow. An address must be a stable, readable string that
// the same row produces on every node, so only the types a primary key or a
// foreign key can actually be are accepted — uuid (already rendered as text by
// the caller), text, and integers. A timestamp or a jsonb column is not an
// address, and coercing one into a string here would produce an address whose
// spelling depends on a formatting choice.
//
// NULL is refused rather than mapped to "": a row whose key is unknown is a row
// this node cannot address, and emitting it at the empty target would put every
// such row on top of every other one.
func KeyString(v any) (string, error) {
	switch t := v.(type) {
	case nil:
		return "", errNilKey
	case string:
		if t == "" {
			return "", errNilKey
		}
		if strings.Contains(t, "/") {
			// targetOf joins entity and key with "/", and splits at the first
			// one. A key containing the separator would still address a row,
			// but not the row it names.
			return "", fmt.Errorf("emit: key %q contains %q, which would make its op target ambiguous", t, "/")
		}
		return t, nil
	case int:
		return fmt.Sprintf("%d", t), nil
	case int16:
		return fmt.Sprintf("%d", t), nil
	case int32:
		return fmt.Sprintf("%d", t), nil
	case int64:
		return fmt.Sprintf("%d", t), nil
	case [16]byte:
		return formatUUID(t), nil
	default:
		return "", fmt.Errorf("emit: %T is not a usable row address", v)
	}
}

// formatUUID renders pgx's raw uuid representation in the canonical 8-4-4-4-12
// form. The generic REST layer already does this before a row reaches here, so
// this is the path for a caller that passes a row straight off pgx.
func formatUUID(b [16]byte) string {
	const hexdigits = "0123456789abcdef"
	var out [36]byte
	j := 0
	for i, v := range b {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out[j] = '-'
			j++
		}
		out[j] = hexdigits[v>>4]
		out[j+1] = hexdigits[v&0x0f]
		j += 2
	}
	return string(out[:])
}
