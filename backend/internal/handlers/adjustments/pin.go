package adjustments

import (
	"context"
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// managerRoles is the set of staff.role values that may approve adjustments.
var managerRoles = map[string]struct{}{
	"manager": {},
	"owner":   {},
	"admin":   {},
}

// approverRow is the minimal slice of the staff row needed for PIN verification.
type approverRow struct {
	ID      string
	Role    string
	PinHash *string
}

// VerifyManagerPIN loads the staff row for approverID, confirms they have a
// manager-level role, and bcrypt-compares the submitted PIN against pin_hash.
//
// Errors:
//   - ErrApproverNotFound   — no staff row with that id
//   - ErrNotManager         — staff exists but role is not manager/owner/admin
//   - ErrPINMismatch        — PIN doesn't match hash (or pin_hash is NULL)
//   - any other error       — database/infra problem
func VerifyManagerPIN(ctx context.Context, store *Store, approverID, pin string) (*approverRow, error) {
	row, err := store.GetApproverByID(ctx, approverID)
	if errors.Is(err, ErrApproverNotFound) {
		return nil, ErrApproverNotFound
	}
	if err != nil {
		return nil, err
	}

	if _, ok := managerRoles[row.Role]; !ok {
		return nil, ErrNotManager
	}

	if row.PinHash == nil {
		// PIN login not configured for this manager — treat as mismatch.
		return nil, ErrPINMismatch
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*row.PinHash), []byte(pin)); err != nil {
		return nil, ErrPINMismatch
	}

	return row, nil
}
