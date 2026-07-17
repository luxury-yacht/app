package genrefreshcontracts

import (
	"reflect"

	"github.com/luxury-yacht/app/backend/kind/objectmap"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/nodemaintenance"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

type typeSpec struct {
	name   string
	typeOf reflect.Type
}

type enumSpec struct {
	name       string
	typeOf     reflect.Type
	values     []string
	valuesName string
}

type aliasSpec struct {
	name   string
	target string
}

type domainSpec struct {
	domain        string
	payload       string
	frontendOwned bool
}

func typeOf[T any]() reflect.Type {
	return reflect.TypeOf((*T)(nil)).Elem()
}

var contractTypes = []typeSpec{
	{name: "RefreshPermissionDeniedDetails", typeOf: typeOf[refresh.PermissionDeniedDetails]()},
	{name: "RefreshPermissionDeniedStatus", typeOf: typeOf[refresh.PermissionDeniedStatus]()},
	{name: "SnapshotStats", typeOf: typeOf[refresh.SnapshotStats]()},
	{name: "ResourceRef", typeOf: typeOf[resourcemodel.ResourceRef]()},
	{name: "DisplayRef", typeOf: typeOf[resourcemodel.DisplayRef]()},
	{name: "ResourceLink", typeOf: typeOf[resourcemodel.ResourceLink]()},
	{name: "ResourceMetadata", typeOf: typeOf[resourcemodel.ResourceMetadata]()},
	{name: "ResourceStatusSignal", typeOf: typeOf[resourcemodel.ResourceStatusSignal]()},
	{name: "ResourceStatusBadge", typeOf: typeOf[resourcemodel.ResourceStatusBadge]()},
	{name: "ResourceLifecycle", typeOf: typeOf[resourcemodel.ResourceLifecycle]()},
	{name: "ResourceStatusPresentation", typeOf: typeOf[resourcemodel.ResourceStatusPresentation]()},
	{name: "ResourceModel", typeOf: typeOf[resourcemodel.ResourceModel]()},
	{name: "ConditionFacts", typeOf: typeOf[resourcemodel.ConditionFacts]()},
	{name: "NamespaceSummary", typeOf: typeOf[snapshot.NamespaceSummary]()},
	{name: "NamespaceSnapshotPayload", typeOf: typeOf[snapshot.NamespaceSnapshot]()},
	{name: "NodePodMetric", typeOf: typeOf[streamrows.NodePodMetric]()},
	{name: "DrainNodeOptionsPayload", typeOf: typeOf[restypes.DrainNodeOptions]()},
	{name: "NodeMaintenanceDrainEvent", typeOf: typeOf[nodemaintenance.DrainEvent]()},
	{name: "NodeMaintenanceDrainJob", typeOf: typeOf[nodemaintenance.DrainJob]()},
	{name: "NodeMaintenanceSnapshotPayload", typeOf: typeOf[nodemaintenance.Snapshot]()},
	{name: "ClusterNodeSnapshotEntry", typeOf: typeOf[streamrows.NodeSummary]()},
	{name: "NodeTaint", typeOf: typeOf[streamrows.NodeTaint]()},
	{name: "NodeMetricsInfo", typeOf: typeOf[snapshot.NodeMetricsInfo]()},
	{name: "ClusterNodeSnapshotPayload", typeOf: typeOf[snapshot.NodeSnapshot]()},
	{name: "ClusterOverviewMetrics", typeOf: typeOf[snapshot.ClusterOverviewMetrics]()},
	{name: "WorkloadTypeResourceUsage", typeOf: typeOf[snapshot.WorkloadTypeResourceUsage]()},
	{name: "WorkloadResourceUsage", typeOf: typeOf[snapshot.WorkloadResourceUsage]()},
	{name: "ClusterOverviewPayload", typeOf: typeOf[snapshot.ClusterOverviewPayload]()},
	{name: "RecentEventEntry", typeOf: typeOf[snapshot.RecentEvent]()},
	{name: "ClusterOverviewSnapshotPayload", typeOf: typeOf[snapshot.ClusterOverviewSnapshot]()},
	{name: "ClusterAttentionFinding", typeOf: typeOf[snapshot.AttentionFinding]()},
	{name: "AttentionCause", typeOf: typeOf[snapshot.AttentionCause]()},
	{name: "AttentionFindingTypeDefinition", typeOf: typeOf[snapshot.AttentionFindingTypeDefinition]()},
	{name: "AttentionObjectFindingIgnore", typeOf: typeOf[snapshot.AttentionObjectFindingIgnore]()},
	{name: "AttentionIgnoreRules", typeOf: typeOf[snapshot.AttentionIgnoreRules]()},
	{name: "AttentionSeverityCounts", typeOf: typeOf[snapshot.AttentionSeverityCounts]()},
	{name: "ClusterAttentionSnapshot", typeOf: typeOf[snapshot.ClusterAttentionSnapshot]()},
	{name: "ClusterRBACEntry", typeOf: typeOf[streamrows.ClusterRBACEntry]()},
	{name: "ClusterRBACSnapshotPayload", typeOf: typeOf[snapshot.ClusterRBACSnapshot]()},
	{name: "ClusterStorageEntry", typeOf: typeOf[streamrows.ClusterStorageEntry]()},
	{name: "ClusterStorageSnapshotPayload", typeOf: typeOf[snapshot.ClusterStorageSnapshot]()},
	{name: "ClusterConfigEntry", typeOf: typeOf[streamrows.ClusterConfigEntry]()},
	{name: "ClusterConfigSnapshotPayload", typeOf: typeOf[snapshot.ClusterConfigSnapshot]()},
	{name: "ClusterCRDEntry", typeOf: typeOf[streamrows.ClusterCRDEntry]()},
	{name: "ClusterCRDSnapshotPayload", typeOf: typeOf[snapshot.ClusterCRDSnapshot]()},
	{name: "ClusterCustomEntry", typeOf: typeOf[streamrows.ClusterCustomSummary]()},
	{name: "ClusterCustomSnapshotPayload", typeOf: typeOf[snapshot.ClusterCustomSnapshot]()},
	{name: "ClusterEventEntry", typeOf: typeOf[snapshot.ClusterEventEntry]()},
	{name: "ClusterEventsSnapshotPayload", typeOf: typeOf[snapshot.ClusterEventsSnapshot]()},
	{name: "KindInfo", typeOf: typeOf[objectcatalog.KindInfo]()},
	{name: "CatalogItem", typeOf: typeOf[objectcatalog.Summary]()},
	{name: "CatalogActionFacts", typeOf: typeOf[objectcatalog.ActionFacts]()},
	{name: "CatalogNamespaceGroup", typeOf: typeOf[snapshot.CatalogNamespaceGroup]()},
	{name: "CatalogSnapshotPayload", typeOf: typeOf[snapshot.CatalogSnapshot]()},
	{name: "ResourceQueryRequest", typeOf: typeOf[snapshot.ResourceQueryRequest]()},
	{name: "ResourceQueryPredicate", typeOf: typeOf[snapshot.ResourceQueryPredicate]()},
	{name: "ResourceQueryAnchor", typeOf: typeOf[snapshot.ResourceQueryAnchor]()},
	{name: "ResourceQueryAnchorResult", typeOf: typeOf[snapshot.ResourceQueryAnchorResult]()},
	{name: "ResourceQueryCapabilities", typeOf: typeOf[snapshot.ResourceQueryCapabilities]()},
	{name: "ResourceQueryFacetDescriptor", typeOf: typeOf[snapshot.ResourceQueryFacetDescriptor]()},
	{name: "ResourceQueryFacetOption", typeOf: typeOf[snapshot.ResourceQueryFacetOption]()},
	{name: "ResourceQueryFacetValues", typeOf: typeOf[snapshot.ResourceQueryFacetValues]()},
	{name: "ResourceQueryEnvelopeFields", typeOf: typeOf[snapshot.ResourceQueryEnvelope]()},
	{name: "ResourceQueryIssue", typeOf: typeOf[snapshot.ResourceQueryIssue]()},
	{name: "ResourceQueryDynamicRef", typeOf: typeOf[snapshot.ResourceQueryDynamicRef]()},
	{name: "PodSnapshotEntry", typeOf: typeOf[streamrows.PodSummary]()},
	{name: "PodMetricsInfo", typeOf: typeOf[snapshot.PodMetricsInfo]()},
	{name: "PodSnapshotPayload", typeOf: typeOf[snapshot.PodSnapshot]()},
	{name: "ObjectDetailsSnapshotPayload", typeOf: typeOf[snapshot.ObjectDetailsSnapshotPayload]()},
	{name: "ObjectEventSummary", typeOf: typeOf[snapshot.ObjectEventSummary]()},
	{name: "ObjectEventsSnapshotPayload", typeOf: typeOf[snapshot.ObjectEventsSnapshotPayload]()},
	{name: "ObjectMapReference", typeOf: typeOf[snapshot.ObjectMapReference]()},
	{name: "ObjectMapNode", typeOf: typeOf[snapshot.ObjectMapNode]()},
	{name: "ObjectMapActionFacts", typeOf: typeOf[objectmap.ActionFacts]()},
	{name: "ObjectMapStatus", typeOf: typeOf[snapshot.ObjectMapStatus]()},
	{name: "ObjectMapEdge", typeOf: typeOf[snapshot.ObjectMapEdge]()},
	{name: "ObjectMapSnapshotPayload", typeOf: typeOf[snapshot.ObjectMapSnapshotPayload]()},
	{name: "ObjectYAMLSnapshotPayload", typeOf: typeOf[snapshot.ObjectYAMLSnapshotPayload]()},
	{name: "ObjectHelmManifestSnapshotPayload", typeOf: typeOf[snapshot.ObjectHelmManifestSnapshotPayload]()},
	{name: "ObjectHelmValuesSnapshotPayload", typeOf: typeOf[snapshot.ObjectHelmValuesSnapshotPayload]()},
	{name: "NamespaceWorkloadSummary", typeOf: typeOf[streamrows.WorkloadSummary]()},
	{name: "NamespaceWorkloadSnapshotPayload", typeOf: typeOf[snapshot.NamespaceWorkloadsSnapshot]()},
	{name: "NamespaceConfigSummary", typeOf: typeOf[streamrows.ConfigSummary]()},
	{name: "NamespaceConfigSnapshotPayload", typeOf: typeOf[snapshot.NamespaceConfigSnapshot]()},
	{name: "NamespaceNetworkSummary", typeOf: typeOf[streamrows.NetworkSummary]()},
	{name: "NamespaceNetworkSnapshotPayload", typeOf: typeOf[snapshot.NamespaceNetworkSnapshot]()},
	{name: "NamespaceRBACSummary", typeOf: typeOf[streamrows.RBACSummary]()},
	{name: "NamespaceRBACSnapshotPayload", typeOf: typeOf[snapshot.NamespaceRBACSnapshot]()},
	{name: "NamespaceStorageSummary", typeOf: typeOf[streamrows.StorageSummary]()},
	{name: "NamespaceStorageSnapshotPayload", typeOf: typeOf[snapshot.NamespaceStorageSnapshot]()},
	{name: "NamespaceAutoscalingSummary", typeOf: typeOf[streamrows.AutoscalingSummary]()},
	{name: "NamespaceAutoscalingSnapshotPayload", typeOf: typeOf[snapshot.NamespaceAutoscalingSnapshot]()},
	{name: "NamespaceQuotaSummary", typeOf: typeOf[streamrows.QuotaSummary]()},
	{name: "QuotaStatus", typeOf: typeOf[streamrows.QuotaStatus]()},
	{name: "NamespaceQuotasSnapshotPayload", typeOf: typeOf[snapshot.NamespaceQuotasSnapshot]()},
	{name: "NamespaceEventSummary", typeOf: typeOf[snapshot.EventSummary]()},
	{name: "NamespaceEventsSnapshotPayload", typeOf: typeOf[snapshot.NamespaceEventsSnapshot]()},
	{name: "NamespaceCustomSummary", typeOf: typeOf[streamrows.NamespaceCustomSummary]()},
	{name: "NamespaceCustomSnapshotPayload", typeOf: typeOf[snapshot.NamespaceCustomSnapshot]()},
	{name: "NamespaceHelmSummary", typeOf: typeOf[snapshot.NamespaceHelmSummary]()},
	{name: "NamespaceHelmSnapshotPayload", typeOf: typeOf[snapshot.NamespaceHelmSnapshot]()},
	{name: "ContainerLogsWireEntry", typeOf: typeOf[containerlogsstream.Entry]()},
	{name: "ContainerLogsStreamEventPayload", typeOf: typeOf[containerlogsstream.EventPayload]()},
	{name: "ResourceStreamClientMessage", typeOf: typeOf[streammux.ClientMessage]()},
	{name: "ResourceStreamServerMessage", typeOf: typeOf[streammux.ServerMessage]()},
	{name: "TelemetrySnapshotStatus", typeOf: typeOf[telemetry.SnapshotStatus]()},
	{name: "TelemetryMetricsStatus", typeOf: typeOf[telemetry.MetricsStatus]()},
	{name: "TelemetryStreamStatus", typeOf: typeOf[telemetry.StreamStatus]()},
	{name: "TelemetryCatalogStatus", typeOf: typeOf[telemetry.CatalogStatus]()},
	{name: "TelemetryConnectionStats", typeOf: typeOf[telemetry.ConnectionStats]()},
	{name: "TelemetrySummary", typeOf: typeOf[telemetry.Summary]()},
}

var contractEnums = []enumSpec{
	{name: "DrainEventKind", typeOf: typeOf[nodemaintenance.DrainEventKind]()},
	{name: "DrainEventPhase", typeOf: typeOf[nodemaintenance.DrainEventPhase]()},
	{name: "DrainStatus", typeOf: typeOf[nodemaintenance.DrainStatus]()},
	{name: "CatalogItemScope", typeOf: typeOf[objectcatalog.Scope]()},
	{name: "ResourceQueryProvider", typeOf: typeOf[snapshot.ResourceQueryProvider]()},
	{name: "ResourceQueryScope", typeOf: typeOf[snapshot.ResourceQueryScope]()},
	{name: "ResourceQueryCompleteness", typeOf: typeOf[snapshot.ResourceQueryCompleteness]()},
	{name: "NamespaceScopeStatus", typeOf: typeOf[snapshot.NamespaceScopeStatus]()},
	{name: "NamespaceSignalState", typeOf: typeOf[snapshot.NamespaceSignalState]()},
	{name: "NamespaceQuotaPressure", typeOf: typeOf[snapshot.NamespaceQuotaPressure]()},
	{name: "AttentionSeverity", typeOf: typeOf[snapshot.AttentionSeverity]()},
	{name: "ResourceQueryAnchorReason", typeOf: typeOf[snapshot.ResourceQueryAnchorReason]()},
	{name: "ResourceSource", typeOf: typeOf[resourcemodel.ResourceSource]()},
	{name: "ResourceScope", typeOf: typeOf[resourcemodel.ResourceScope]()},
	{name: "ResourceStatusSignalType", typeOf: typeOf[resourcemodel.StatusSignalType]()},
	{name: "TelemetrySnapshotLastStatus", typeOf: typeOf[telemetry.SnapshotLastStatus]()},
	{name: "ResourceStreamMessageType", typeOf: typeOf[streammux.MessageType](), valuesName: "RESOURCE_STREAM_MESSAGE_TYPES"},
	{name: "ResourceStreamSource", typeOf: typeOf[streammux.Source](), valuesName: "RESOURCE_STREAM_SOURCES"},
	{name: "ResourceStreamSignal", typeOf: typeOf[streammux.Signal](), valuesName: "RESOURCE_STREAM_SIGNALS"},
}

var contractAliases = []aliasSpec{
	{name: "ClusterNodeRow", target: "ClusterNodeSnapshotEntry"},
}

var snapshotEnvelopeType = typeOf[refresh.Snapshot]()
var telemetrySummaryType = typeOf[telemetry.Summary]()
