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
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/ai"
	"github.com/beepbite/backend/internal/apiauth"
	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/chatbot"
	"github.com/beepbite/backend/internal/config"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/email"
	"github.com/beepbite/backend/internal/handlers/adjustments"
	"github.com/beepbite/backend/internal/handlers/admin"
	"github.com/beepbite/backend/internal/handlers/aifloor"
	"github.com/beepbite/backend/internal/handlers/apikeys"
	"github.com/beepbite/backend/internal/handlers/auditviewer"
	"github.com/beepbite/backend/internal/handlers/cashdrawer"
	"github.com/beepbite/backend/internal/handlers/cashout"
	"github.com/beepbite/backend/internal/handlers/category86"
	"github.com/beepbite/backend/internal/handlers/customdomains"
	"github.com/beepbite/backend/internal/handlers/customerchat"
	"github.com/beepbite/backend/internal/handlers/customersearch"
	"github.com/beepbite/backend/internal/handlers/data"
	"github.com/beepbite/backend/internal/handlers/datarights"
	"github.com/beepbite/backend/internal/handlers/deliveryzones"
	"github.com/beepbite/backend/internal/handlers/driver"
	"github.com/beepbite/backend/internal/handlers/driverinvite"
	"github.com/beepbite/backend/internal/handlers/dualdrawer"
	"github.com/beepbite/backend/internal/handlers/favorites"
	"github.com/beepbite/backend/internal/handlers/fiscal"
	"github.com/beepbite/backend/internal/handlers/geocode"
	"github.com/beepbite/backend/internal/handlers/giftcards"
	"github.com/beepbite/backend/internal/handlers/hardware"
	"github.com/beepbite/backend/internal/handlers/houseaccounts"
	"github.com/beepbite/backend/internal/handlers/imageupload"
	"github.com/beepbite/backend/internal/handlers/inventory"
	"github.com/beepbite/backend/internal/handlers/invoicing"
	"github.com/beepbite/backend/internal/handlers/kds"
	"github.com/beepbite/backend/internal/handlers/legal"
	"github.com/beepbite/backend/internal/handlers/loyaltystamps"
	"github.com/beepbite/backend/internal/handlers/marketplace"
	"github.com/beepbite/backend/internal/handlers/memberinvite"
	"github.com/beepbite/backend/internal/handlers/onboarding"
	"github.com/beepbite/backend/internal/handlers/ownerassistant"
	"github.com/beepbite/backend/internal/handlers/payroll"
	"github.com/beepbite/backend/internal/handlers/pickupslots"
	"github.com/beepbite/backend/internal/handlers/pos"
	"github.com/beepbite/backend/internal/handlers/promotions"
	"github.com/beepbite/backend/internal/handlers/quickcoupon"
	"github.com/beepbite/backend/internal/handlers/receiptdelivery"
	"github.com/beepbite/backend/internal/handlers/receipts"
	"github.com/beepbite/backend/internal/handlers/reorder"
	"github.com/beepbite/backend/internal/handlers/reservations"
	"github.com/beepbite/backend/internal/handlers/reviews"
	"github.com/beepbite/backend/internal/handlers/specials"
	"github.com/beepbite/backend/internal/handlers/stats"
	"github.com/beepbite/backend/internal/handlers/storecredit"
	"github.com/beepbite/backend/internal/handlers/tables"
	"github.com/beepbite/backend/internal/handlers/tabs"
	"github.com/beepbite/backend/internal/handlers/timeclock"
	"github.com/beepbite/backend/internal/handlers/tippools"
	"github.com/beepbite/backend/internal/handlers/tracking"
	"github.com/beepbite/backend/internal/handlers/twofa"
	"github.com/beepbite/backend/internal/handlers/userprefs"
	"github.com/beepbite/backend/internal/handlers/waittime"
	"github.com/beepbite/backend/internal/handlers/wanumbers"
	"github.com/beepbite/backend/internal/handlers/waste"
	"github.com/beepbite/backend/internal/handlers/webhooksub"
	"github.com/beepbite/backend/internal/handlers/whatsapplink"
	"github.com/beepbite/backend/internal/handlers/whatsappsend"
	"github.com/beepbite/backend/internal/handlers/whatsappwebhook"
	"github.com/beepbite/backend/internal/integrations/mapbox"
	"github.com/beepbite/backend/internal/integrations/whatsapp"
	"github.com/beepbite/backend/internal/jobs/activityalerts"
	"github.com/beepbite/backend/internal/jobs/auditretention"
	"github.com/beepbite/backend/internal/jobs/eodemail"
	"github.com/beepbite/backend/internal/jobs/kdsfanout"
	"github.com/beepbite/backend/internal/jobs/llmsync"
	"github.com/beepbite/backend/internal/jobs/recipecost"
	"github.com/beepbite/backend/internal/jobs/softdelete"
	"github.com/beepbite/backend/internal/llm"
	"github.com/beepbite/backend/internal/middleware/hostresolve"
	"github.com/beepbite/backend/internal/obs"
	"github.com/beepbite/backend/internal/ratelimit"
	"github.com/beepbite/backend/internal/staffauth"
	"github.com/beepbite/backend/internal/webhookdelivery"
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
	authH := auth.NewHandler(svc)
	// Wire driver-invite auto-accept on signup (Wave 16): when a new user signs
	// up with an email that has a pending driver invite, grant the membership.
	// The post-signup hook is composed below (after emailRegistry is built) so
	// it can also send a welcome email — see authH.WithPool(...) further down.

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
	statsH := stats.NewHandler(database.Pool)
	// Wave 24 — easy wins
	receiptsH := receipts.NewHandler(database.Pool)
	reorderH := reorder.NewHandler(database.Pool)
	customerSearchH := customersearch.NewHandler(database.Pool)
	cashoutH := cashout.NewHandler(database.Pool)
	loyaltyStampsH := loyaltystamps.NewHandler(database.Pool)
	pickupSlotsH := pickupslots.NewHandler(database.Pool)
	// Wave 22 — public API + scoped keys + tenant webhooks
	apiKeysH := apikeys.NewHandler(database.Pool)
	webhookSubH := webhooksub.NewHandler(database.Pool)
	apiRateLimiter := ratelimit.New(1000, 3000) // 1000 req/min, burst 3000, per key
	// Wave 32 — easy wins extended
	tabsH := tabs.NewHandler(database.Pool)
	specialsH := specials.NewHandler(database.Pool)
	waitTimeH := waittime.NewHandler(database.Pool)
	category86H := category86.NewHandler(database.Pool)
	dualDrawerH := dualdrawer.NewHandler(database.Pool)
	quickCouponH := quickcoupon.NewHandler(database.Pool)
	favoritesH := favorites.NewHandler(database.Pool)
	// Waves 10/26/28
	adminH := admin.NewHandler(database.Pool)
	reviewsH := reviews.NewHandler(database.Pool)
	driverH := driver.NewHandler(database.Pool)
	driverInviteH := driverinvite.NewHandler(database.Pool)
	memberInviteH := memberinvite.NewHandler(database.Pool)
	trackingH := tracking.NewHandler(database.Pool)
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

	aiSvc := ai.New(database.Pool, cfg.GeminiAPIKey)
	aiFloorH := aifloor.NewHandler(aiSvc) // AI floor-plan generator

	wa := whatsapp.NewClient(cfg.WhatsAppAccessToken, cfg.WhatsAppPhoneNumberID)
	waSendH := whatsappsend.NewHandler(wa)

	// Remaining-roadmap waves (17/20/21/13/15/19/27/29/30/31/35/28/37/39/40 + T7.6).
	llmRouter := llm.NewRouter(database.Pool)
	emailRegistry, emailErr := email.NewDBRegistryFromEnv(database.Pool)
	if emailErr != nil {
		log.Printf("email registry unavailable: %v (transactional email disabled until a provider is configured)", emailErr)
		emailRegistry = nil
	}

	// Best-effort transactional email: render a branded template + send via the
	// configured provider. No-ops cleanly when no provider is configured (e.g.
	// before SMTP_HOST is set), and never blocks the triggering action.
	emailNotify := func(to, tmpl string, data map[string]any) {
		if emailRegistry == nil || to == "" {
			return
		}
		msg, err := email.Render(tmpl, data)
		if err != nil {
			log.Printf("email render %s: %v", tmpl, err)
			return
		}
		msg.To = to
		// Let the configured provider decide the From (its verified sender, e.g.
		// the EMAIL_FROM_DEFAULT / provider verified domain) instead of forcing the
		// template's default, which may be on an unverified domain.
		msg.From = ""
		prov, _, perr := emailRegistry.For(context.Background(), "")
		if perr != nil || prov == nil {
			log.Printf("email %s skipped: no provider configured (%v)", tmpl, perr)
			return
		}
		if serr := prov.Send(context.Background(), msg); serr != nil {
			log.Printf("email send %s to %s FAILED: %v", tmpl, to, serr)
		} else {
			log.Printf("email send %s to %s: OK", tmpl, to)
		}
	}
	driverInviteH.Notifier = func(toEmail, _ /*role*/, _ /*orgID*/ string) {
		emailNotify(toEmail, "driver_invite", map[string]any{"inviteURL": "/signup"})
	}
	memberInviteH.Notifier = func(toEmail, role, _ /*orgID*/ string) {
		emailNotify(toEmail, "member_invite", map[string]any{"role": role, "inviteURL": "/signup"})
	}
	// Wire transactional email into the auth flows (verify-email + password-reset).
	authH.EmailNotifier = emailNotify
	// Compose the post-signup hook: auto-accept matching driver + member invites,
	// then send a welcome email. Every step is best-effort and must not fail signup.
	authH.WithPool(database.Pool, func(ctx context.Context, pool *pgxpool.Pool, profileID, userEmail string) error {
		if err := driverinvite.AcceptMatchingInvites(ctx, pool, profileID, userEmail); err != nil {
			log.Printf("warn: driverinvite.AcceptMatchingInvites: %v", err)
		}
		if err := memberinvite.AcceptMatchingInvites(ctx, pool, profileID, userEmail); err != nil {
			log.Printf("warn: memberinvite.AcceptMatchingInvites: %v", err)
		}
		emailNotify(userEmail, "welcome", map[string]any{"name": userEmail})
		return nil
	})
	obsLogger := obs.NewLogger()
	obsReg := obs.NewRegistry()
	hostResolver := hostresolve.NewResolver(database.Pool)
	whatsappLinkH := whatsapplink.NewHandler(database.Pool)
	customerChatH := customerchat.NewHandler(database.Pool, llmRouter)
	ownerAssistantH := ownerassistant.NewHandler(database.Pool, llmRouter, aiSvc)
	customDomainsH := customdomains.NewHandler(database.Pool, &customdomains.StubFlyCerts{})
	hardwareH := hardware.NewHandler(database.Pool)
	dataRightsH := datarights.NewHandler(database.Pool)
	userPrefsH := userprefs.NewHandler(database.Pool)
	onboardingH := onboarding.NewHandler(database.Pool)
	waNumbersH := wanumbers.NewHandler(database.Pool)
	twofaH := twofa.NewHandler(database.Pool)
	auditViewerH := auditviewer.NewHandler(database.Pool)
	imageUploadH := imageupload.NewHandler(nil) // nil → StubStorer until R2 env is set
	timeClockH := timeclock.NewHandler(database.Pool)
	legalH := legal.NewHandler(database.Pool)
	invoicingH := invoicing.NewHandlerFromEnv(database.Pool)
	var receiptDeliveryH *receiptdelivery.Handler
	if emailRegistry != nil {
		receiptDeliveryH = receiptdelivery.NewHandler(database.Pool, emailRegistry, wa)
	}

	var mbClient *mapbox.Client
	mapboxToken := os.Getenv("MAPBOX_TOKEN")
	if mapboxToken == "" {
		log.Println("WARNING: MAPBOX_TOKEN not set — chatbot geocoding will fall back to stub behaviour (users must share location instead of typing an address)")
	} else {
		mbClient = mapbox.NewClient(mapbox.Config{APIKey: mapboxToken})
	}
	chatSvc := chatbot.NewWithMapbox(database.Pool, wa, mbClient)
	waWebhookH := whatsappwebhook.NewHandler(chatSvc, cfg.WhatsAppVerifyToken, cfg.WhatsAppAppSecret)

	// Payments: BeepBite records tenders, it does not process cards. The
	// PaymentProvider seam (internal/payments) has exactly one implementation,
	// manual tender, and the POS store drives it inside the charge transaction.
	// There is no gateway to configure, no webhook to receive and no key to hold.

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

	// Wave 25 — observability: structured request log + request-id + metrics.
	r.Use(obs.Middleware(obsLogger, obsReg))
	// Wave 23 / T7.6 — resolve Host header (custom domain or *.beepbite.io slug)
	// to a location_id in context; reserved subdomains pass through.
	r.Use(hostresolve.Middleware(hostResolver))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "env": cfg.Env})
	})
	r.Handle("/metrics", obsReg.Handler()) // Prometheus scrape

	// The marketing/docs site is optional. A build without it simply does not
	// register the route rather than failing to start — the API is the
	// product, the site is a convenience.
	if site := newSiteHandler(); site != nil {
		r.Handle("/site/*", http.StripPrefix("/site/", site))
	} else {
		log.Printf("beepbite: no site/ directory found; /site/ not served")
	}

	r.Route("/auth", func(r chi.Router) {
		authH.Mount(r)
		staffAuthH.Mount(r)
	})

	// Webhooks are unauthenticated — verified by HMAC or token per provider.
	r.Mount("/webhooks/whatsapp", waWebhookH)
	// Public marketplace store directory (no auth required).
	// RLS is enforced at the DB layer via MarketplaceScope (is_marketplace_visible=true only).
	r.Route("/stores", func(r chi.Router) {
		marketplaceH.Mount(r)
		reviewsH.MountPublic(r) // GET /stores/{slug}/reviews (public)
	})

	// Public: WhatsApp link-token lookup (Wave 17) + legal documents (Wave 42).
	r.Get("/link-whatsapp/{token}", whatsappLinkH.GetPhone)
	r.Route("/legal", legalH.MountPublic) // GET /legal/{kind}/current

	// Platform-admin tool (JWT + is_platform_admin gate; cross-org).
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(svc))
		r.Use(admin.RequirePlatformAdmin(database.Pool))
		adminH.Mount(r)     // /admin/*
		waNumbersH.Mount(r) // /admin/wa-numbers/* (Wave 37)
	})

	// Public customer live-tracking (no auth — the order_tracking_token is the
	// access key; the SQL gate + pings_visible_to_customer enforce privacy).
	trackingH.Mount(r)

	// Public address autocomplete (Mapbox proxy, SA-biased; token stays
	// server-side; graceful empty result when MAPBOX_TOKEN is unset).
	geocode.NewHandler(mbClient).Mount(r)

	// Wave 22 — external public API, authenticated by scoped API keys
	// (Authorization: Bearer bb_live_…) + per-key rate limiting. Reuses the same
	// data layer as the JWT app (no parallel handlers): /api/v1/data/{table}.
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(apiauth.RequireAPIKey(database.Pool))
		r.Use(apiRateLimiter.Middleware(func(req *http.Request) string {
			return apiauth.APIKeyIDFromContext(req.Context())
		}))
		dataH.MountWithIdempotency(r, database.Pool)
	})

	// Authenticated app surface — JWT required for all sub-groups below.
	r.Group(func(r chi.Router) {
		r.Use(auth.Middleware(svc))

		// Routes that require a valid JWT but NOT org-scope resolution.
		// (Staff manager endpoints act on cross-org data; AI/chatbot helpers
		// are internal tooling that doesn't operate on per-location records.)
		staffAuthH.MountManagerRoutes(r)
		staffAuthH.MountPinVerify(r)
		r.Post("/chatbot/whatsapp/send", waSendH)

		// JWT-only (user-scoped, no org membership required).
		r.Post("/link-whatsapp/{token}", whatsappLinkH.Bind) // Wave 17 bind a number
		r.Get("/link-whatsapp", whatsappLinkH.ListLinks)
		customerChatH.Mount(r)        // POST /chat (Wave 20 customer assistant)
		r.Route("/2fa", twofaH.Mount) // Wave 39 TOTP enroll/verify/disable
		userPrefsH.Mount(r)           // GET/PUT /me/preferences (Wave 35)
		legalH.MountAuthed(r)         // POST /legal/accept (Wave 42)

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

			// Driver portal (assignments/shifts/pings) + driver invites.
			r.Route("/driver", driverH.Mount)
			driverInviteH.Mount(r)
			memberInviteH.Mount(r) // /member-invites/* + /members/* (Team management)

			// Wave 24 — easy wins.
			posH.MountModify(r)      // PATCH /pos/orders/{id}/items (modify before fire)
			receiptsH.Mount(r)       // GET /orders/{id}/receipt (reprint)
			reorderH.Mount(r)        // GET /customers/{id}/recent-orders
			customerSearchH.Mount(r) // GET /customers/search
			cashoutH.Mount(r)        // GET /cash-out/{session_id}
			loyaltyStampsH.Mount(r)  // /loyalty/stamps/* + /customers/{id}/stamps
			pickupSlotsH.Mount(r)    // GET /locations/{id}/pickup-slots (org-scoped; public customer variant TODO)
			// Wave 22 — API key + webhook management (dashboard, JWT-authed).
			apiKeysH.Mount(r)    // /api-keys
			webhookSubH.Mount(r) // /webhook-endpoints
			// Wave 32 — easy wins extended.
			posH.MountHold(r)                          // /pos/orders/{id}/hold|release, /pos/orders/held
			tabsH.Mount(r)                             // /tabs
			specialsH.Mount(r)                         // /specials, /items/{id}/special
			waitTimeH.Mount(r)                         // /locations/{id}/wait-time
			category86H.Mount(r)                       // /categories/{id}/eighty-six
			r.Route("/dual-drawer", dualDrawerH.Mount) // /dual-drawer/sessions, /open
			// Wave 28 (org-scoped).
			r.Route("/reviews", reviewsH.MountAuthed) // POST /reviews, POST /reviews/{id}/reply
			quickCouponH.Mount(r)                     // /quick-coupons
			favoritesH.Mount(r)                       // /customers/{id}/favorites
			r.Route("/stats", statsH.Mount)

			// Remaining-roadmap org-scoped surfaces.
			r.Post("/ai/floor", aiFloorH)                 // AI floor-plan generator (org-scoped: writes sections/tables under RLS)
			ownerAssistantH.Mount(r)                      // /assistant (+/draft/{id}) — Wave 21
			r.Route("/domains", customDomainsH.Mount)     // Wave 23 custom domains
			r.Route("/hardware", hardwareH.Mount)         // Wave 29 printers
			dataRightsH.Mount(r)                          // Wave 31 account-delete/export/forget
			onboardingH.Mount(r)                          // Wave 28 onboarding progress
			r.Route("/manager/audit", auditViewerH.Mount) // Wave 39 tenant audit viewer
			r.Route("/invoicing", invoicingH.Mount)       // Wave 34 invoicing (canonical schema)
			imageUploadH.Mount(r)                         // Wave 40 image upload
			timeClockH.Mount(r)                           // Wave 40 time-clock
			if receiptDeliveryH != nil {
				receiptDeliveryH.Mount(r) // Wave 27 receipt PDF/email/WhatsApp
			}

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

		})
	})

	// Background jobs: recipe-cost recompute on ingredient price changes, KDS
	// fanout, audit retention.
	go recipeCostRunner.Start(ctx)
	go kdsFanoutRunner.Start(ctx)
	go auditRetentionRunner.Start(ctx)
	go llmsync.NewRunner(database.Pool).Start(ctx)
	go webhookdelivery.NewRunner(database.Pool).Start(ctx) // Wave 22 — outbound webhook delivery
	go softdelete.NewRunner(database.Pool).Start(ctx)      // Wave 31 — GDPR purge of soft-deleted orgs
	if emailRegistry != nil {
		go eodemail.NewRunner(database.Pool, emailRegistry).Start(ctx)       // Wave 40 — end-of-day owner email
		go activityalerts.NewRunner(database.Pool, emailRegistry).Start(ctx) // Wave 30 — suspicious-activity alerts
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		// WriteTimeout is intentionally omitted: this server has long-lived SSE
		// streams (kds, orderstream, cfd, etc.) and a WriteTimeout would kill
		// them mid-stream. SlowLoris protection for the write path is handled
		// by ReadHeaderTimeout + ReadTimeout upstream.
		IdleTimeout: 120 * time.Second,
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

func notImplemented(msg string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}
}
