package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// objectMapLinkEdgeBuilders is the register-once aggregator for kinds whose
// relationship edges are resource-link edges declared in their own package. The
// edge resolver dispatches a record to its kind's builder by Kind; no per-kind
// edge logic lives in object_map.go for these kinds.
var objectMapLinkEdgeBuilders = map[string]func(clusterID string, obj metav1.Object) []objectmapspec.LinkEdge{
	"HorizontalPodAutoscaler": hpapkg.ObjectMapEdges,
	"ClusterRoleBinding":      clusterrolebinding.ObjectMapEdges,
	"GatewayClass":            gatewayclass.ObjectMapEdges,
	"Gateway":                 gatewaypkg.ObjectMapEdges,
	"HTTPRoute":               httproute.ObjectMapEdges,
	"GRPCRoute":               grpcroute.ObjectMapEdges,
	"TLSRoute":                tlsroute.ObjectMapEdges,
	"ListenerSet":             listenerset.ObjectMapEdges,
	"ReferenceGrant":          referencegrant.ObjectMapEdges,
	"BackendTLSPolicy":        backendtlspolicy.ObjectMapEdges,
}
