/*
 * backend/objectcatalog/collect.go
 *
 * Catalog collection and owned-reflector integration.
 */

package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/argocd"
	"github.com/luxury-yacht/app/backend/resources/karpenter"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// catalogCollection records the actual LIST decisions for one descriptor.
// Preflight and a previously admitted watch cannot clear a failed LIST's denial.
type catalogCollection struct {
	stream          *streamingAggregator
	previousDenials map[string]struct{}
	watchedScopes   map[string]struct{}
	mu              sync.Mutex
	listDecisions   map[string]bool
}

func (c *catalogCollection) needsList(namespace string) bool {
	return c != nil && namespaceSetContains(c.previousDenials, namespace)
}

func (c *catalogCollection) recordList(namespace string, allowed bool) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.listDecisions == nil {
		c.listDecisions = make(map[string]bool)
	}
	c.listDecisions[namespace] = allowed
}

func (c *catalogCollection) aggregator() *streamingAggregator {
	if c == nil {
		return nil
	}
	return c.stream
}

func (c *catalogCollection) recordWatch(namespace string) {
	if c == nil {
		return
	}
	if c.watchedScopes == nil {
		c.watchedScopes = make(map[string]struct{})
	}
	c.watchedScopes[namespace] = struct{}{}
}

// completedScopes is called after every worker for the descriptor has stopped.
func (c *catalogCollection) completedScopes() map[string]struct{} {
	scopes := c.watchedScopes
	for namespace, allowed := range c.listDecisions {
		if allowed {
			if scopes == nil {
				scopes = make(map[string]struct{})
			}
			scopes[namespace] = struct{}{}
		}
	}
	return scopes
}

func (s *Service) collectResource(ctx context.Context, desc Descriptor, namespaces []string, collection *catalogCollection) ([]Summary, error) {
	if desc.GVR() == apiextensions.Identity.GVR() && s.apiResources.definitionListDenied() {
		// Recovery after a definite denial needs a newly authorized LIST.
		// The old reflector's retained rows cannot establish that access returned.
		return s.listResource(ctx, desc, namespaces, collection)
	}
	// Built-in kinds' Summaries come from their owned reflectors' stores (projected
	// at intake), for every namespace scope.
	if summaries, handled, err := s.collectViaIngest(ctx, desc, namespaces, collection); handled {
		return summaries, err
	}
	if planCollectionSource(desc).source == collectionSourceSkip {
		return nil, nil
	}
	confirmedCRD := s.deps.IngestSource != nil && s.deps.IngestSource.ReconcileDiscoveredResource(desc.GVR())
	if summaries, handled, err := s.collectViaDynamicIngest(ctx, desc, namespaces, collection); handled {
		return summaries, err
	}
	summaries, err := s.listResource(ctx, desc, namespaces, collection)
	if err != nil {
		return summaries, err
	}
	if !confirmedCRD && planCollectionSource(desc).promotable {
		s.maybePromote(desc, len(summaries))
	}
	return summaries, nil
}

func (s *Service) listResource(ctx context.Context, desc Descriptor, namespaces []string, collection *catalogCollection) ([]Summary, error) {
	return s.listResourceTargets(ctx, desc, listTargets(desc, namespaces), collection)
}

// Targets are resolved API scopes: an empty string means all namespaces and
// must not be normalized again as a user-provided namespace filter.
func (s *Service) listResourceTargets(ctx context.Context, desc Descriptor, targets []string, collection *catalogCollection) ([]Summary, error) {
	dynamicClient := s.deps.Common.DynamicClient
	if dynamicClient == nil {
		return nil, errors.New("dynamic client not available")
	}

	namespaceable := dynamicClient.Resource(desc.GVR())

	if len(targets) == 0 {
		return nil, nil
	}

	if desc.Namespaced && len(targets) > 1 && s.namespaceWorkerLimit(len(targets)) > 1 {
		return s.listResourceNamespacedParallel(ctx, namespaceable, desc, targets, collection)
	}

	return s.listResourceSequential(ctx, namespaceable, desc, targets, collection)
}

// scopeNamespaces returns the cluster's configured namespace scope for
// collection (docs/architecture/namespace-scope.md); nil means cluster-wide.
func (s *Service) scopeNamespaces() []string {
	if s == nil {
		return nil
	}
	return s.deps.AllowedNamespaces
}

func (s *Service) listResourceSequential(ctx context.Context, namespaceable dynamic.NamespaceableResourceInterface, desc Descriptor, targets []string, collection *catalogCollection) ([]Summary, error) {
	results := make([]Summary, 0)
	var failures []error
	for _, target := range targets {
		if err := ctx.Err(); err != nil {
			return results, err
		}
		items, err := s.listCatalogTarget(ctx, namespaceable, desc, target, collection)
		if err != nil {
			failures = append(failures, err)
		}
		results = append(results, items...)
	}
	return results, errors.Join(failures...)
}

func (s *Service) listResourceNamespacedParallel(ctx context.Context, namespaceable dynamic.NamespaceableResourceInterface, desc Descriptor, targets []string, collection *catalogCollection) ([]Summary, error) {
	results := make([]Summary, 0)
	var failures []error
	var mu sync.Mutex
	limit := s.namespaceWorkerLimit(len(targets))
	err := parallel.ForEach(ctx, targets, limit, func(taskCtx context.Context, target string) error {
		items, err := s.listCatalogTarget(taskCtx, namespaceable, desc, target, collection)
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			// An unreadable namespace must not cancel a sibling's permission decision.
			failures = append(failures, err)
		}
		results = append(results, items...)
		return nil
	})
	return results, errors.Join(append(failures, err)...)
}

func (s *Service) listCatalogTarget(ctx context.Context, namespaceable dynamic.NamespaceableResourceInterface, desc Descriptor, target string, collection *catalogCollection) ([]Summary, error) {
	batchSize := s.opts.PageSize
	if s.opts.StreamingBatchSize > 0 && s.opts.StreamingBatchSize < batchSize {
		batchSize = s.opts.StreamingBatchSize
	}
	client := resourceInterfaceForTarget(namespaceable, desc.Namespaced, target)
	rows, err := s.listNamespaceItems(ctx, desc, client, batchSize)
	if apierrors.IsForbidden(err) {
		collection.recordList(target, false)
		s.logDebug(fmt.Sprintf("permission denied listing %s in namespace %q", desc.GVR(), target))
		return nil, nil
	}
	if err == nil {
		collection.recordList(target, true)
		if agg := collection.aggregator(); agg != nil {
			// Publish only after every page was authorized.
			for batch := range slices.Chunk(rows, batchSize) {
				agg.emit(batch)
			}
		}
	}
	return rows, err
}

func (s *Service) listNamespaceItems(ctx context.Context, desc Descriptor, resourceInterface dynamic.ResourceInterface, batchSize int) ([]Summary, error) {
	options := metav1.ListOptions{Limit: int64(batchSize)}
	results := make([]Summary, 0)
	for {
		list, err := s.listCatalogPageWithRetry(ctx, resourceInterface, options)
		if err != nil {
			return nil, err
		}
		if list == nil {
			return results, nil
		}

		results = append(results, s.catalogSummaryPage(desc, list)...)
		if !advanceCatalogList(&options, list) {
			break
		}
	}
	return results, nil
}

func (s *Service) listCatalogPageWithRetry(
	ctx context.Context,
	resourceInterface dynamic.ResourceInterface,
	options metav1.ListOptions,
) (*unstructuredv1.UnstructuredList, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	timeout := s.opts.ListRequestTimeout
	if timeout <= 0 {
		timeout = config.ResourceFetchCallTimeout
	}
	for attempt := range config.ObjectCatalogListRetryMaxAttempts {
		requestCtx, cancel := context.WithTimeout(ctx, timeout)
		list, err := resourceInterface.List(requestCtx, options)
		cancel()
		if err == nil {
			return list, nil
		}
		if !shouldRetryList(err) || attempt == config.ObjectCatalogListRetryMaxAttempts-1 {
			return nil, err
		}
		delay := listRetryBackoff(attempt)
		s.logDebug(fmt.Sprintf("retrying catalog LIST after error: %v (backoff=%s)", err, delay))
		if err := timeutil.SleepWithContext(ctx, delay); err != nil {
			return nil, err
		}
	}
	return nil, nil
}

func advanceCatalogList(options *metav1.ListOptions, list *unstructuredv1.UnstructuredList) bool {
	continuation := list.GetContinue()
	if continuation == "" {
		return false
	}
	options.Continue = continuation
	return true
}

func (s *Service) catalogSummaryPage(desc Descriptor, list *unstructuredv1.UnstructuredList) []Summary {
	page := make([]Summary, 0, len(list.Items))
	for index := range list.Items {
		page = append(page, s.buildSummary(desc, &list.Items[index]))
	}
	return page
}

// deniedResourceName renders a kubectl-style resource name (`resource[.group]`)
// for permission diagnostics.
func deniedResourceName(desc Descriptor) string {
	if desc.Group != "" {
		return desc.Resource + "." + desc.Group
	}
	return desc.Resource
}

func (s *Service) namespaceWorkerLimit(targetCount int) int {
	if targetCount <= 1 {
		return 1
	}
	limit := s.opts.NamespaceWorkers
	if limit <= 0 || limit > targetCount {
		limit = targetCount
	}
	if limit < 1 {
		return 1
	}
	return limit
}

// maybePromote retains the existing threshold policy for dynamic resources whose
// CRD definition is not visible. Confirmed CRDs are admitted independently of count.
func (s *Service) maybePromote(desc Descriptor, itemCount int) {
	if s.opts.ReflectorPromotionThreshold <= 0 || itemCount < s.opts.ReflectorPromotionThreshold {
		return
	}
	source := s.deps.IngestSource
	if source == nil {
		return
	}
	gvr := desc.GVR()
	if _, exists := source.ReadDynamicCatalogSource(gvr.GroupResource()); exists {
		return
	}
	gvk := schema.GroupVersionKind{Group: desc.Group, Version: desc.Version, Kind: desc.Kind}
	clusterID := s.clusterID
	project := func(obj metav1.Object) interface{} { return summaryFromObject(clusterID, desc, obj) }
	if !source.RegisterDynamicCatalogReflector(gvr, gvk, project, desc.Namespaced) {
		return
	}
	s.logInfo(fmt.Sprintf("catalog descriptor %s promoted to the ingest path", gvr.String()))
}

func (s *Service) buildSummary(desc Descriptor, item metav1.Object) Summary {
	return summaryFromObject(s.clusterID, desc, item)
}

// summaryFromObject is the catalog's pure object → Summary projection: it depends
// only on the cluster identity, the resource descriptor, and the object. The
// Service's buildSummary delegates here so the same projection serves both the
// live collect path and the ingest Catalog-half projector (SummaryProjector), which
// runs before any Service exists. Keeping it one function guarantees the ingest
// path's Summaries are byte-identical to the paged LIST collect path's.
func summaryFromObject(clusterID string, desc Descriptor, item metav1.Object) Summary {
	creationTimestamp := ""
	if ts := item.GetCreationTimestamp(); !ts.IsZero() {
		creationTimestamp = ts.UTC().Format(time.RFC3339)
	}

	meta := metav1.ObjectMeta{
		DeletionTimestamp: item.GetDeletionTimestamp(),
		Finalizers:        item.GetFinalizers(),
	}
	deletionTime := int64(0)
	if meta.DeletionTimestamp != nil {
		deletionTime = meta.DeletionTimestamp.UnixMilli()
	}
	reportedStatuses, reportsStatus := reportedObjectStatuses(item)
	summary := Summary{
		Ref:               resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: clusterID, Group: desc.Group, Version: desc.Version, Kind: desc.Kind, Resource: desc.Resource, Namespace: item.GetNamespace(), Name: item.GetName(), UID: string(item.GetUID())}),
		Metadata:          catalogResourceMetadata(item),
		ResourceVersion:   item.GetResourceVersion(),
		CreationTimestamp: creationTimestamp,
		lifecycle:         resourcemodel.ObjectLifecycleWithFinalizers(meta, additionalObjectFinalizers(desc, item)),
		deletionTime:      deletionTime,
		reportedStatuses:  reportedStatuses,
		reportsStatus:     reportsStatus,
		Scope:             desc.Scope,
	}

	if digest := labelsDigest(item.GetLabels()); digest != "" {
		summary.LabelsDigest = digest
	}
	summary.ActionFacts = buildSummaryActionFacts(desc, item)
	if desc.GVR() == apiextensions.Identity.GVR() {
		summary.crdDefinition = catalogCRDDefinition(item)
	}

	return summary
}

func catalogCRDDefinition(item metav1.Object) *apiextensions.Definition {
	switch crd := item.(type) {
	case *apiextensionsv1.CustomResourceDefinition:
		definition := apiextensions.BuildDefinition(crd)
		return &definition
	case *unstructuredv1.Unstructured:
		definition, err := apiextensions.DefinitionFromUnstructured(crd)
		if err == nil {
			return &definition
		}
	}
	return nil
}

// reportedObjectStatuses reads the statuses an object reports for Attention, and whether
// its kind reports any. Argo CD Applications and ApplicationSets and Karpenter NodePools
// report them; they are read here because the catalog is the only source that watches
// custom resources with their full content.
func reportedObjectStatuses(item metav1.Object) (reportedStatusValues, bool) {
	object, ok := item.(*unstructuredv1.Unstructured)
	if !ok {
		return reportedStatusValues{}, false
	}
	if status, ok := argocd.ReportedAttentionStatus(object); ok {
		return newReportedStatusValues(map[string][]string{
			ReportedStatusSync:       reportedValue(status.Sync),
			ReportedStatusHealth:     reportedValue(status.Health),
			ReportedStatusOperation:  reportedValue(status.OperationPhase),
			ReportedStatusConditions: status.Conditions,
		}), true
	}
	if warnings, ok := karpenter.LimitWarnings(object); ok {
		return newReportedStatusValues(map[string][]string{ReportedStatusLimits: warnings}), true
	}
	return reportedStatusValues{}, false
}

func reportedValue(value string) []string {
	if value == "" {
		return nil
	}
	return []string{value}
}

func catalogResourceMetadata(item metav1.Object) *resourcemodel.ResourceTableMetadata {
	labels := item.GetLabels()
	annotations := item.GetAnnotations()
	if len(labels) == 0 && len(annotations) == 0 {
		return nil
	}
	return &resourcemodel.ResourceTableMetadata{
		Labels:      labels,
		Annotations: annotations,
	}
}

func additionalObjectFinalizers(desc Descriptor, item metav1.Object) []string {
	if desc.Group != "" || desc.Version != "v1" || desc.Kind != "Namespace" {
		return nil
	}
	switch namespace := item.(type) {
	case *corev1.Namespace:
		finalizers := make([]string, 0, len(namespace.Spec.Finalizers))
		for _, finalizer := range namespace.Spec.Finalizers {
			finalizers = append(finalizers, string(finalizer))
		}
		return finalizers
	case *unstructuredv1.Unstructured:
		finalizers, _, _ := unstructuredv1.NestedStringSlice(namespace.Object, "spec", "finalizers")
		return finalizers
	default:
		return nil
	}
}
