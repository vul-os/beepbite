package giftcards

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

const (
	codeAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	codeLength   = 16
)

// generateCode returns a random 16-character uppercase alphanumeric code.
func generateCode() (string, error) {
	alphabetLen := big.NewInt(int64(len(codeAlphabet)))
	buf := make([]byte, codeLength)
	for i := range buf {
		n, err := rand.Int(rand.Reader, alphabetLen)
		if err != nil {
			return "", fmt.Errorf("generateCode: %w", err)
		}
		buf[i] = codeAlphabet[n.Int64()]
	}
	return string(buf), nil
}

// maskCode returns the last 4 characters of the code, prefixed with asterisks,
// e.g. "************ABCD".
func maskCode(code string) string {
	code = strings.ToUpper(code)
	if len(code) <= 4 {
		return code
	}
	return strings.Repeat("*", len(code)-4) + code[len(code)-4:]
}
