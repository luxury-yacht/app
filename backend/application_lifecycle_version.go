package backend

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// CheckBetaExpiry checks if this is a beta build and if it has expired
// Returns an error if the beta has expired
func (a *ApplicationLifecycle) checkBetaExpiry() error {
	// Skip check for non-beta builds
	if IsBetaBuild != "true" || BetaExpiry == "" {
		return nil
	}

	// Skip check in dev mode
	if Version == "dev" {
		return nil
	}

	// Parse expiry date
	expiryTime, err := time.Parse(time.RFC3339, BetaExpiry)
	if err != nil {
		return fmt.Errorf("invalid beta expiry date format: %w", err)
	}

	// Check if expired
	if time.Now().After(expiryTime) {
		daysAgo := int(time.Since(expiryTime).Hours() / 24)
		return fmt.Errorf("this beta version expired %d days ago (on %s). Please download the latest version",
			daysAgo, expiryTime.Format("January 2, 2006"))
	}

	// Calculate days until expiry for logging
	daysLeft := int(time.Until(expiryTime).Hours() / 24)
	if daysLeft <= 7 && a != nil && a.logger != nil {
		// Warning if expiring soon
		message := fmt.Sprintf("Beta build expires in %d day(s) on %s", daysLeft, expiryTime.Format("January 2, 2006"))
		a.logger.Warn(message, logsources.App)
	}

	return nil
}
