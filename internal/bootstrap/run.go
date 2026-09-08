package bootstrap

import (
	"io/fs"
	"time"

	"github.com/luxury-yacht/app/backend"
	"github.com/luxury-yacht/app/internal/sentry"
	"github.com/luxury-yacht/app/internal/updatetemp"
)

// Run performs process setup and starts the desktop application with its embedded assets.
func Run(assets fs.FS) {
	backend.MaybeRunExecWrapper()
	updateTempRoot, updateTempSetupError := updatetemp.ConfigureProcess()
	if updateTempSetupError != nil {
		println("Automatic update temp setup disabled:", updateTempSetupError.Error())
	}
	reporter, reporterErr := sentryreporting.NewStartupReporter(
		sentryreporting.BuildEnabled(),
		backend.SentryDSN,
		backend.Version,
	)
	if reporterErr != nil {
		println("Sentry error reporting disabled:", reporterErr.Error())
		reporter, _ = sentryreporting.New(sentryreporting.Config{})
	}
	defer func() { reporter.Shutdown(2 * time.Second) }()
	defer sentryreporting.ReportPanic(reporter)

	composition := newApplicationComposition(assets, reporter, compositionOptions{
		SingleInstance:       true,
		UpdateTempRoot:       updateTempRoot,
		UpdateTempSetupError: updateTempSetupError,
	})
	if err := backend.InitializeErrorReporting(composition.preferences, composition.reporting); err != nil {
		println("Sentry error reporting remains disabled:", err.Error())
	}
	if err := composition.application.Run(); err != nil {
		sentryreporting.ReportRunError(reporter, err)
		println("Error:", err.Error())
	}
}
