/*
 * backend/resources/helm/helm.go
 *
 * Helm service wiring.
 * - Holds Helm dependencies and action configuration helpers.
 */

package helm

import (
	"github.com/luxury-yacht/app/backend/resources/common"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

type Dependencies struct {
	Common common.Dependencies
	// ActionConfigFactory allows callers (primarily tests) to supply a pre-wired Helm action configuration.
	ActionConfigFactory func(settings *cli.EnvSettings, namespace string) (*action.Configuration, error)
}

type Service struct {
	deps Dependencies
}

func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}
