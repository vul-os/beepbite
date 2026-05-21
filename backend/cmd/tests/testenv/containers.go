package testenv

import (
	"context"
	"fmt"

	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// startContainer launches a postgres:16-alpine container via testcontainers-go
// and returns the DSN plus a cleanup function that terminates the container.
//
// Returns an error wrapping the Docker connection failure if Docker is absent,
// which the caller (startViaContainers) detects via isDockerMissing.
func startContainer(ctx context.Context) (connStr string, cleanup func(), err error) {
	ctr, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithDatabase("bb_test"),
		tcpostgres.WithUsername("bb_test"),
		tcpostgres.WithPassword("bb_test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2),
		),
	)
	if err != nil {
		return "", func() {}, fmt.Errorf("start postgres container: %w", err)
	}

	dsn, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		_ = ctr.Terminate(ctx)
		return "", func() {}, fmt.Errorf("container connection string: %w", err)
	}

	return dsn, func() {
		if err := ctr.Terminate(ctx); err != nil {
			// Non-fatal — the container will be GC'd by the Docker daemon.
			_ = err
		}
	}, nil
}
