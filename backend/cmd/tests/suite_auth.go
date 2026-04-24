package main

import "fmt"

// Exercises the full email/password auth flow: signup → me → refresh → refresh
// rotation (old refresh should be invalid) → signout. Leaves the runner with a
// valid access token + user id the other suites use.

type sessionResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	User         struct {
		ID            string `json:"id"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
	} `json:"user"`
}

func suiteAuth(r *Runner) {
	email := randomEmail()
	password := "testpassword123!"

	// --- signup ---
	resp := r.POST("/auth/signup", map[string]any{"email": email, "password": password})
	r.CheckStatus(resp.status, 201, "signup 201")

	var s sessionResp
	if err := resp.JSON(&s); err != nil {
		r.fail(fmt.Sprintf("signup body not json: %v (%s)", err, resp.String()))
		return
	}
	r.Check(s.AccessToken != "", "signup returned access_token")
	r.Check(s.RefreshToken != "", "signup returned refresh_token")
	r.CheckEq(s.TokenType, "Bearer", "signup token type")
	r.Check(s.User.ID != "", "signup returned user id")
	r.CheckEq(s.User.Email, email, "signup echoes email")

	r.token = s.AccessToken
	r.refresh = s.RefreshToken
	r.userID = s.User.ID
	r.userEmail = email
	r.userPass = password

	// Duplicate signup → 409
	resp = r.POST("/auth/signup", map[string]any{"email": email, "password": password})
	r.CheckStatus(resp.status, 409, "duplicate signup 409")

	// --- me ---
	resp = r.GET("/auth/me", withBearer(r.token))
	r.CheckStatus(resp.status, 200, "me 200")
	var me map[string]any
	_ = resp.JSON(&me)
	r.CheckEq(me["email"], email, "me email")

	// --- signin with correct creds ---
	resp = r.POST("/auth/signin", map[string]any{"email": email, "password": password})
	r.CheckStatus(resp.status, 200, "signin 200")
	var s2 sessionResp
	_ = resp.JSON(&s2)
	r.Check(s2.AccessToken != "", "signin returned access_token")

	// Wrong password → 401
	resp = r.POST("/auth/signin", map[string]any{"email": email, "password": "wrong"})
	r.CheckStatus(resp.status, 401, "signin wrong password 401")

	// --- refresh rotation ---
	resp = r.POST("/auth/refresh", map[string]any{"refresh_token": r.refresh})
	r.CheckStatus(resp.status, 200, "refresh 200")
	var s3 sessionResp
	_ = resp.JSON(&s3)
	r.Check(s3.RefreshToken != "" && s3.RefreshToken != r.refresh, "refresh returns a new refresh token")
	oldRefresh := r.refresh
	r.refresh = s3.RefreshToken
	r.token = s3.AccessToken

	// Old refresh must now fail (rotation revoked it).
	resp = r.POST("/auth/refresh", map[string]any{"refresh_token": oldRefresh})
	r.CheckStatus(resp.status, 401, "old refresh revoked after rotation")

	// --- signout ---
	resp = r.POST("/auth/signout", map[string]any{"refresh_token": r.refresh})
	r.CheckStatus(resp.status, 204, "signout 204")

	// Post-signout refresh should fail.
	resp = r.POST("/auth/refresh", map[string]any{"refresh_token": r.refresh})
	r.CheckStatus(resp.status, 401, "refresh after signout 401")

	// Re-signin so downstream suites have a usable session.
	resp = r.POST("/auth/signin", map[string]any{"email": email, "password": password})
	_ = resp.JSON(&s)
	r.token = s.AccessToken
	r.refresh = s.RefreshToken
}
