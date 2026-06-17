package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapspec"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// objectMapEdgeBuilders is the register-once aggregator for kinds whose
// relationship edges are declared in their own package. The edge resolver
// dispatches a record to its kind's builder by Kind; no per-kind edge logic lives
// in object_map.go for these kinds. (Pod and workload templates — the pod-spec
// walkers — are not yet here.)
var objectMapEdgeBuilders = map[string]func(clusterID string, obj metav1.Object) []objectmapspec.Edge{
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
	"PersistentVolumeClaim":   persistentvolumeclaim.ObjectMapEdges,
	"PersistentVolume":        persistentvolume.ObjectMapEdges,
	"Ingress":                 ingress.ObjectMapEdges,
	"ClusterRole":             clusterrole.ObjectMapEdges,
	"Service":                 service.ObjectMapEdges,
	"PodDisruptionBudget":     poddisruptionbudget.ObjectMapEdges,
	"NetworkPolicy":           networkpolicy.ObjectMapEdges,
	"EndpointSlice":           endpointslice.ObjectMapEdges,
}
