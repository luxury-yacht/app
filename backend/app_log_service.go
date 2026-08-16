package backend

// AppLogService owns the logger and its retained sequence buffer.
type AppLogService struct {
	logger *Logger
}

func NewAppLogService(logger *Logger) *AppLogService { return &AppLogService{logger: logger} }

func (s *AppLogService) Logger() *Logger {
	if s == nil {
		return nil
	}
	return s.logger
}
