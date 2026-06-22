package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// configQuerypageSchema derives the querypage Schema for the config table from the
// existing typed-table adapter, via the shared generic schema builder. It REUSES the
// adapter's exact comparable sort-value encoder and row key, so the querypage engine
// orders rows byte-identically to the live typed-table executor — the precondition
// for an invisible cutover.
func configQuerypageSchema() querypage.Schema[ConfigSummary] {
	return querypageSchemaFromAdapter(configTableQueryAdapter(), []string{"name", "kind", "namespace", "data", "age"})
}
