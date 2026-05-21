// Package imageupload — object storage interface + presign stub.
//
// No R2/S3 SDK was found in go.mod (no aws-sdk-go-v2, no cloudflare client).
// This file defines a Storer interface so the real implementation can be
// swapped in without touching the handler when credentials are provisioned.
//
// TODO (orchestrator): wire a concrete R2Storer using aws-sdk-go-v2/s3 + the
// Cloudflare R2 S3-compatible endpoint once the following env vars are set:
//
//	R2_ACCOUNT_ID      — Cloudflare account ID
//	R2_ACCESS_KEY_ID   — R2 API token access key
//	R2_SECRET_ACCESS_KEY
//	R2_BUCKET          — bucket name
//	R2_PUBLIC_BASE_URL — public base URL for the bucket (e.g. https://pub-xxx.r2.dev)
//
// Until then, StubStorer returns a signed-URL placeholder so the handler
// compiles and the API contract is stable.
package imageupload

import (
	"context"
	"fmt"
	"time"
)

// UploadTarget is returned by Presign and contains everything the client needs
// to PUT the file directly to object storage.
type UploadTarget struct {
	// PresignedURL is the URL the client should HTTP PUT the raw image bytes to.
	// For R2/S3 this is a signed URL. For the stub it is a placeholder.
	PresignedURL string `json:"presigned_url"`

	// PublicURL is the stable public URL of the object after the PUT succeeds.
	// Callers store this value in e.g. items.image_url.
	PublicURL string `json:"public_url"`

	// Key is the object key within the bucket (informational).
	Key string `json:"key"`

	// ExpiresAt is when the presigned URL expires. Clients must PUT before this.
	ExpiresAt time.Time `json:"expires_at"`
}

// Storer abstracts object storage so the handler is not coupled to any SDK.
type Storer interface {
	// Presign generates a presigned PUT URL for the given object key and
	// returns the stable public URL the caller should persist.
	Presign(ctx context.Context, orgID, key string) (*UploadTarget, error)
}

// ------------------------------------------------------------------ stub ----

// StubStorer is a no-op implementation used until real R2 credentials are wired.
// It returns a placeholder URL that makes the API contract clear without
// actually uploading anything.
//
// TODO (orchestrator): replace with R2Storer once env vars are configured.
type StubStorer struct {
	// PublicBaseURL is the base URL to use for the public URL placeholder.
	// Defaults to "https://cdn.example.com/stub" when empty.
	PublicBaseURL string
}

func (s *StubStorer) base() string {
	if s.PublicBaseURL != "" {
		return s.PublicBaseURL
	}
	return "https://cdn.example.com/stub"
}

func (s *StubStorer) Presign(_ context.Context, orgID, key string) (*UploadTarget, error) {
	exp := time.Now().UTC().Add(15 * time.Minute)
	publicURL := fmt.Sprintf("%s/%s/%s", s.base(), orgID, key)
	presignedURL := fmt.Sprintf("%s?stub_presign=1&org=%s&key=%s&expires=%d",
		publicURL, orgID, key, exp.Unix())
	return &UploadTarget{
		PresignedURL: presignedURL,
		PublicURL:    publicURL,
		Key:          key,
		ExpiresAt:    exp,
	}, nil
}
