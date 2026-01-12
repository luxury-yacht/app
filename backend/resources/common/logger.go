/*
 * backend/resources/common/logger.go
 *
 * Logger interface for resource handlers.
 * - Defines the logger methods used by services.
 */

package common

// Logger captures the logging operations needed by resource handlers.
type Logger interface {
	Debug(message string, source ...string)
	Info(message string, source ...string)
	Warn(message string, source ...string)
	Error(message string, source ...string)
}
