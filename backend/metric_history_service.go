package backend

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/resources/common"
)

// MetricHistoryServiceDependencies are the narrow collaborators of the Metrics-tab owner. Context,
// Now, PermissionCheck and NewQuerier default to the real ones.
type MetricHistoryServiceDependencies struct {
	Repository metricSourceRepository
	// ServiceCatalog returns a connected cluster's object catalog, or nil when it is not connected.
	ServiceCatalog func(clusterID string) metricServiceCatalog
	// ResolveClusterDependencies returns a connected cluster's clients, or an error.
	ResolveClusterDependencies func(clusterID string) (common.Dependencies, string, error)
	Context                    func() context.Context
	Now                        func() time.Time
	PermissionCheck            func(context.Context, common.Dependencies, resourcePermissionCheck) error
	NewQuerier                 func(common.Dependencies, MetricInClusterTarget) metricQuerier
}

// MetricHistoryService owns the Metrics tab's sources, each cluster's source choice, the rules
// that keep them consistent, and reading history from them (docs/plans/metrics-history.md).
type MetricHistoryService struct {
	repository                 metricSourceRepository
	serviceCatalog             func(clusterID string) metricServiceCatalog
	resolveClusterDependencies func(clusterID string) (common.Dependencies, string, error)
	context                    func() context.Context
	now                        func() time.Time
	permissionCheck            func(context.Context, common.Dependencies, resourcePermissionCheck) error
	newQuerier                 func(common.Dependencies, MetricInClusterTarget) metricQuerier
}

// NewMetricHistoryService constructs the owner from its collaborators.
func NewMetricHistoryService(dependencies MetricHistoryServiceDependencies) *MetricHistoryService {
	service := &MetricHistoryService{
		repository:                 dependencies.Repository,
		serviceCatalog:             dependencies.ServiceCatalog,
		resolveClusterDependencies: dependencies.ResolveClusterDependencies,
		context:                    dependencies.Context,
		now:                        dependencies.Now,
		permissionCheck:            dependencies.PermissionCheck,
		newQuerier:                 dependencies.NewQuerier,
	}
	if service.resolveClusterDependencies == nil {
		service.resolveClusterDependencies = clusterDependenciesUnavailable
	}
	if service.context == nil {
		service.context = context.Background
	}
	if service.now == nil {
		service.now = time.Now
	}
	if service.permissionCheck == nil {
		service.permissionCheck = requireResourcePermission
	}
	if service.newQuerier == nil {
		service.newQuerier = newInClusterQuerier
	}
	return service
}

func clusterDependenciesUnavailable(clusterID string) (common.Dependencies, string, error) {
	return common.Dependencies{}, "", fmt.Errorf("cluster %s not active", clusterID)
}

var (
	errMetricSourceNotFound      = errors.New("metrics source not found")
	errMetricClusterNotConnected = errors.New("cluster is not connected; open it to choose a Service")
)

// serviceCandidatePageSize bounds each catalog read while the picker pages through every Service.
const serviceCandidatePageSize = 500

// GetMetricSourceSettings returns every source and every explicit cluster choice.
func (s *MetricHistoryService) GetMetricSourceSettings() (*MetricSourceSettings, error) {
	settings, err := s.repository.readMetricSourceSettings()
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

// ListMetricServiceCandidates lists the core Services of a connected cluster for the in-cluster
// source picker, from the object catalog that owns object existence.
func (s *MetricHistoryService) ListMetricServiceCandidates(clusterID string) ([]MetricServiceCandidate, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return nil, errors.New("cluster id is required")
	}
	var catalog metricServiceCatalog
	if s.serviceCatalog != nil {
		catalog = s.serviceCatalog(clusterID)
	}
	if catalog == nil {
		return nil, errMetricClusterNotConnected
	}
	candidates := []MetricServiceCandidate{}
	options := objectcatalog.QueryOptions{Kinds: []string{"Service"}, Groups: []string{"(core)"}, Limit: serviceCandidatePageSize}
	for {
		page := catalog.Query(options)
		for _, item := range page.Items {
			// The kind filter matches names, so CRDs that call themselves Service are dropped here too.
			if item.Ref.Group == "" {
				candidates = append(candidates, MetricServiceCandidate{Namespace: item.Ref.Namespace, Name: item.Ref.Name})
			}
		}
		if page.ContinueToken == "" {
			break
		}
		options.Continue = page.ContinueToken
	}
	slices.SortFunc(candidates, func(a, b MetricServiceCandidate) int {
		return cmp.Or(cmp.Compare(a.Namespace, b.Namespace), cmp.Compare(a.Name, b.Name))
	})
	return candidates, nil
}

// SaveMetricSource creates a source (empty ID) or replaces an existing one.
func (s *MetricHistoryService) SaveMetricSource(source MetricSource) (*MetricSource, error) {
	candidate, err := normalizeMetricSource(source)
	if err != nil {
		return nil, err
	}
	if _, err := s.repository.updateMetricSourceSettings(func(settings *MetricSourceSettings) error {
		return upsertMetricSource(settings, &candidate)
	}); err != nil {
		return nil, err
	}
	return &candidate, nil
}

// DeleteMetricSource removes a source and every cluster choice that names it; those clusters
// fall back to the default.
func (s *MetricHistoryService) DeleteMetricSource(sourceID string) error {
	_, err := s.repository.updateMetricSourceSettings(func(settings *MetricSourceSettings) error {
		index := metricSourceIndex(settings.Sources, sourceID)
		if index < 0 {
			return fmt.Errorf("%w: %s", errMetricSourceNotFound, sourceID)
		}
		settings.Sources = append(settings.Sources[:index], settings.Sources[index+1:]...)
		for clusterID, assignment := range settings.Assignments {
			if assignment.Kind == MetricAssignmentSource && assignment.SourceID == sourceID {
				delete(settings.Assignments, clusterID)
			}
		}
		return nil
	})
	return err
}

// SetClusterMetricAssignment records one cluster's choice. "default" removes the explicit choice.
func (s *MetricHistoryService) SetClusterMetricAssignment(clusterID string, assignment MetricClusterAssignment) error {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return errors.New("cluster id is required")
	}
	_, err := s.repository.updateMetricSourceSettings(func(settings *MetricSourceSettings) error {
		return applyClusterMetricAssignment(settings, clusterID, assignment)
	})
	return err
}

func applyClusterMetricAssignment(settings *MetricSourceSettings, clusterID string, assignment MetricClusterAssignment) error {
	switch assignment.Kind {
	case MetricAssignmentDefault:
		delete(settings.Assignments, clusterID)
	case MetricAssignmentNone:
		settings.Assignments[clusterID] = MetricClusterAssignment{Kind: MetricAssignmentNone}
	case MetricAssignmentSource:
		index := metricSourceIndex(settings.Sources, assignment.SourceID)
		if index < 0 {
			return fmt.Errorf("%w: %s", errMetricSourceNotFound, assignment.SourceID)
		}
		if target := settings.Sources[index].InCluster; target != nil && target.ClusterID != clusterID {
			return fmt.Errorf("in-cluster source %q serves only cluster %s", settings.Sources[index].Name, target.ClusterID)
		}
		settings.Assignments[clusterID] = MetricClusterAssignment{Kind: MetricAssignmentSource, SourceID: assignment.SourceID}
	default:
		return fmt.Errorf("unknown metrics assignment %q", assignment.Kind)
	}
	return nil
}

func upsertMetricSource(settings *MetricSourceSettings, candidate *MetricSource) error {
	for _, existing := range settings.Sources {
		if existing.ID != candidate.ID && strings.EqualFold(existing.Name, candidate.Name) {
			return fmt.Errorf("a metrics source named %q already exists", existing.Name)
		}
	}
	if candidate.ID == "" {
		id, err := newMetricSourceID()
		if err != nil {
			return err
		}
		candidate.ID = id
		settings.Sources = append(settings.Sources, *candidate)
		return nil
	}
	index := metricSourceIndex(settings.Sources, candidate.ID)
	if index < 0 {
		return fmt.Errorf("%w: %s", errMetricSourceNotFound, candidate.ID)
	}
	if stranded := clustersStrandedByMove(settings.Assignments, *candidate); len(stranded) > 0 {
		return fmt.Errorf("source %q is assigned to %s; an in-cluster source can serve only its own cluster", candidate.Name, strings.Join(stranded, ", "))
	}
	settings.Sources[index] = *candidate
	return nil
}

// clustersStrandedByMove lists clusters assigned to the source that its new target no longer serves.
func clustersStrandedByMove(assignments map[string]MetricClusterAssignment, source MetricSource) []string {
	var stranded []string
	for clusterID, assignment := range assignments {
		if assignment.Kind == MetricAssignmentSource && assignment.SourceID == source.ID && clusterID != source.InCluster.ClusterID {
			stranded = append(stranded, clusterID)
		}
	}
	return stranded
}

func metricSourceIndex(sources []MetricSource, sourceID string) int {
	for index, source := range sources {
		if source.ID == sourceID {
			return index
		}
	}
	return -1
}

func newMetricSourceID() (string, error) {
	raw := make([]byte, 8)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate metrics source id: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

// normalizeMetricSource trims and validates a source so only queryable sources are persisted.
func normalizeMetricSource(source MetricSource) (MetricSource, error) {
	source.ID = strings.TrimSpace(source.ID)
	source.Name = strings.TrimSpace(source.Name)
	if source.Name == "" {
		return MetricSource{}, errors.New("a metrics source needs a name")
	}
	return normalizeMetricConnection(source)
}

// normalizeMetricConnection validates how a source is reached; its name does not matter here.
func normalizeMetricConnection(source MetricSource) (MetricSource, error) {
	if source.Mode != MetricSourceModeInCluster {
		return MetricSource{}, fmt.Errorf("unsupported metrics source mode %q", source.Mode)
	}
	if source.InCluster == nil {
		return MetricSource{}, errors.New("an in-cluster source needs a Service to query")
	}
	target, err := normalizeInClusterTarget(*source.InCluster)
	if err != nil {
		return MetricSource{}, err
	}
	source.InCluster = &target
	return source, nil
}

func normalizeInClusterTarget(target MetricInClusterTarget) (MetricInClusterTarget, error) {
	target.ClusterID = strings.TrimSpace(target.ClusterID)
	target.Namespace = strings.TrimSpace(target.Namespace)
	target.Service = strings.TrimSpace(target.Service)
	target.Port = strings.TrimSpace(target.Port)
	for field, value := range map[string]string{
		"cluster": target.ClusterID, "namespace": target.Namespace, "service": target.Service, "port": target.Port,
	} {
		if value == "" {
			return MetricInClusterTarget{}, fmt.Errorf("an in-cluster source needs a %s", field)
		}
	}
	target.Scheme = strings.ToLower(strings.TrimSpace(target.Scheme))
	if target.Scheme == "" {
		target.Scheme = "http"
	}
	if target.Scheme != "http" && target.Scheme != "https" {
		return MetricInClusterTarget{}, fmt.Errorf("unsupported scheme %q: use http or https", target.Scheme)
	}
	prefix, err := normalizePathPrefix(target.PathPrefix)
	if err != nil {
		return MetricInClusterTarget{}, err
	}
	target.PathPrefix = prefix
	return target, nil
}

// normalizePathPrefix returns "" or a "/segment" path without a trailing slash, query, or fragment.
func normalizePathPrefix(prefix string) (string, error) {
	prefix = strings.Trim(strings.TrimSpace(prefix), "/")
	if prefix == "" {
		return "", nil
	}
	if strings.ContainsAny(prefix, "?# \t") {
		return "", fmt.Errorf("path prefix %q must be a plain path", prefix)
	}
	return "/" + prefix, nil
}
