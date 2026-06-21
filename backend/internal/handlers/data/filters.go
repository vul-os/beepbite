package data

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

var (
	identRx = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)
	// select=a,b,c or select=*
	columnsRx = regexp.MustCompile(`^(\*|[a-z_][a-z0-9_]*(?:,[a-z_][a-z0-9_]*)*)$`)
)

func isColumnIdent(s string) bool       { return identRx.MatchString(s) }
func looksLikeColumnList(s string) bool { return columnsRx.MatchString(s) }

// quoteIdent wraps an identifier in double quotes so reserved words / mixed
// case work. We already validate against identRx so this is just
// belt-and-braces.
func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// buildWhere inspects URL query params in supabase-js style and returns a WHERE
// clause + positional args.
//
// Supported operators:
//
//	eq=col,val          => col = $n
//	neq=col,val         => col <> $n
//	gt=col,val          => col > $n
//	gte=col,val         => col >= $n
//	lt=col,val          => col < $n
//	lte=col,val         => col <= $n
//	like=col,val        => col LIKE $n
//	ilike=col,val       => col ILIKE $n
//	in=col,v1,v2        => col = ANY($n)
//	is=col,null         => col IS NULL / col IS NOT NULL (for "not.null")
//	or=col.eq.val,col.is.null  => (col = $n OR col IS NULL)
//
// The `or` param accepts a comma-separated list of supabase-js-style terms
// (col.op.val or col.is.null / col.is.not.null) and wraps them in a single
// OR-group: (term1 OR term2 ...). Multiple `or` params each produce an
// independent OR-group that is AND-ed with the rest of the WHERE clause.
//
// offset is the number of $N placeholders already used by a preceding SET
// clause; ignore for pure-SELECT.
func buildWhere(q url.Values, offset int) (string, []any, error) {
	var preds []string
	var args []any

	addScalar := func(op, raw string) error {
		col, val, ok := splitOnce(raw, ",")
		if !ok || !isColumnIdent(col) {
			return fmt.Errorf("invalid %s filter", op)
		}
		args = append(args, parseScalar(val))
		preds = append(preds, fmt.Sprintf("%s %s $%d", quoteIdent(col), op, len(args)+offset))
		return nil
	}

	for _, v := range q["eq"] {
		if err := addScalar("=", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["neq"] {
		if err := addScalar("<>", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["gt"] {
		if err := addScalar(">", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["gte"] {
		if err := addScalar(">=", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["lt"] {
		if err := addScalar("<", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["lte"] {
		if err := addScalar("<=", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["like"] {
		if err := addScalar("LIKE", v); err != nil {
			return "", nil, err
		}
	}
	for _, v := range q["ilike"] {
		if err := addScalar("ILIKE", v); err != nil {
			return "", nil, err
		}
	}

	for _, v := range q["in"] {
		parts := strings.Split(v, ",")
		if len(parts) < 2 || !isColumnIdent(parts[0]) {
			return "", nil, errors.New("invalid in filter")
		}
		col := parts[0]
		// Compare as text so the filter works on enum columns too (e.g.
		// orders.status is the order_status enum). pgx cannot encode a []any
		// slice against a custom enum array type, and `enum = ANY(text[])` is a
		// type mismatch — casting the column to text sidesteps both. Values from
		// the URL are inherently strings, so a concrete []string encodes cleanly
		// as text[]; Postgres casts the column side (int/uuid/enum → text).
		vals := make([]string, 0, len(parts)-1)
		for _, raw := range parts[1:] {
			vals = append(vals, raw)
		}
		args = append(args, vals)
		preds = append(preds, fmt.Sprintf("%s::text = ANY($%d)", quoteIdent(col), len(args)+offset))
	}

	for _, v := range q["is"] {
		col, val, ok := splitOnce(v, ",")
		if !ok || !isColumnIdent(col) {
			return "", nil, errors.New("invalid is filter")
		}
		switch strings.ToLower(val) {
		case "null":
			preds = append(preds, fmt.Sprintf("%s IS NULL", quoteIdent(col)))
		case "not.null":
			preds = append(preds, fmt.Sprintf("%s IS NOT NULL", quoteIdent(col)))
		case "true":
			preds = append(preds, fmt.Sprintf("%s IS TRUE", quoteIdent(col)))
		case "false":
			preds = append(preds, fmt.Sprintf("%s IS FALSE", quoteIdent(col)))
		default:
			return "", nil, errors.New("invalid is value")
		}
	}

	// or=col.eq.val,col.is.null  =>  (col = $n OR col IS NULL)
	// Each `or` query param produces one OR-group AND-ed with everything else.
	for _, v := range q["or"] {
		terms := strings.Split(v, ",")
		var orParts []string
		for _, term := range terms {
			term = strings.TrimSpace(term)
			if term == "" {
				continue
			}
			// Split into at most 3 parts: col, op, value
			dot1 := strings.Index(term, ".")
			if dot1 < 0 {
				return "", nil, fmt.Errorf("invalid or term: %q", term)
			}
			col := term[:dot1]
			rest := term[dot1+1:]
			if !isColumnIdent(col) {
				return "", nil, fmt.Errorf("invalid or term column: %q", col)
			}
			dot2 := strings.Index(rest, ".")
			var op, val string
			if dot2 < 0 {
				op = rest
				val = ""
			} else {
				op = rest[:dot2]
				val = rest[dot2+1:]
			}
			switch strings.ToLower(op) {
			case "eq":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s = $%d", quoteIdent(col), len(args)+offset))
			case "neq":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s <> $%d", quoteIdent(col), len(args)+offset))
			case "gt":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s > $%d", quoteIdent(col), len(args)+offset))
			case "gte":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s >= $%d", quoteIdent(col), len(args)+offset))
			case "lt":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s < $%d", quoteIdent(col), len(args)+offset))
			case "lte":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s <= $%d", quoteIdent(col), len(args)+offset))
			case "like":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s LIKE $%d", quoteIdent(col), len(args)+offset))
			case "ilike":
				args = append(args, parseScalar(val))
				orParts = append(orParts, fmt.Sprintf("%s ILIKE $%d", quoteIdent(col), len(args)+offset))
			case "is":
				switch strings.ToLower(val) {
				case "null":
					orParts = append(orParts, fmt.Sprintf("%s IS NULL", quoteIdent(col)))
				case "not.null":
					orParts = append(orParts, fmt.Sprintf("%s IS NOT NULL", quoteIdent(col)))
				case "true":
					orParts = append(orParts, fmt.Sprintf("%s IS TRUE", quoteIdent(col)))
				case "false":
					orParts = append(orParts, fmt.Sprintf("%s IS FALSE", quoteIdent(col)))
				default:
					return "", nil, fmt.Errorf("invalid or is value: %q", val)
				}
			default:
				return "", nil, fmt.Errorf("unsupported or operator: %q", op)
			}
		}
		if len(orParts) == 1 {
			preds = append(preds, orParts[0])
		} else if len(orParts) > 1 {
			preds = append(preds, "("+strings.Join(orParts, " OR ")+")")
		}
	}

	return strings.Join(preds, " AND "), args, nil
}

func parseOrder(raw string) (col, dir string) {
	col, d, ok := splitOnce(raw, ".")
	if !ok {
		col = raw
		d = "asc"
	}
	if !isColumnIdent(col) {
		return "", ""
	}
	switch strings.ToLower(d) {
	case "asc", "":
		return col, "ASC"
	case "desc":
		return col, "DESC"
	}
	return "", ""
}

func splitOnce(s, sep string) (string, string, bool) {
	i := strings.Index(s, sep)
	if i < 0 {
		return s, "", false
	}
	return s[:i], s[i+len(sep):], true
}

// parseScalar tries to decode JSON literals — lets the frontend pass numbers,
// booleans, or `null` through a filter.
func parseScalar(raw string) any {
	if raw == "" {
		return ""
	}
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err == nil {
		switch v.(type) {
		case string, bool, float64, nil:
			return v
		}
	}
	return raw
}

// shiftPlaceholders increments every $N in expr by `n`. Only used to push a
// pre-built WHERE clause past SET args.
func shiftPlaceholders(expr string, n int) string {
	if n == 0 {
		return expr
	}
	return placeholderRx.ReplaceAllStringFunc(expr, func(m string) string {
		return fmt.Sprintf("$%d", atoi(m[1:])+n)
	})
}

var placeholderRx = regexp.MustCompile(`\$\d+`)

func atoi(s string) int {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}
