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
	"github.com/beepbite/backend/internal/handlers/adjustments"
	"github.com/beepbite/backend/internal/handlers/aimenu"
	"github.com/beepbite/backend/internal/handlers/bankaccounts"
	"github.com/beepbite/backend/internal/handlers/cashdrawer"
	"github.com/beepbite/backend/internal/handlers/data"
	"github.com/beepbite/backend/internal/handlers/giftcards"
	"github.com/beepbite/backend/internal/handlers/houseaccounts"
	"github.com/beepbite/backend/internal/handlers/inventory"
	"github.com/beepbite/backend/internal/handlers/kds"
	"github.com/beepbite/backend/internal/handlers/deliveryzones"
	"github.com/beepbite/backend/internal/handlers/fiscal"
	"github.com/beepbite/backend/internal/handlers/marketplace"
	"github.com/beepbite/backend/internal/handlers/payroll"
	"github.com/beepbite/backend/internal/handlers/paymentcredentials"
	"github.com/beepbite/backend/internal/handlers/paymentwebhook"
	"github.com/beepbite/backend/internal/handlers/paymentwebhooks"
	"github.com/beepbite/backend/internal/handlers/pos"
	"github.com/beepbite/backend/internal/handlers/promotions"
	"github.com/beepbite/backend/internal/handlers/reservations"
	"github.com/beepbite/backend/internal/handlers/storecredit"
	"github.com/beepbite/backend/internal/handlers/tables"
	"github.com/beepbite/backend/internal/handlers/tippools"
	"github.com/beepbite/backend/internal/handlers/transferwebhook"
	"github.com/beepbite/backend/internal/handlers/waste"
	"github.com/beepbite/backend/internal/handlers/whatsappsend"
	"github.com/beepbite/backend/internal/handlers/whatsappwebhook"
	"github.com/beepbite/backend/internal/integrations/mapbox"
	"github.com/beepbite/backend/internal/integrations/paystack"
	"github.com/beepbite/backend/internal/jobs/auditretention"
	"github.com/beepbite/backend/internal/jobs/kdsfanout"
	"github.com/beepbite/backend/internal/jobs/payouts"
	"github.com/beepbite/backend/internal/jobs/recipecost"
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
	staffAuthH := staffauth.NewHandlerWithPool(staffSvc, database.Pool)

	dataH := data.NewHandler(database.Pool)
	cashH := cashdrawer.NewHandler(database.Pool)
	promoH := promotions.NewHandler(promotions.NewEngine(database.Pool))
	tablesH := tables.NewHandler(database.Pool)
	kdsH := kds.NewHandler(database.Pool)
	posH := pos.NewHandler(database.Pool)
	adjustmentsH := adjustments.NewHandler(database.Pool)
	giftcardsH := giftcards.NewHandler(database.Pool)
	storecreditH := storecredit.NewHandler(database.Pool)
	houseaccountsH := houseaccounts.NewHandler(database.Pool)
	inventoryH := inventory.NewHandler(database.Pool)
	tipPoolsH := tippools.NewHandler(database.Pool)
	wasteH := waste.NewHandler(database.Pool)
	payrollH := payroll.NewHandler(database.Pool)
	reservationsH := reservations.NewHandler(database.Pool)
	deliveryZonesH := deliveryzones.NewHandler(database.Pool)
	fiscalH := fiscal.NewHandler(database.Pool)
	marketplaceH := marketplace.NewHandler(database.Pool)
	recipeCostRunner := recipecost.NewRunner(database.Pool)
	kdsFanoutRunner := kdsfanout.NewRunner(database.Pool, kds.NewStore(database.Pool))
	auditRetentionRunner := auditretention.NewRunner(database.Pool, 90)

	aiSvc := ai.New(database.Pool, cfg.OpenAIAPIKey)
	aiH := aimenu.NewHandler(aiSvc)

	wa := whatsapp.NewClient(cfg.WhatsAppAccessToken, cfg.WhatsAppPhoneNumberID)
	waSendH := whatsappsend.NewHandler(wa)

	var mbClient *mapbox.Client
	mapboxToken := os.Getenv("MAPBOX_TOKEN")
	if mapboxToken == "" {
		log.Println("WARNING: MAPBOX_TOKEN not set — chatbot geocoding will fall back to stub behaviour (users must share location instead of typing an address)")
	} else {
		mbClient = mapbox.NewClient(mapbox.Config{APIKey: mapboxToken})
	}
	chatSvc := chatbot.NewWithMapbox(database.Pool, wa, mbClient)
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

	// PaymentKeyEncryptionSecret encrypts bank account numbers (migration 27).
	// Build the secretbox eagerly so a bad key fails startup; pass it to the
	// bank-account handler. If unset, the bank-account routes are skipped.
	var paymentBox *secretbox.Box
	if cfg.PaymentKeyEncryptionSecret != "" {
		box, err := secretbox.New(cfg.PaymentKeyEncryptionSecret)
		if err != nil {
			log.Fatalf("payment encryption key: %v", err)
		}
		paymentBox = box
	} else {
		log.Println("PAYMENT_KEY_ENCRYPTION_SECRET not set — bank-account + payout endpoints disabled")
	}

	var bankaccountsH *bankaccounts.Handler
	if paymentBox != nil {
		bankaccountsH = bankaccounts.NewHandler(database.Pool, paystackMgr, paymentBox)
	}

	var paymentCredsH *paymentcredentials.Handler
	if paymentBox != nil {
		paymentCredsH = paymentcredentials.NewHandler(database.Pool, paymentBox, frontendURL)
	}

	// Unified webhook handler (T8.3): POST /webhooks/{provider}/{location_id}.
	// Also registers backward-compat shims for old Paystack URLs.
	unifiedWebhookH := paymentwebhook.NewHandler(database.Pool, paystackMgr, stripeMgr, paymentBox)

	transferWebhookH := transferwebhook.NewHandler(database.Pool, paystackMgr)
	transferReconciler := transferwebhook.NewReconciler(database.Pool, paystackMgr)
	payoutRunner := payouts.NewRunner(database.Pool, paystackMgr)

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

	// Webhooks are unauthenticated — verified by HMAC or token per provider.
	r.Mount("/webhooks/whatsapp", waWebhookH)
	// Unified webhook handler: POST /webhooks/{provider}/{location_id} plus
	// backward-compat shims for old Paystack and transfer URLs.
	unifiedWebhookH.Mount(r)
	// Legacy handlers kept alive in parallel while clients migrate.
	// TODO(T8): remove once all webhooks route through the unified handler.
	pwH.Mount(r)
	transferWebhookH.Mount(r)

	// Public marketplace store directory (no auth required).
	// RLS is enforced at the DB layer via MarketplaceScope (is_marketplace_visible=true only).
	r.Route("/stores", marketplaceH.Mount)

	// Authenticated app surface — JWT required for all sub-groups below.
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(svc))

		// Routes that require a valid JWT but NOT org-scope resolution.
		// (Staff manager endpoints act on cross-org data; AI/chatbot helpers
		// are internal tooling that doesn't operate on per-location records.)
		staffAuthH.MountManagerRoutes(r)
		staffAuthH.MountPinVerify(r)
		r.Post("/ai/menu", aiH)
		r.Post("/chatbot/whatsapp/send", waSendH)

		// Authenticated + org-scoped sub-group.
		//
		// auth.RequireOrgScope resolves the caller's organization memberships
		// from the DB, enforces that the user has at least one membership (403
		// otherwise), and injects an OrgScope + db.Scope into context.
		//
		// auth.ActorOverlay reads the optional X-Actor-Token header (or
		// actor_token query param) and, when valid, extends db.Scope with the
		// staff actor's identity + capabilities for the duration of the
		// request. Invalid / absent tokens pass through silently.
		//
		// Handlers in this block MUST use auth.OrgScopeFrom(ctx) — the
		// canonical extractor — to read the scope. Do NOT introduce any other
		// scope extractor.
		//
		// Routes covered: /data/*, /pos/*, /kds/*, /cashdrawer/*,
		//   /tippools/*, /tables/*, /adjustments/*, /payment-credentials/*,
		//   and all ancillary commerce + ops routes below.
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireOrgScope(database.Pool))
			r.Use(auth.ActorOverlay([]byte(cfg.JWTSecret)))

			// Generic data layer (/data/{table} + /rpc/{fn}).
			dataH.MountWithIdempotency(r, database.Pool)

			// POS orders + charge + mark-paid-on-delivery.
			posH.Mount(r)

			// Kitchen Display System.
			r.Route("/kds", kdsH.Mount)

			// Cash drawer sessions.
			cashH.Mount(r)

			// Tip pools.
			tipPoolsH.Mount(r)

			// Table sessions.
			tablesH.Mount(r)

			// Void / adjustment entries.
			adjustmentsH.Mount(r)

			// Promotions engine.
			promoH.Mount(r)

			// Ancillary commerce features.
			giftcardsH.Mount(r)
			storecreditH.Mount(r)
			houseaccountsH.Mount(r)

			// Inventory, waste, payroll, reservations, delivery zones, fiscal.
			inventoryH.Mount(r)
			wasteH.Mount(r)
			payrollH.Mount(r)
			reservationsH.Mount(r)
			deliveryZonesH.Mount(r)
			fiscalH.Mount(r)

			// Bank accounts + payouts (optional — disabled when encryption key
			// is absent; see startup log).
			if bankaccountsH != nil {
				bankaccountsH.Mount(r)
			}

			// BYO payment-provider credentials per location (/payment-credentials/*).
			// Disabled when PAYMENT_KEY_ENCRYPTION_SECRET is unset.
			if paymentCredsH != nil {
				paymentCredsH.Mount(r)
			}
		})
	})

	// Background jobs: weekly payout runner + transfer reconciliation cron +
	// recipe-cost recompute on ingredient price changes.
	go payoutRunner.Start(ctx)
	go transferReconciler.Start(ctx)
	go recipeCostRunner.Start(ctx)
	go kdsFanoutRunner.Start(ctx)
	go auditRetentionRunner.Start(ctx)

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
