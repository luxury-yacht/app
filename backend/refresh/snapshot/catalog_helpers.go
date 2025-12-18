package snapshot

import (
	"github.com/luxury-yacht/app/backend/objectcatalog"
)

// CatalogQuerier captures the subset of catalog functionality required by snapshot builders.
type CatalogQuerier interface {
	Query(opts objectcatalog.QueryOptions) objectcatalog.QueryResult
}
