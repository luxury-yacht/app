/*
 * backend/objectcatalog/collect.go
 *
 * Catalog collection and informer integration.
 */

package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	unstructuredv1 "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

func (s *Service) collectResource(ctx context.Context, index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, error) {
	// Ingest-owned (cut) kinds are no longer cached by the shared informer factory;
	// their Summaries come from the ingest manager (projected at intake) instead of a
	// shared/dynamic lister, for every namespace scope.
	if summaries, handled, err := s.collectViaIngest(index, desc, namespaces, agg); handled {
		return summaries, err
	}
	if summaries, handled, err := s.collectViaSharedInformer(index, desc, namespaces, agg); handled {
		return summaries, err
	}
	summaries, err := s.listResource(ctx, index, desc, namespaces, agg)
	if err != nil {
		return nil, err
	}
	if planCollectionSource(desc).promotable {
		s.maybePromote(desc, len(summaries))
	}
	return summaries, nil
}

func (s *Service) collectViaSharedInformer(index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, bool, error) {
	plan := planCollectionSource(desc)
	switch plan.source {
	case collectionSourceSkip:
		return nil, true, nil
	case collectionSourceAPIExtensionsInformer:
		if s.deps.APIExtensionsInformerFactory == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		lister := s.deps.APIExtensionsInformerFactory.Apiextensions().V1().CustomResourceDefinitions().Lister()
		items, err := lister.List(labels.Everything())
		if err != nil {
			return emitSummaries(index, agg, nil, err, true)
		}
		return emitSummaries(index, agg, s.summariesFromObjects(desc, toMetaObjects(items)), nil, true)
	case collectionSourceSharedInformer:
		factory := s.deps.InformerFactory
		if factory == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		gr := plan.groupResource
		// Check permissions before accessing shared informer listers to avoid triggering
		// lazy informer creation for resources the user cannot list/watch.
		if s.deps.PermissionChecker != nil && !s.deps.PermissionChecker.CanListWatch(gr.Group, gr.Resource) {
			// No permission - fall back to listResource which handles 403 gracefully
			return emitSummaries(index, agg, nil, nil, false)
		}
		listFn := sharedInformerLister(factory, sharedInformerGroupResources[gr])
		if listFn == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, listFn)
		return emitSummaries(index, agg, summaries, err, true)
	case collectionSourceGatewayInformer:
		if s.deps.GatewayInformerFactory == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		listFn := gatewayInformerLister(s.deps.GatewayInformerFactory, gatewayInformerGroupResources[plan.groupResource])
		if listFn == nil {
			return emitSummaries(index, agg, nil, nil, false)
		}
		summaries, err := s.collectFromNamespacedLister(desc, namespaces, listFn)
		return emitSummaries(index, agg, summaries, err, true)
	default:
		return emitSummaries(index, agg, nil, nil, false)
	}
}

func (s *Service) collectFromNamespacedLister(desc resourceDescriptor, namespaces []string, list func(namespace string) ([]metav1.Object, error)) ([]Summary, error) {
	targets := listTargets(desc, namespaces)
	summaries := make([]Summary, 0)
	for _, ns := range targets {
		objects, err := list(ns)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, s.summariesFromObjects(desc, objects)...)
	}
	return summaries, nil
}

func (s *Service) summariesFromObjects(desc resourceDescriptor, objs []metav1.Object) []Summary {
	if len(objs) == 0 {
		return nil
	}
	result := make([]Summary, 0, len(objs))
	for _, obj := range objs {
		if obj == nil {
			continue
		}
		result = append(result, s.buildSummary(desc, obj))
	}
	return result
}

func (s *Service) listResource(ctx context.Context, index int, desc resourceDescriptor, namespaces []string, agg *streamingAggregator) ([]Summary, error) {
	dynamicClient := s.deps.Common.DynamicClient
	if dynamicClient == nil {
		return nil, errors.New("dynamic client not available")
	}

	namespaceable := dynamicClient.Resource(desc.GVR)
	var targets []string
	if desc.Namespaced && len(namespaces) > 0 {
		targets = uniqueNamespaces(namespaces)
		if len(targets) == 0 {
			return nil, nil
		}
	} else if desc.Namespaced {
		targets = []string{metav1.NamespaceAll}
	} else {
		targets = []string{""}
	}

	if len(targets) == 0 {
		return nil, nil
	}

	if desc.Namespaced && len(targets) > 1 && s.namespaceWorkerLimit(len(targets)) > 1 {
		return s.listResourceNamespacedParallel(ctx, index, namespaceable, desc, targets, agg)
	}

	return s.listResourceSequential(ctx, index, namespaceable, desc, targets, agg)
}

func (s *Service) listResourceSequential(ctx context.Context, index int, namespaceable dynamic.NamespaceableResourceInterface, desc resourceDescriptor, targets []string, agg *streamingAggregator) ([]Summary, error) {
	results := make([]Summary, 0)
	for _, target := range targets {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		resourceInterface := resourceInterfaceForTarget(namespaceable, desc.Namespaced, target)
		items, err := s.listNamespaceItems(ctx, index, desc, resourceInterface, agg)
		if err != nil {
			return nil, err
		}
		if len(items) > 0 {
			results = append(results, items...)
		}
	}
	return results, nil
}

func (s *Service) listResourceNamespacedParallel(ctx context.Context, index int, namespaceable dynamic.NamespaceableResourceInterface, desc resourceDescriptor, targets []string, agg *streamingAggregator) ([]Summary, error) {
	results := make([]Summary, 0)
	var mu sync.Mutex
	limit := s.namespaceWorkerLimit(len(targets))
	err := parallel.ForEach(ctx, targets, limit, func(taskCtx context.Context, target string) error {
		resourceInterface := resourceInterfaceForTarget(namespaceable, true, target)
		items, err := s.listNamespaceItems(taskCtx, index, desc, resourceInterface, agg)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		mu.Lock()
		results = append(results, items...)
		mu.Unlock()
		return nil
	})
	if err != nil {
		return nil, err
	}
	return results, nil
}

func (s *Service) listNamespaceItems(ctx context.Context, index int, desc resourceDescriptor, resourceInterface dynamic.ResourceInterface, agg *streamingAggregator) ([]Summary, error) {
	batchSize := s.opts.PageSize
	if s.opts.StreamingBatchSize > 0 && s.opts.StreamingBatchSize < batchSize {
		batchSize = s.opts.StreamingBatchSize
	}
	options := metav1.ListOptions{Limit: int64(batchSize)}
	results := make([]Summary, 0)
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		var list *unstructuredv1.UnstructuredList
		var err error
		for attempt := range config.ObjectCatalogListRetryMaxAttempts {
			list, err = resourceInterface.List(ctx, options)
			if err == nil {
				break
			}
			if apierrors.IsForbidden(err) {
				// Record the denial so the catalog can report WHY the type is
				// missing — an RBAC-blocked catalog must not look like an
				// empty cluster.
				s.recordDeniedResource(deniedResourceName(desc))
				s.logDebug(fmt.Sprintf("permission denied listing %s, skipping", desc.GVR.String()))
				return results, nil
			}
			if !shouldRetryList(err) || attempt == config.ObjectCatalogListRetryMaxAttempts-1 {
				return nil, err
			}
			delay := listRetryBackoff(attempt)
			s.logDebug(fmt.Sprintf("retrying list for %s after error: %v (backoff=%s)", desc.GVR.String(), err, delay))
			if err := timeutil.SleepWithContext(ctx, delay); err != nil {
				return nil, err
			}
		}
		if list == nil {
			return results, nil
		}

		page := make([]Summary, 0, len(list.Items))
		for i := range list.Items {
			item := &list.Items[i]
			page = append(page, s.buildSummary(desc, item))
		}
		if len(page) > 0 {
			results = append(results, page...)
			if agg != nil {
				agg.emit(index, page)
			}
		}

		cont := list.GetContinue()
		if cont == "" {
			break
		}
		options.Continue = cont
	}
	return results, nil
}

// deniedResourceName renders a kubectl-style resource name (`resource[.group]`)
// for permission diagnostics.
func deniedResourceName(desc resourceDescriptor) string {
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

// maybePromote consolidates a dynamic (CRD-backed) kind onto the one ingest path once its
// object count crosses the promotion threshold: it registers an on-demand dynamic reflector
// with the ingest manager (which LIST+WATCHes the kind and projects each object to the same
// Summary buildSummary produces) plus a Catalog-half sink for incremental updates, then
// records the gvr so collectViaIngest serves it once the reflector has synced. Below the
// threshold — or with no ingest source — the kind keeps being listed per collect, so a
// reflector is only ever created on demand. The projection IS buildSummary, so the
// ingest-served Summaries are byte-identical to the list path's.
func (s *Service) maybePromote(desc resourceDescriptor, itemCount int) {
	if s.opts.InformerPromotionThreshold <= 0 || itemCount < s.opts.InformerPromotionThreshold {
		return
	}
	source := s.deps.IngestSource
	if source == nil {
		return
	}
	gvr := desc.GVR
	if s.isDynamicallyIngested(gvr) {
		return
	}
	gvk := schema.GroupVersionKind{Group: desc.Group, Version: desc.Version, Kind: desc.Kind}
	project := func(obj metav1.Object) interface{} { return s.buildSummary(desc, obj) }
	if !source.RegisterDynamicCatalogReflector(gvr, gvk, project) {
		return
	}
	source.AddCatalogSink(gvr, ingestCatalogSink{service: s, gvr: gvr})
	s.markDynamicallyIngested(gvr)
	s.logInfo(fmt.Sprintf("catalog descriptor %s promoted to the ingest path", gvr.String()))
}

// isDynamicallyIngested reports whether the catalog has promoted gvr onto the ingest path.
func (s *Service) isDynamicallyIngested(gvr schema.GroupVersionResource) bool {
	s.dynamicMu.RLock()
	defer s.dynamicMu.RUnlock()
	_, ok := s.dynamicIngested[gvr]
	return ok
}

// markDynamicallyIngested records that gvr now serves from the ingest path.
func (s *Service) markDynamicallyIngested(gvr schema.GroupVersionResource) {
	s.dynamicMu.Lock()
	defer s.dynamicMu.Unlock()
	s.dynamicIngested[gvr] = struct{}{}
}

// stopDynamicReflectors tears down every on-demand dynamic reflector the catalog promoted,
// asking the ingest manager to stop each, so the reflectors do not outlive the catalog. It
// is a no-op when no kind was promoted or no ingest source is configured.
func (s *Service) stopDynamicReflectors() {
	source := s.deps.IngestSource
	s.dynamicMu.Lock()
	gvrs := make([]schema.GroupVersionResource, 0, len(s.dynamicIngested))
	for gvr := range s.dynamicIngested {
		gvrs = append(gvrs, gvr)
	}
	s.dynamicIngested = make(map[schema.GroupVersionResource]struct{})
	s.dynamicMu.Unlock()
	if source == nil {
		return
	}
	for _, gvr := range gvrs {
		source.StopReflectorFor(gvr)
	}
}

func (s *Service) buildSummary(desc resourceDescriptor, item metav1.Object) Summary {
	return summaryFromObject(s.clusterID, s.clusterName, desc, item)
}

// summaryFromObject is the catalog's pure object → Summary projection: it depends
// only on the cluster identity, the resource descriptor, and the object. The
// Service's buildSummary delegates here so the same projection serves both the
// live collect path and the ingest Catalog-half projector (SummaryProjector), which
// runs before any Service exists. Keeping it one function guarantees the ingest
// path's Summaries are byte-identical to the shared-informer collect path's.
func summaryFromObject(clusterID, clusterName string, desc resourceDescriptor, item metav1.Object) Summary {
	creationTimestamp := ""
	if ts := item.GetCreationTimestamp(); !ts.IsZero() {
		creationTimestamp = ts.UTC().Format(time.RFC3339)
	}

	summary := Summary{
		ClusterID:         clusterID,
		ClusterName:       clusterName,
		Kind:              desc.Kind,
		Group:             desc.Group,
		Version:           desc.Version,
		Resource:          desc.Resource,
		Namespace:         item.GetNamespace(),
		Name:              item.GetName(),
		UID:               string(item.GetUID()),
		ResourceVersion:   item.GetResourceVersion(),
		CreationTimestamp: creationTimestamp,
		Scope:             desc.Scope,
	}

	if digest := labelsDigest(item.GetLabels()); digest != "" {
		summary.LabelsDigest = digest
	}
	summary.ActionFacts = buildSummaryActionFacts(desc, item)

	return summary
}
