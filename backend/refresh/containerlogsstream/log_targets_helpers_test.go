package containerlogsstream

import "github.com/luxury-yacht/app/backend/kind/kindregistry"

// testLogTargets is the kind registry's container-log target table, the one
// production injects (refresh/system/streams.go).
var testLogTargets = kindregistry.MustLogTargets()
