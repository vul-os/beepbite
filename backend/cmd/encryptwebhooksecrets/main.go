// Command encryptwebhooksecrets converts webhook signing secrets that are
// still stored as plaintext into AES-256-GCM sealed values, in place.
//
// It migrates DATA, not schema. The column keeps its name — see
// migrations/003_webhook_secret_misnomer.sql for why it cannot be renamed and
// why the name was misleading to begin with.
//
// Usage:
//
//	go run ./cmd/encryptwebhooksecrets --check   # report only, exit 1 if any plaintext remains
//	go run ./cmd/encryptwebhooksecrets           # convert, then report
//
// Requires DATABASE_URL, and WEBHOOK_KEY_ENCRYPTION_SECRET or
// APP_KEY_ENCRYPTION_SECRET.
//
// # Idempotence, and how it is achieved rather than assumed
//
// A plaintext secret is exactly "whsec_<64 hex>"; a sealed one is base64 of
// nonce||ciphertext, and base64's alphabet has no underscore, so a sealed value
// can never start with "whsec_". The prefix is therefore a total, exact
// discriminator rather than a heuristic. The UPDATE selects on it, so:
//
//   - a second run matches nothing and converts nothing;
//   - a run interrupted halfway leaves a mix, and resuming finishes the job;
//   - a row converted by another process concurrently is skipped, because the
//     WHERE clause is re-evaluated against the row as it is at update time.
//
// There is no "already migrated" flag to get out of step with reality: the data
// answers the question about itself.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/webhookdelivery"
)

// plaintextPredicate matches legacy rows. The backslash escapes the underscore,
// which is a single-character wildcard in LIKE — without it this also matches
// "whsecX...", and a false positive here would hand a sealed value to Seal a
// second time and lock the real secret away behind two layers.
const plaintextPredicate = `signing_secret_ciphertext LIKE 'whsec\_%'`

func main() {
	check := flag.Bool("check", false, "report how many secrets are still plaintext and exit; convert nothing")
	flag.Parse()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	remaining, err := countPlaintext(ctx, pool)
	if err != nil {
		log.Fatalf("count plaintext secrets: %v", err)
	}

	if *check {
		fmt.Printf("webhook_endpoints rows with a PLAINTEXT signing secret: %d\n", remaining)
		if remaining > 0 {
			fmt.Println("run this command without --check to convert them")
			os.Exit(1)
		}
		fmt.Println("all webhook signing secrets are encrypted at rest")
		return
	}

	if remaining == 0 {
		fmt.Println("nothing to do: all webhook signing secrets are already encrypted at rest")
		return
	}

	codec, err := webhookdelivery.SecretCodecFromEnv()
	if err != nil {
		log.Fatalf("encryption key: %v", err)
	}
	if !codec.CanSeal() {
		log.Fatal("no encryption key: set WEBHOOK_KEY_ENCRYPTION_SECRET or APP_KEY_ENCRYPTION_SECRET")
	}

	converted, err := convert(ctx, pool, codec)
	if err != nil {
		log.Fatalf("convert: %v", err)
	}

	left, err := countPlaintext(ctx, pool)
	if err != nil {
		log.Fatalf("re-count after conversion: %v", err)
	}
	fmt.Printf("converted %d of %d; plaintext secrets remaining: %d\n", converted, remaining, left)
	if left != 0 {
		// Not a success. Exiting 0 here would let a deployment script conclude
		// the database is clean when it is not.
		log.Fatalf("%d rows are still plaintext after conversion", left)
	}
}

func countPlaintext(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var n int
	err := pool.QueryRow(ctx,
		`SELECT count(*) FROM webhook_endpoints WHERE `+plaintextPredicate).Scan(&n)
	return n, err
}

// convert seals every plaintext secret. Each row is read, sealed and written in
// its own transaction with the predicate re-checked in the UPDATE, so a
// concurrent converter cannot double-seal a row and a failure partway through
// leaves every already-converted row converted.
func convert(ctx context.Context, pool *pgxpool.Pool, codec *webhookdelivery.SecretCodec) (int, error) {
	rows, err := pool.Query(ctx,
		`SELECT id, signing_secret_ciphertext FROM webhook_endpoints WHERE `+plaintextPredicate)
	if err != nil {
		return 0, err
	}

	type row struct{ id, secret string }
	var todo []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.secret); err != nil {
			rows.Close()
			return 0, err
		}
		todo = append(todo, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	var n int
	for _, r := range todo {
		// Belt and braces: the SELECT already filtered, but sealing a value
		// that is not plaintext would be unrecoverable, so it is checked again
		// against the same helper the delivery path uses.
		if !webhookdelivery.LooksLikeLegacyPlaintext(r.secret) {
			continue
		}
		sealed, err := codec.Seal(r.secret)
		if err != nil {
			return n, fmt.Errorf("seal endpoint %s: %w", r.id, err)
		}
		tag, err := pool.Exec(ctx,
			`UPDATE webhook_endpoints SET signing_secret_ciphertext = $2
			  WHERE id = $1 AND `+plaintextPredicate, r.id, sealed)
		if err != nil {
			return n, fmt.Errorf("update endpoint %s: %w", r.id, err)
		}
		if tag.RowsAffected() == 1 {
			n++
		}
	}
	return n, nil
}
