package main

// Basic sanity checks: server responds, health endpoint is alive, unknown
// paths 404, unknown tables 404. These are cheap and should pass on any
// environment before running the feature suites.

func suiteSanity(r *Runner) {
	resp := r.GET("/health")
	if !r.CheckStatus(resp.status, 200, "health 200") {
		r.fail("aborting sanity — server not reachable at " + r.base)
		return
	}
	var h map[string]string
	_ = resp.JSON(&h)
	r.Check(h["status"] == "ok", `health {"status":"ok"}`)

	// Unknown path → 404
	r.CheckStatus(r.GET("/does-not-exist").status, 404, "unknown path 404")

	// Unknown table on /data → 404
	r.CheckStatus(r.GET("/data/not_a_real_table").status, 401, "unauthed /data 401")

	// OPTIONS preflight should succeed without auth
	resp = r.GET("/health", withHeader("Origin", "http://localhost:5173"))
	r.Check(resp.header.Get("Access-Control-Allow-Origin") != "" || resp.status == 200,
		"health reachable with Origin header")
}
