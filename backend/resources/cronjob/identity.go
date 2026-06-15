/*
 * backend/resources/cronjob/identity.go
 *
 * CronJob's built-in resource identity, owned by the kind's package.
 * Plain struct (no resourcecontract import) so resourcecontract can aggregate it.
 */

package cronjob

// Identity is the CronJob built-in resource identity.
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "batch",
	Version:    "v1",
	Kind:       "CronJob",
	Resource:   "cronjobs",
	Namespaced: true,
}
