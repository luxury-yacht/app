/*
 * backend/resources/job/identity.go
 *
 * Job's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package job

// Identity is the Job built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "batch",
	Version:    "v1",
	Kind:       "Job",
	Resource:   "jobs",
	Namespaced: true,
}
