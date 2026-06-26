package backend

import "net/http"

// withStreamCORS applies CORS headers to every response from a stream
// endpoint — including error responses written before a handler reaches its
// own header setup. Without this, the browser blocks the failed response and
// reports an opaque CORS error instead of the real status and body.
//
// Echo concrete origins for the Wails webview, fall back to `*`, and only send
// credentials for concrete origins.
func withStreamCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		if origin != "*" {
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Last-Event-ID")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
