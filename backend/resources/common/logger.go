/*
 * backend/resources/common/logger.go
 *
 * Logger interface alias for resource handlers.
 * - Re-exports the canonical internal/applog.Logger contract.
 */

package common

import "github.com/luxury-yacht/app/backend/internal/applog"

// Logger is the shared application-log contract, defined canonically in
// internal/applog. It is aliased here so resource handlers keep a local name
// while the interface lives in exactly one place. Resource services consume it
// via Dependencies.Logger.
type Logger = applog.Logger
