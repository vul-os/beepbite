// ses.go — AWS Simple Email Service (SES) adapter.
//
// Uses the SES v2 SendEmail API over HTTPS with AWS Signature Version 4
// request signing.  The adapter signs requests manually using only stdlib
// crypto packages so no AWS SDK dependency is needed.
//
// Docs: https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
//
// BYO credential keys (encrypted_keys JSON):
//
//	"access_key_id"     — AWS access key ID
//	"secret_access_key" — AWS secret access key
//	"region"            — AWS region (e.g. "us-east-1", "eu-west-1")
//	"from_email"        — SES-verified sender address
//
// TODO(heavy): implement AWS SigV4 signing.  The outline below constructs the
// correct JSON body and sets the required headers; the missing piece is the
// Authorization header (AWS4-HMAC-SHA256 credential/signature).  Once SigV4 is
// wired this adapter will be fully functional without any additional library.
// Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// SESAdapter implements Provider using the AWS SES v2 API.
type SESAdapter struct {
	accessKeyID     string
	secretAccessKey string
	region          string
	fromAddr        string
	httpClient      *http.Client
}

// NewSESAdapter constructs a SESAdapter.
//   - accessKeyID     — AWS access key ID.
//   - secretAccessKey — AWS secret access key.
//   - region          — AWS region (e.g. "us-east-1").
//   - fromAddr        — SES-verified sender address.
//   - hc              — optional HTTP client.
func NewSESAdapter(accessKeyID, secretAccessKey, region, fromAddr string, hc *http.Client) *SESAdapter {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	if region == "" {
		region = "us-east-1"
	}
	return &SESAdapter{
		accessKeyID:     accessKeyID,
		secretAccessKey: secretAccessKey,
		region:          region,
		fromAddr:        fromAddr,
		httpClient:      hc,
	}
}

// Code implements Provider.
func (a *SESAdapter) Code() string { return "ses" }

// sesV2SendEmailBody is the JSON payload for SES v2 SendEmail.
type sesV2SendEmailBody struct {
	FromEmailAddress string          `json:"FromEmailAddress"`
	Destination      sesDestination  `json:"Destination"`
	Content          sesContent      `json:"Content"`
	ReplyToAddresses []string        `json:"ReplyToAddresses,omitempty"`
}

type sesDestination struct {
	ToAddresses []string `json:"ToAddresses"`
}

type sesContent struct {
	Simple sesSimpleContent `json:"Simple"`
}

type sesSimpleContent struct {
	Subject sesBody `json:"Subject"`
	Body    sesBody `json:"Body"`
}

type sesBody struct {
	Data    string `json:"Data"`
	Charset string `json:"Charset,omitempty"`

	// sesBody is reused for both subject (plain) and body (html+text).
	// For html/text bodies the fields below are populated instead of Data.
	Html *sesBodyPart `json:"Html,omitempty"`
	Text *sesBodyPart `json:"Text,omitempty"`
}

type sesBodyPart struct {
	Data    string `json:"Data"`
	Charset string `json:"Charset"`
}

// Send implements Provider.
//
// TODO(heavy): replace the stub Authorization header with a real AWS SigV4
// signature computed via crypto/hmac + crypto/sha256.  All other request
// construction is correct and ready.
func (a *SESAdapter) Send(ctx context.Context, msg Message) error {
	from := msg.From
	if from == "" {
		from = a.fromAddr
	}

	body := sesV2SendEmailBody{
		FromEmailAddress: from,
		Destination:      sesDestination{ToAddresses: []string{msg.To}},
		Content: sesContent{
			Simple: sesSimpleContent{
				Subject: sesBody{Data: msg.Subject, Charset: "UTF-8"},
				Body: sesBody{
					Html: func() *sesBodyPart {
						if msg.HTML != "" {
							return &sesBodyPart{Data: msg.HTML, Charset: "UTF-8"}
						}
						return nil
					}(),
					Text: func() *sesBodyPart {
						if msg.Text != "" {
							return &sesBodyPart{Data: msg.Text, Charset: "UTF-8"}
						}
						return nil
					}(),
				},
			},
		},
	}
	if msg.ReplyTo != "" {
		body.ReplyToAddresses = []string{msg.ReplyTo}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("%w (ses): marshal: %v", ErrSendFailed, err)
	}

	endpoint := fmt.Sprintf("https://email.%s.amazonaws.com/v2/email/outbound-emails", a.region)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("%w (ses): build request: %v", ErrSendFailed, err)
	}
	req.Header.Set("Content-Type", "application/json")

	// TODO(heavy): compute AWS SigV4 Authorization header.
	// Required headers for SigV4:
	//   X-Amz-Date: <ISO8601 timestamp>
	//   Authorization: AWS4-HMAC-SHA256 Credential=<key>/<date>/<region>/ses/aws4_request,
	//                  SignedHeaders=content-type;host;x-amz-date,
	//                  Signature=<hex(HMAC-SHA256(signingKey, stringToSign))>
	// Until this TODO is resolved, requests will fail with 403 SignatureDoesNotMatch.
	_ = a.accessKeyID
	_ = a.secretAccessKey
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential=TODO")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w (ses): http: %v", ErrSendFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("%w (ses %d): %s", ErrSendFailed, resp.StatusCode, raw)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}
