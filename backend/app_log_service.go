package backend

import "github.com/luxury-yacht/app/internal/sentry"

// appLogsMaxEntries is how many entries Application Logs keep. It is fixed, not
// the Logs tabs' Buffer size: troubleshooting the app can need more history than
// a pod's logs. The panel caps its rows to the same number.
const appLogsMaxEntries = 10_000

// AppLogService owns the logger and its retained sequence buffer.
type AppLogService struct {
	logger *Logger
}

func NewAppLogService(logger *Logger) *AppLogService { return &AppLogService{logger: logger} }

// NewApplicationLogs builds the process's Application Logs store.
func NewApplicationLogs(reporters ...sentryreporting.Reporter) *AppLogService {
	return NewAppLogService(NewLogger(appLogsMaxEntries, reporters...))
}

func (s *AppLogService) Logger() *Logger {
	if s == nil {
		return nil
	}
	return s.logger
}
