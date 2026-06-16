/*
 * backend/resources/job/identity.go
 *
 * Job's built-in resource identity, owned by the kind's package.
 * Declared with the shared resourcekind.Identity type (no resourcecontract import) so resourcecontract can aggregate it.
 */

package job

import "github.com/luxury-yacht/app/backend/resourcekind"

// Identity is the Job built-in resource identity.
var Identity = resourcekind.Identity{
	Group:      "batch",
	Version:    "v1",
	Kind:       "Job",
	Resource:   "jobs",
	Namespaced: true,
}
