//go:build production

package sentryreporting

// BuildEnabled reports whether the current Wails build may initialize Sentry.
func BuildEnabled() bool {
	return true
}
