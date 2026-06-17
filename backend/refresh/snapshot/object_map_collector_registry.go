package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmapnode"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/clusterrole"
	"github.com/luxury-yacht/app/backend/resources/clusterrolebinding"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/resources/poddisruptionbudget"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	"github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
)

// objectMapCollectors is the register-once aggregator for object-map kinds read
// from the shared informer cache. Each kind declares how it is listed and
// projected in its own package; the collector loop never names a kind. Order
// mirrors the historical collection order. HorizontalPodAutoscaler (no v2
// informer) and the Gateway-API kinds (live client) are collected bespoke.
var objectMapCollectors = []objectmapnode.Collector{
	pods.ObjectMapNode,
	service.ObjectMapNode,
	endpointslice.ObjectMapNode,
	persistentvolumeclaim.ObjectMapNode,
	persistentvolume.ObjectMapNode,
	storageclass.ObjectMapNode,
	configmap.ObjectMapNode,
	secret.ObjectMapNode,
	serviceaccount.ObjectMapNode,
	nodes.ObjectMapNode,
	deployment.ObjectMapNode,
	replicaset.ObjectMapNode,
	statefulset.ObjectMapNode,
	daemonset.ObjectMapNode,
	job.ObjectMapNode,
	cronjob.ObjectMapNode,
	poddisruptionbudget.ObjectMapNode,
	networkpolicy.ObjectMapNode,
	ingress.ObjectMapNode,
	ingressclass.ObjectMapNode,
	clusterrole.ObjectMapNode,
	clusterrolebinding.ObjectMapNode,
}

// objectMapGatewayCollectors is the register-once aggregator for the Gateway-API
// kinds, listed via the Gateway client and gated by the cluster's Gateway-API
// presence. Order mirrors the historical collection order.
var objectMapGatewayCollectors = []objectmapnode.GatewayCollector{
	gatewayclass.ObjectMapNode,
	gatewaypkg.ObjectMapNode,
	httproute.ObjectMapNode,
	grpcroute.ObjectMapNode,
	tlsroute.ObjectMapNode,
	listenerset.ObjectMapNode,
	referencegrant.ObjectMapNode,
	backendtlspolicy.ObjectMapNode,
}
