package snapshot

import (
	"context"
	"reflect"
	"sort"
	"strconv"
	"testing"
	"unsafe"

	"github.com/luxury-yacht/app/backend/objectcatalog"
)

func TestParseBrowseScope(t *testing.T) {
	opts, err := parseBrowseScope("kind=Pod&namespace=default&namespace=cluster&search=nginx&limit=50&continue=10")
	if err != nil {
		t.Fatalf("parseBrowseScope returned error: %v", err)
	}
	if len(opts.Kinds) != 1 || opts.Kinds[0] != "Pod" {
		t.Fatalf("unexpected kinds: %+v", opts.Kinds)
	}
	if len(opts.Namespaces) != 2 {
		t.Fatalf("unexpected namespaces: %+v", opts.Namespaces)
	}
	if opts.Search != "nginx" {
		t.Fatalf("expected search nginx, got %q", opts.Search)
	}
	if opts.Limit != 50 {
		t.Fatalf("expected limit 50, got %d", opts.Limit)
	}
	if opts.Continue != "10" {
		t.Fatalf("expected continue 10, got %q", opts.Continue)
	}
}

func TestCatalogBuildUsesCatalogOnly(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			UID:       "uid-a",
			Scope:     objectcatalog.ScopeNamespace,
		},
		{
			Kind:      "Deployment",
			Group:     "apps",
			Version:   "v1",
			Resource:  "deployments",
			Namespace: "default",
			Name:      "deploy-b",
			UID:       "uid-b",
			Scope:     objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}

	snap, err := builder.Build(context.Background(), "limit=1")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if payload.Total != 2 {
		t.Fatalf("expected total 2, got %d", payload.Total)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected page size 1, got %d", len(payload.Items))
	}
	if payload.Continue == "" {
		t.Fatalf("expected continue token for subsequent page")
	}
	if payload.Items[0].UID == "" {
		t.Fatalf("expected UID to be preserved")
	}
	if payload.BatchIndex != 0 {
		t.Fatalf("expected batch index 0, got %d", payload.BatchIndex)
	}
	if payload.BatchSize != 1 {
		t.Fatalf("expected batch size 1, got %d", payload.BatchSize)
	}
	if payload.TotalBatches != 2 {
		t.Fatalf("expected total batches 2, got %d", payload.TotalBatches)
	}
	if payload.IsFinal {
		t.Fatalf("expected non-final batch when continue token present")
	}
	expectedKinds := []objectcatalog.KindInfo{
		{Kind: "Deployment", Namespaced: true},
		{Kind: "Pod", Namespaced: true},
	}
	if !reflect.DeepEqual(payload.Kinds, expectedKinds) {
		t.Fatalf("unexpected kinds in payload: %+v", payload.Kinds)
	}
	if !reflect.DeepEqual(payload.Namespaces, []string{"default"}) {
		t.Fatalf("unexpected namespaces in payload: %+v", payload.Namespaces)
	}
}

func TestCatalogBuildPreservesContinueWhenCachesReady(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "alpha",
			UID:             "uid-alpha",
			ResourceVersion: "1",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Deployment",
			Group:           "apps",
			Version:         "v1",
			Resource:        "deployments",
			Namespace:       "default",
			Name:            "bravo",
			UID:             "uid-bravo",
			ResourceVersion: "2",
			Scope:           objectcatalog.ScopeNamespace,
		},
		{
			Kind:            "Pod",
			Group:           "",
			Version:         "v1",
			Resource:        "pods",
			Namespace:       "kube-system",
			Name:            "charlie",
			UID:             "uid-charlie",
			ResourceVersion: "3",
			Scope:           objectcatalog.ScopeNamespace,
		},
	}

	svc := seedCatalogService(t, summaries)
	markCatalogCachesReady(t, svc, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
	}

	snap, err := builder.Build(context.Background(), "limit=2")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if payload.Total != len(summaries) {
		t.Fatalf("expected total %d, got %d", len(summaries), payload.Total)
	}
	if payload.Continue == "" {
		t.Fatalf("expected continue token to be preserved when caches are ready")
	}
	if payload.IsFinal {
		t.Fatal("expected non-final payload while continue token is present")
	}
}

func TestCatalogBuildErrorsWhenServiceUnavailable(t *testing.T) {
	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return nil },
	}
	_, err := builder.Build(context.Background(), "")
	if err == nil {
		t.Fatal("expected error when catalog service is unavailable")
	}
}

func TestCatalogBuildAddsNamespaceGroups(t *testing.T) {
	summaries := []objectcatalog.Summary{
		{
			Kind:      "Pod",
			Group:     "",
			Version:   "v1",
			Resource:  "pods",
			Namespace: "default",
			Name:      "pod-a",
			UID:       "uid-a",
			Scope:     objectcatalog.ScopeNamespace,
		},
	}
	svc := seedCatalogService(t, summaries)

	builder := &catalogBuilder{
		domain:         catalogDomain,
		catalogService: func() *objectcatalog.Service { return svc },
		namespaceGroups: func() []CatalogNamespaceGroup {
			return []CatalogNamespaceGroup{
				{
					ClusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
					Namespaces:  []string{"default", "kube-system"},
				},
			}
		},
	}

	snap, err := builder.Build(context.Background(), "namespace=default&namespace=kube-system")
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}

	payload, ok := snap.Payload.(CatalogSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if len(payload.NamespaceGroups) != 1 {
		t.Fatalf("expected one namespace group, got %d", len(payload.NamespaceGroups))
	}
	group := payload.NamespaceGroups[0]
	if group.ClusterID != "cluster-a" || group.ClusterName != "alpha" {
		t.Fatalf("unexpected cluster metadata: %+v", group)
	}
	if !reflect.DeepEqual(group.Namespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected namespaces: %+v", group.Namespaces)
	}
	if !reflect.DeepEqual(group.SelectedNamespaces, []string{"default", "kube-system"}) {
		t.Fatalf("unexpected selected namespaces: %+v", group.SelectedNamespaces)
	}
}

func seedCatalogService(t *testing.T, summaries []objectcatalog.Summary) *objectcatalog.Service {
	t.Helper()
	svc := objectcatalog.NewService(objectcatalog.Dependencies{}, nil)
	value := reflect.ValueOf(svc).Elem()

	itemsField := value.FieldByName("items")
	if !itemsField.IsValid() {
		t.Fatal("catalog service items field not found")
	}

	itemsMap := make(map[string]objectcatalog.Summary, len(summaries))
	for idx, summary := range summaries {
		itemsMap[strconv.Itoa(idx)] = summary
	}

	reflect.NewAt(itemsField.Type(), unsafe.Pointer(itemsField.UnsafeAddr())).Elem().Set(reflect.ValueOf(itemsMap))
	return svc
}

func markCatalogCachesReady(t *testing.T, svc *objectcatalog.Service, summaries []objectcatalog.Summary) {
	t.Helper()
	value := reflect.ValueOf(svc).Elem()

	setUnexportedField := func(field reflect.Value, fieldValue interface{}) {
		reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(
			reflect.ValueOf(fieldValue).Convert(field.Type()),
		)
	}

	sortedChunksField := value.FieldByName("sortedChunks")
	if !sortedChunksField.IsValid() {
		t.Fatal("catalog service sortedChunks field not found")
	}
	chunkType := sortedChunksField.Type().Elem()
	chunkValue := reflect.New(chunkType.Elem())
	itemsField := chunkValue.Elem().FieldByName("items")
	itemsSlice := reflect.MakeSlice(itemsField.Type(), len(summaries), len(summaries))
	for idx, summary := range summaries {
		itemsSlice.Index(idx).Set(reflect.ValueOf(summary))
	}
	setUnexportedField(itemsField, itemsSlice.Interface())
	chunkSlice := reflect.MakeSlice(sortedChunksField.Type(), 1, 1)
	chunkSlice.Index(0).Set(chunkValue)
	setUnexportedField(sortedChunksField, chunkSlice.Interface())

	kindsField := value.FieldByName("cachedKinds")
	if !kindsField.IsValid() {
		t.Fatal("catalog service cachedKinds field not found")
	}
	kindMap := make(map[string]bool, len(summaries))
	for _, summary := range summaries {
		if summary.Kind != "" {
			kindMap[summary.Kind] = summary.Scope == objectcatalog.ScopeNamespace
		}
	}
	kindList := make([]objectcatalog.KindInfo, 0, len(kindMap))
	for kind, namespaced := range kindMap {
		kindList = append(kindList, objectcatalog.KindInfo{Kind: kind, Namespaced: namespaced})
	}
	sort.Slice(kindList, func(i, j int) bool { return kindList[i].Kind < kindList[j].Kind })
	kindsSlice := reflect.MakeSlice(kindsField.Type(), len(kindList), len(kindList))
	for idx, kindInfo := range kindList {
		kindsSlice.Index(idx).Set(reflect.ValueOf(kindInfo))
	}
	setUnexportedField(kindsField, kindsSlice.Interface())

	namespacesField := value.FieldByName("cachedNamespaces")
	if !namespacesField.IsValid() {
		t.Fatal("catalog service cachedNamespaces field not found")
	}
	namespaceSet := make(map[string]struct{}, len(summaries))
	for _, summary := range summaries {
		if summary.Namespace != "" {
			namespaceSet[summary.Namespace] = struct{}{}
		}
	}
	namespaceList := make([]string, 0, len(namespaceSet))
	for ns := range namespaceSet {
		namespaceList = append(namespaceList, ns)
	}
	sort.Strings(namespaceList)
	namespaceSlice := reflect.MakeSlice(namespacesField.Type(), len(namespaceList), len(namespaceList))
	for idx, ns := range namespaceList {
		namespaceSlice.Index(idx).Set(reflect.ValueOf(ns))
	}
	setUnexportedField(namespacesField, namespaceSlice.Interface())

	descriptorsField := value.FieldByName("cachedDescriptors")
	if !descriptorsField.IsValid() {
		t.Fatal("catalog service cachedDescriptors field not found")
	}
	descriptorSlice := reflect.MakeSlice(descriptorsField.Type(), len(summaries), len(summaries))
	for idx, summary := range summaries {
		desc := objectcatalog.Descriptor{
			Group:      summary.Group,
			Version:    summary.Version,
			Resource:   summary.Resource,
			Kind:       summary.Kind,
			Scope:      summary.Scope,
			Namespaced: summary.Scope == objectcatalog.ScopeNamespace,
		}
		descriptorSlice.Index(idx).Set(reflect.ValueOf(desc))
	}
	setUnexportedField(descriptorsField, descriptorSlice.Interface())

	cachesReadyField := value.FieldByName("cachesReady")
	if !cachesReadyField.IsValid() {
		t.Fatal("catalog service cachesReady field not found")
	}
	setUnexportedField(cachesReadyField, true)
}
