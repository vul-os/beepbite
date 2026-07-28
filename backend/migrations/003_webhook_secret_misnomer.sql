-- BeepBite — record what webhook_endpoints.signing_secret_ciphertext actually is.
--
-- Forward-only and additive. This migration changes no structure: it adds no
-- column, drops none, renames none, and rewrites no row. It exists to attach a
-- comment, because the problem it addresses is one of documentation.
--
-- # The defect
--
-- The column is named signing_secret_ciphertext and, from the baseline until
-- now, held PLAINTEXT. That is worse than a column honestly called
-- signing_secret. An auditor reading this schema, or an engineer reading a
-- query that joins it, reads "ciphertext", concludes the value is encrypted,
-- and stops looking. The name asserted a security property the data did not
-- have, and the assertion was load-bearing in exactly the review where it
-- mattered.
--
-- # Why the name is not simply corrected
--
-- 001_baseline has been applied. Renaming a column in an applied migration
-- rewrites history for every database that already ran it, and this repo does
-- not do that. So the name stays and the VALUE was changed to match it: new
-- secrets are sealed with AES-256-GCM before insert
-- (backend/internal/webhookdelivery/secret.go), and rows written before that
-- are converted by `go run ./cmd/encryptwebhooksecrets`.
--
-- The name is still wrong in one respect and always will be: "ciphertext" is
-- now accurate, but the column may transiently hold plaintext on a deployment
-- that has upgraded the binary and not yet run the conversion. The comment
-- below says so, and the query in that command's --check mode is how you find
-- out which state a given database is in.

COMMENT ON COLUMN public.webhook_endpoints.signing_secret_ciphertext IS
$$The endpoint signing secret, sealed with AES-256-GCM and base64-encoded
(nonce || ciphertext); the key comes from WEBHOOK_KEY_ENCRYPTION_SECRET or
APP_KEY_ENCRYPTION_SECRET.

MISNOMER, KNOWN AND DELIBERATE: from 001_baseline until migration 003 this
column was named "ciphertext" while holding PLAINTEXT. The name could not be
corrected without rewriting an applied migration, so the value was corrected
instead. A row is legacy plaintext if and only if it starts with 'whsec_' --
base64 has no underscore, so a sealed value never can. Convert with
`go run ./backend/cmd/encryptwebhooksecrets`; audit with its --check mode, or:

  SELECT count(*) FROM webhook_endpoints
   WHERE signing_secret_ciphertext LIKE 'whsec\_%';

A non-zero count means this database still stores webhook signing secrets in
the clear.$$;
