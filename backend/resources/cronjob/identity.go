/*
 * backend/resources/cronjob/identity.go
 *
 * CronJob's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package cronjob

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the CronJob built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "batch",
	Version:    "v1",
	Kind:       "CronJob",
	Resource:   "cronjobs",
	Namespaced: true,
}
