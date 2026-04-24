// Command server runs the Go HTTP backend that replaces Supabase.
//
//	go run ./cmd/server --env=local
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/beepbite/backend/internal/ai"
	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/chatbot"
	"github.com/beepbite/backend/internal/config"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/aimenu"
	"github.com/beepbite/backend/internal/handlers/cashdrawer"
	"github.com/beepbite/backend/internal/handlers/data"
	"github.com/beepbite/backend/internal/handlers/paymentwebhooks"
	"github.com/beepbite/backend/internal/handlers/promotions"
	"github.com/beepbite/backend/internal/handlers/whatsappsend"
	"github.com/beepbite/backend/internal/handlers/whatsappwebhook"
	"github.com/beepbite/backend/internal/integrations/paystack"
	"github.com/beepbite/backend/internal/integrations/stripe"
	"github.com/beepbite/backend/internal/integrations/whatsapp"
	"github.com/beepbite/backend/internal/secretbox"
	"github.com/beepbite/backend/internal/staffauth"
)

func main() {
	env := flag.String("env", "", "environment: local, dev, main")
	flag.Parse()

	cfg, err := config.Load(*env)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer database.Close()

	// Services
	store := auth.NewStore(database.Pool)
	svc := auth.NewService(store, cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	google := auth.NewGoogle(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL)
	authH := auth.NewHandler(svc, google, postAuthRedirect(cfg))

	// Staff (POS username+password) auth. Shares the JWT signing secret with
	// email auth for now; the audience claim ("staff" vs unset) keeps the two
	// token surfaces from cross-contaminating. TODO: split into STAFF_JWT_SECRET
	// once we have key rotation tooling — the audience check is belt+suspenders
	// but a distinct secret would be strictly safer.
	staffStore := staffauth.NewStore(database.Pool)
	staffSvc := staffauth.NewService(staffStore, cfg.JWTSecret, cfg.AccessTokenTTL, cfg.RefreshTokenTTL)
	staffAuthH := staffauth.NewHandler(staffSvc)

	dataH := data.NewHandler(database.Pool)
	cashH := cashdrawer.NewHandler(database.Pool)
	promoH := promotions.NewHandler(promotions.NewEngine(database.Pool))

	aiSvc := ai.New(database.Pool, cfg.OpenAIAPIKey)
	aiH := aimenu.NewHandler(aiSvc)

	wa := whatsapp.NewClient(cfg.WhatsAppAccessToken, cfg.WhatsAppPhoneNumberID)
	waSendH := whatsappsend.NewHandler(wa)

	chatSvc := chatbot.New(database.Pool, wa)
	waWebhookH := whatsappwebhook.NewHandler(chatSvc, cfg.WhatsAppVerifyToken)

	// Payments: credentials live in env vars per region
	// (PAYSTACK_<REGION>_SECRET_KEY, STRIPE_<REGION>_SECRET_KEY, …). The
	// managers scan the environment at startup and build an in-memory
	// region → creds map. Missing regions are logged, not fatal, so a
	// partial setup (e.g. only ZA configured) still boots.
	frontendURL := ""
	if len(cfg.CORSOrigins) > 0 {
		frontendURL = strings.TrimRight(cfg.CORSOrigins[0], "/")
	}
	paystackMgr := paystack.NewManager(paystack.ManagerConfig{
		FrontendURL: frontendURL,
	})
	stripeMgr := stripe.NewManager(stripe.ManagerConfig{})
	pwH := paymentwebhooks.NewHandler(database.Pool, paystackMgr, stripeMgr)

	// PaymentKeyEncryptionSecret is still loaded — it's used to AES-GCM
	// encrypt bank account numbers once migration 27 lands. Build the
	// secretbox eagerly so a bad key fails startup, but nothing else in
	// this file reads it yet.
	if cfg.PaymentKeyEncryptionSecret != "" {
		if _, err := secretbox.New(cfg.PaymentKeyEncryptionSecret); err != nil {
			log.Fatalf("payment encryption key: %v", err)
		}
	} else {
		log.Println("PAYMENT_KEY_ENCRYPTION_SECRET not set — encrypted merchant columns (e.g. bank account numbers) will be unusable")
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Requested-With"},
		ExposedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "env": cfg.Env})
	})

	r.Route("/auth", func(r chi.Router) {
		authH.Mount(r)
		staffAuthH.Mount(r)
	})

	// Webhooks are unauthenticated — WhatsApp verifies via the verify token,
	// payment webhooks verify via per-region signature (see paymentwebhooks).
	r.Mount("/webhooks/whatsapp", waWebhookH)
	pwH.Mount(r)

	// Authenticated app surface.
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(svc))

		dataH.Mount(r)
		cashH.Mount(r)
		promoH.Mount(r)

		r.Post("/ai/menu", aiH)
		r.Post("/chatbot/whatsapp/send", waSendH)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("listening on :%s (env=%s, cors=%v)", cfg.Port, cfg.Env, cfg.CORSOrigins)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	<-sigs
	log.Println("shutting down")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
}

// postAuthRedirect picks the first CORS origin as the SPA base URL for the
// Google OAuth callback. Override via POST_AUTH_REDIRECT env if needed.
func postAuthRedirect(cfg *config.Config) string {
	if v := os.Getenv("POST_AUTH_REDIRECT"); v != "" {
		return v
	}
	if len(cfg.CORSOrigins) == 0 {
		return ""
	}
	return strings.TrimRight(cfg.CORSOrigins[0], "/") + "/auth/callback"
}

func notImplemented(msg string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}
}
