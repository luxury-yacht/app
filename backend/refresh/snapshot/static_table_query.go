package snapshot

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	nodespkg "github.com/luxury-yacht/app/backend/resources/nodes"
)

// numericAgeSortValue reports the numeric sort value for an age column. Age is
// always a numeric field, so a missing/unknown timestamp returns ok=true with a
// -Inf sentinel rather than ok=false. Keeping the whole field numeric (never a
// mix of numeric and string sort values) is what lets the page sort and the
// keyset cursor agree on ordering; -Inf preserves "unknown age sorts first
// ascending", the prior behavior.
func numericAgeSortValue(ageTimestamp int64) (float64, bool) {
	if ageTimestamp <= 0 {
		return math.Inf(-1), true
	}
	return -float64(ageTimestamp), true
}

// nodePodsUsedSortValue is numeric for every node, so an unknown pod count
// returns ok=true with a -Inf sentinel (sorts first ascending) rather than
// ok=false, keeping the field uniformly numeric for keyset-consistent sorting.
func nodePodsUsedSortValue(pods string) (float64, bool) {
	pods = strings.TrimSpace(pods)
	if pods == "" || pods == "—" || pods == "-" {
		return math.Inf(-1), true
	}
	used, _, _ := strings.Cut(pods, "/")
	value, err := strconv.ParseFloat(strings.TrimSpace(used), 64)
	if err != nil {
		return math.Inf(-1), true
	}
	return value, true
}

func configTableQueryAdapter() typedTableQueryAdapter[ConfigSummary] {
	return typedTableQueryAdapter[ConfigSummary]{
		MetadataText: func(row ConfigSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key: func(row ConfigSummary) string {
			return namespacedTableKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: namespacedTableKey,
		Namespace: func(row ConfigSummary) string { return row.Ref.Namespace },
		Kind:      func(row ConfigSummary) string { return row.Ref.Kind },
		SearchText: func(row ConfigSummary) []string {
			return []string{row.Ref.Kind, row.TypeAlias, row.Ref.Name, row.Ref.Namespace, strconv.Itoa(row.Data)}
		},
		Predicate: func(ConfigSummary, string, string) bool { return true },
		SortValue: func(row ConfigSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "namespace":
				return row.Ref.Namespace
			case "data":
				return strconv.Itoa(row.Data)
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row ConfigSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "data") {
				return float64(row.Data), true
			}
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func networkTableQueryAdapter() typedTableQueryAdapter[NetworkSummary] {
	return typedTableQueryAdapter[NetworkSummary]{
		MetadataText: func(row NetworkSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key: func(row NetworkSummary) string {
			return namespacedTableKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: namespacedTableKey,
		Namespace: func(row NetworkSummary) string { return row.Ref.Namespace },
		Kind:      func(row NetworkSummary) string { return row.Ref.Kind },
		SearchText: func(row NetworkSummary) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Ref.Namespace, resourcemodel.DetailSegmentsSearchText(row.Details)}
		},
		Predicate: func(NetworkSummary, string, string) bool { return true },
		SortValue: func(row NetworkSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "namespace":
				return row.Ref.Namespace
			case "context":
				return resourcemodel.DetailSlotText(row.Details, resourcemodel.DetailSlotReference)
			case "network":
				return resourcemodel.DetailSlotText(row.Details, resourcemodel.DetailSlotAddress)
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row NetworkSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func storageTableQueryAdapter() typedTableQueryAdapter[StorageSummary] {
	return typedTableQueryAdapter[StorageSummary]{
		MetadataText: func(row StorageSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key: func(row StorageSummary) string {
			return namespacedTableKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: namespacedTableKey,
		Namespace: func(row StorageSummary) string { return row.Ref.Namespace },
		Kind:      func(row StorageSummary) string { return row.Ref.Kind },
		SearchText: func(row StorageSummary) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Ref.Namespace, row.Capacity, row.Status, row.StorageClass}
		},
		Predicate: func(StorageSummary, string, string) bool { return true },
		SortValue: func(row StorageSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "namespace":
				return row.Ref.Namespace
			case "capacity":
				return row.Capacity
			case "status":
				return row.Status
			case "storageclass":
				return row.StorageClass
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row StorageSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func autoscalingTableQueryAdapter() typedTableQueryAdapter[AutoscalingSummary] {
	return typedTableQueryAdapter[AutoscalingSummary]{
		MetadataText: func(row AutoscalingSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key: func(row AutoscalingSummary) string {
			return namespacedTableKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: namespacedTableKey,
		Namespace: func(row AutoscalingSummary) string { return row.Ref.Namespace },
		Kind:      func(row AutoscalingSummary) string { return row.Ref.Kind },
		SearchText: func(row AutoscalingSummary) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Ref.Namespace, row.Target, row.TargetAPIVersion}
		},
		Predicate: func(AutoscalingSummary, string, string) bool { return true },
		SortValue: func(row AutoscalingSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "namespace":
				return row.Ref.Namespace
			case "target", "scaletarget":
				return row.Target
			case "min", "minreplicas", "replicas":
				return strconv.Itoa(int(row.Min))
			case "max", "maxreplicas":
				return strconv.Itoa(int(row.Max))
			case "current", "currentreplicas":
				return strconv.Itoa(int(row.Current))
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row AutoscalingSummary, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "min", "minreplicas", "replicas":
				return float64(row.Min), true
			case "max", "maxreplicas":
				return float64(row.Max), true
			case "current", "currentreplicas":
				return float64(row.Current), true
			case "age":
				return numericAgeSortValue(row.AgeTimestamp)
			default:
				return 0, false
			}
		},
	}
}

func quotaTableQueryAdapter() typedTableQueryAdapter[QuotaSummary] {
	return typedTableQueryAdapter[QuotaSummary]{
		MetadataText: func(row QuotaSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key: func(row QuotaSummary) string {
			return namespacedTableKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: namespacedTableKey,
		Namespace: func(row QuotaSummary) string { return row.Ref.Namespace },
		Kind:      func(row QuotaSummary) string { return row.Ref.Kind },
		SearchText: func(row QuotaSummary) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Ref.Namespace, row.Details}
		},
		Predicate: func(QuotaSummary, string, string) bool { return true },
		SortValue: func(row QuotaSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "namespace":
				return row.Ref.Namespace
			case "details":
				return row.Details
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row QuotaSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func rbacTableQueryAdapter() typedTableQueryAdapter[RBACSummary] {
	return typedTableQueryAdapter[RBACSummary]{
		MetadataText: func(row RBACSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key:          func(row RBACSummary) string { return namespacedTableKey(row.Ref.Kind, row.Ref.Namespace, row.Ref.Name) },
		AnchorKey:    namespacedTableKey,
		Namespace:    func(row RBACSummary) string { return row.Ref.Namespace },
		Kind:         func(row RBACSummary) string { return row.Ref.Kind },
		SearchText: func(row RBACSummary) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Ref.Namespace, row.Details}
		},
		Predicate: func(RBACSummary, string, string) bool { return true },
		SortValue: func(row RBACSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "namespace":
				return row.Ref.Namespace
			case "details":
				return row.Details
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row RBACSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func helmTableQueryAdapter() typedTableQueryAdapter[NamespaceHelmSummary] {
	return typedTableQueryAdapter[NamespaceHelmSummary]{
		Key: func(row NamespaceHelmSummary) string {
			return namespacedTableKey("HelmRelease", row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: func(_, namespace, name string) string { return namespacedTableKey("HelmRelease", namespace, name) },
		Namespace: func(row NamespaceHelmSummary) string { return row.Ref.Namespace },
		Kind:      func(NamespaceHelmSummary) string { return "HelmRelease" },
		SearchText: func(row NamespaceHelmSummary) []string {
			return []string{row.Ref.Name, row.Ref.Namespace, row.Chart, row.AppVersion, row.Status, row.Description}
		},
		Predicate: func(NamespaceHelmSummary, string, string) bool { return true },
		SortValue: func(row NamespaceHelmSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return "HelmRelease"
			case "namespace":
				return row.Ref.Namespace
			case "chart":
				return row.Chart
			case "appversion":
				return row.AppVersion
			case "status":
				return row.Status
			case "revision":
				return strconv.Itoa(row.Revision)
			case "updated":
				return row.Updated
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row NamespaceHelmSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "revision") {
				return float64(row.Revision), true
			}
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func eventQueryFacets[T any](eventType, reason, source func(T) string) []typedTableQueryFacet[T] {
	return []typedTableQueryFacet[T]{
		{
			Descriptor: ResourceQueryFacetDescriptor{Key: "types", Label: "Type", Placeholder: "All types", BulkActions: true},
			Value:      eventType,
		},
		{
			Descriptor: ResourceQueryFacetDescriptor{Key: "reasons", Label: "Reason", Placeholder: "All reasons", Searchable: true, BulkActions: true},
			Value:      reason,
		},
		{
			Descriptor: ResourceQueryFacetDescriptor{Key: "sources", Label: "Source", Placeholder: "All sources", Searchable: true, BulkActions: true},
			Value:      source,
		},
	}
}

func namespacedEventTableQueryAdapter() typedTableQueryAdapter[EventSummary] {
	return typedTableQueryAdapter[EventSummary]{
		MetadataText: func(row EventSummary) []string { return tableMetadataSearchText(row.Metadata) },
		Key:          func(row EventSummary) string { return namespacedTableKey("Event", row.Ref.Namespace, row.Ref.Name) },
		AnchorKey:    func(_, namespace, name string) string { return namespacedTableKey("Event", namespace, name) },
		Namespace:    func(row EventSummary) string { return row.ObjectNamespace },
		Kind:         func(row EventSummary) string { return row.ObjectKind },
		Facets: eventQueryFacets(
			func(row EventSummary) string { return row.Type },
			func(row EventSummary) string { return row.Reason },
			func(row EventSummary) string { return row.Source },
		),
		SearchText: func(row EventSummary) []string {
			return []string{row.ObjectKind, row.Ref.Name, row.Ref.Namespace, row.ObjectNamespace, row.Type, row.Source, row.Reason, row.Object, row.Message}
		},
		Predicate: func(EventSummary, string, string) bool { return true },
		SortValue: func(row EventSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.ObjectKind
			case "namespace":
				return row.ObjectNamespace
			case "type":
				return row.Type
			case "source":
				return row.Source
			case "reason":
				return row.Reason
			case "object":
				return row.Object
			case "objecttype":
				return row.ObjectKind
			case "objectname":
				return row.ObjectName
			case "message":
				return row.Message
			case "age", "agetimestamp":
				return strconv.FormatInt(row.AgeTimestamp, 10)
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row EventSummary, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			if strings.EqualFold(field, "ageTimestamp") {
				return float64(row.AgeTimestamp), true
			}
			return 0, false
		},
	}
}

func clusterEventTableQueryAdapter() typedTableQueryAdapter[ClusterEventEntry] {
	return typedTableQueryAdapter[ClusterEventEntry]{
		MetadataText: func(row ClusterEventEntry) []string { return tableMetadataSearchText(row.Metadata) },
		Key: func(row ClusterEventEntry) string {
			return namespacedTableKey("Event", row.Ref.Namespace, row.Ref.Name)
		},
		AnchorKey: func(_, namespace, name string) string { return namespacedTableKey("Event", namespace, name) },
		Namespace: func(row ClusterEventEntry) string { return row.Ref.Namespace },
		Kind:      func(row ClusterEventEntry) string { return row.Ref.Kind },
		Facets: eventQueryFacets(
			func(row ClusterEventEntry) string { return row.Type },
			func(row ClusterEventEntry) string { return row.Reason },
			func(row ClusterEventEntry) string { return row.Source },
		),
		SearchText: func(row ClusterEventEntry) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Type, row.Source, row.Reason, row.Object, row.Message}
		},
		Predicate: func(ClusterEventEntry, string, string) bool { return true },
		SortValue: func(row ClusterEventEntry, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "type":
				return row.Type
			case "source":
				return row.Source
			case "reason":
				return row.Reason
			case "object":
				return row.Object
			case "objecttype":
				return row.ObjectKind
			case "objectname":
				return row.ObjectName
			case "message":
				return row.Message
			case "age", "agetimestamp":
				return strconv.FormatInt(row.AgeTimestamp, 10)
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row ClusterEventEntry, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			if strings.EqualFold(field, "ageTimestamp") {
				return float64(row.AgeTimestamp), true
			}
			return 0, false
		},
	}
}

// metadataSearchText flattens label/annotation maps into "key: value" strings. Search
// is a substring match, so these also match any part of a key or a value alone — the
// same text the frontend metadata-search accessor matches.
func metadataSearchText(maps ...map[string]string) []string {
	var out []string
	for _, m := range maps {
		for key, value := range m {
			out = append(out, key+": "+value)
		}
	}
	return out
}

// tableMetadataSearchText is metadataSearchText for rows that carry their labels
// and annotations in a ResourceTableMetadata (nil when the object has neither).
func tableMetadataSearchText(metadata *resourcemodel.ResourceTableMetadata) []string {
	if metadata == nil {
		return nil
	}
	return metadataSearchText(metadata.Labels, metadata.Annotations)
}

func nodeTableQueryAdapter() typedTableQueryAdapter[NodeSummary] {
	return typedTableQueryAdapter[NodeSummary]{
		Key:       func(row NodeSummary) string { return clusterTableKey(nodespkg.Identity.Kind, row.Ref.Name) },
		AnchorKey: func(_, _, name string) string { return clusterTableKey(nodespkg.Identity.Kind, name) },
		Namespace: func(NodeSummary) string { return "" },
		Kind:      func(NodeSummary) string { return nodespkg.Identity.Kind },
		Facets:    nodeQueryFacets(),
		SearchText: func(row NodeSummary) []string {
			return []string{row.Ref.Name, row.Status, row.Roles, row.Version, row.InternalIP, row.ExternalIP}
		},
		MetadataText: func(row NodeSummary) []string {
			return metadataSearchText(row.Labels, row.Annotations)
		},
		Predicate: func(NodeSummary, string, string) bool { return true },
		SortValue: func(row NodeSummary, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return nodespkg.Identity.Kind
			case "status":
				return row.Status
			case "roles":
				return row.Roles
			case "version":
				return row.Version
			case "pods":
				return row.Pods
			case "restarts":
				return strconv.Itoa(int(row.Restarts))
			case "age", "agetimestamp":
				return strconv.FormatInt(row.AgeTimestamp, 10)
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row NodeSummary, field string) (float64, bool) {
			switch strings.ToLower(field) {
			case "cpu", "cpuusage":
				return usageSortValue(row.CPUUsageMilli)
			case "memory", "memoryusage":
				return usageSortValue(row.MemoryUsageBytes)
			case "pods":
				return nodePodsUsedSortValue(row.Pods)
			case "restarts":
				return float64(row.Restarts), true
			case "age":
				return numericAgeSortValue(row.AgeTimestamp)
			case "agetimestamp":
				return float64(row.AgeTimestamp), true
			default:
				return 0, false
			}
		},
	}
}

func clusterConfigTableQueryAdapter() typedTableQueryAdapter[ClusterConfigEntry] {
	return typedTableQueryAdapter[ClusterConfigEntry]{
		MetadataText: func(row ClusterConfigEntry) []string { return tableMetadataSearchText(row.Metadata) },
		Key:          func(row ClusterConfigEntry) string { return clusterTableKey(row.Ref.Kind, row.Ref.Name) },
		AnchorKey:    func(kind, _, name string) string { return clusterTableKey(kind, name) },
		Namespace:    func(ClusterConfigEntry) string { return "" },
		Kind:         func(row ClusterConfigEntry) string { return row.Ref.Kind },
		SearchText: func(row ClusterConfigEntry) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.Details}
		},
		Predicate: func(ClusterConfigEntry, string, string) bool { return true },
		SortValue: func(row ClusterConfigEntry, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "details":
				return row.Details
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row ClusterConfigEntry, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func clusterStorageTableQueryAdapter() typedTableQueryAdapter[ClusterStorageEntry] {
	return typedTableQueryAdapter[ClusterStorageEntry]{
		MetadataText: func(row ClusterStorageEntry) []string { return tableMetadataSearchText(row.Metadata) },
		Key:          func(row ClusterStorageEntry) string { return clusterTableKey(row.Ref.Kind, row.Ref.Name) },
		AnchorKey:    func(kind, _, name string) string { return clusterTableKey(kind, name) },
		Namespace:    func(ClusterStorageEntry) string { return "" },
		Kind:         func(row ClusterStorageEntry) string { return row.Ref.Kind },
		SearchText: func(row ClusterStorageEntry) []string {
			return []string{row.Ref.Kind, row.Ref.Name, row.StorageClass, row.Capacity, row.AccessModes, row.Status, row.Claim}
		},
		Predicate: func(ClusterStorageEntry, string, string) bool { return true },
		SortValue: func(row ClusterStorageEntry, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "storageclass":
				return row.StorageClass
			case "capacity":
				return row.Capacity
			case "accessmodes":
				return row.AccessModes
			case "status":
				return row.Status
			case "claim":
				return row.Claim
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row ClusterStorageEntry, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func clusterRBACTableQueryAdapter() typedTableQueryAdapter[ClusterRBACEntry] {
	return typedTableQueryAdapter[ClusterRBACEntry]{
		MetadataText: func(row ClusterRBACEntry) []string { return tableMetadataSearchText(row.Metadata) },
		Key:          func(row ClusterRBACEntry) string { return clusterTableKey(row.Ref.Kind, row.Ref.Name) },
		AnchorKey:    func(kind, _, name string) string { return clusterTableKey(kind, name) },
		Namespace:    func(ClusterRBACEntry) string { return "" },
		Kind:         func(row ClusterRBACEntry) string { return row.Ref.Kind },
		SearchText: func(row ClusterRBACEntry) []string {
			return []string{row.Ref.Kind, row.TypeAlias, row.Ref.Name, row.Details}
		},
		Predicate: func(ClusterRBACEntry, string, string) bool { return true },
		SortValue: func(row ClusterRBACEntry, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "details":
				return row.Details
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row ClusterRBACEntry, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func clusterCRDTableQueryAdapter() typedTableQueryAdapter[ClusterCRDEntry] {
	return typedTableQueryAdapter[ClusterCRDEntry]{
		MetadataText: func(row ClusterCRDEntry) []string { return tableMetadataSearchText(row.Metadata) },
		Key:          func(row ClusterCRDEntry) string { return clusterTableKey("CustomResourceDefinition", row.Ref.Name) },
		AnchorKey:    func(_, _, name string) string { return clusterTableKey("CustomResourceDefinition", name) },
		Namespace:    func(ClusterCRDEntry) string { return "" },
		Kind:         func(ClusterCRDEntry) string { return "CustomResourceDefinition" },
		SearchText: func(row ClusterCRDEntry) []string {
			return []string{row.Ref.Kind, row.TypeAlias, row.Ref.Name, row.Group, row.Scope, row.Details, row.StorageVersion}
		},
		Predicate: func(ClusterCRDEntry, string, string) bool { return true },
		SortValue: func(row ClusterCRDEntry, field string) string {
			switch strings.ToLower(field) {
			case "kind":
				return row.Ref.Kind
			case "group":
				return row.Group
			case "scope":
				return row.Scope
			case "details":
				return row.Details
			case "version", "storageversion":
				return row.StorageVersion
			case "age":
				return row.Age
			default:
				return row.Ref.Name
			}
		},
		NumericSort: func(row ClusterCRDEntry, field string) (float64, bool) {
			if strings.EqualFold(field, "age") {
				return numericAgeSortValue(row.AgeTimestamp)
			}
			return 0, false
		},
	}
}

func namespacedTableKey(kind, namespace, name string) string {
	return fmt.Sprintf("%s/%s/%s", strings.ToLower(kind), strings.ToLower(namespace), strings.ToLower(name))
}

func clusterTableKey(kind, name string) string {
	return fmt.Sprintf("%s/%s", strings.ToLower(kind), strings.ToLower(name))
}

// keyFromCatalog derives a maintained-store row's adapter key from the object-catalog
// Summary half of its ingest bundle, so a maintained store can evict a row from the
// RETAINED Catalog half after the redundant stored Table half is dropped. The Summary
// carries the same Kind/Namespace/Name every adapter's Key folds into the table key, so
// this matches adapter.Key(tableRow) for every ingest-fed kind — proven for all of them by
// TestKeyFromCatalogMatchesAdapterKeyForEveryMaintainedKind. A cluster-scoped object (no
// namespace) keys without a namespace segment, exactly as clusterTableKey does.
func keyFromCatalog(summary objectcatalog.Summary) string {
	if summary.Ref.Namespace == "" {
		return clusterTableKey(summary.Ref.Kind, summary.Ref.Name)
	}
	return namespacedTableKey(summary.Ref.Kind, summary.Ref.Namespace, summary.Ref.Name)
}
