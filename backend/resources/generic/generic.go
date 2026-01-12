package generic

import (
	"context"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

type Service struct {
	deps common.Dependencies
}

func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Delete removes a Kubernetes resource by kind/namespace/name using the dynamic client.
func (s *Service) Delete(resourceKind, namespace, name string) error {
	if s.deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client not initialized")
	}

	gvr, err := s.groupVersionResource(resourceKind)
	if err != nil {
		gvr, err = s.discoverGroupVersionResource(resourceKind)
		if err != nil {
			s.logError(fmt.Sprintf("Failed to resolve GVR for %s: %v", resourceKind, err))
			return fmt.Errorf("unsupported resource type: %s", resourceKind)
		}
	}

	dynamicClient, err := s.dynamicClient()
	if err != nil {
		s.logError(fmt.Sprintf("Failed to create dynamic client: %v", err))
		return fmt.Errorf("failed to create dynamic client: %w", err)
	}

	ctx := s.context()
	var deleteErr error
	if namespace == "" {
		deleteErr = dynamicClient.Resource(gvr).Delete(ctx, name, metav1.DeleteOptions{})
	} else {
		deleteErr = dynamicClient.Resource(gvr).Namespace(namespace).Delete(ctx, name, metav1.DeleteOptions{})
	}

	if deleteErr != nil {
		s.logError(fmt.Sprintf("Failed to delete %s %s/%s: %v", resourceKind, namespace, name, deleteErr))
		return fmt.Errorf("failed to delete %s: %w", resourceKind, deleteErr)
	}

	if namespace == "" {
		s.logInfo(fmt.Sprintf("Deleted %s %s", resourceKind, name))
	} else {
		s.logInfo(fmt.Sprintf("Deleted %s %s/%s", resourceKind, namespace, name))
	}

	return nil
}

func (s *Service) groupVersionResource(resourceKind string) (schema.GroupVersionResource, error) {
	rt := strings.ToLower(resourceKind)

	coreResources := map[string]schema.GroupVersionResource{
		"pod":                    {Group: "", Version: "v1", Resource: "pods"},
		"pods":                   {Group: "", Version: "v1", Resource: "pods"},
		"service":                {Group: "", Version: "v1", Resource: "services"},
		"services":               {Group: "", Version: "v1", Resource: "services"},
		"configmap":              {Group: "", Version: "v1", Resource: "configmaps"},
		"configmaps":             {Group: "", Version: "v1", Resource: "configmaps"},
		"secret":                 {Group: "", Version: "v1", Resource: "secrets"},
		"secrets":                {Group: "", Version: "v1", Resource: "secrets"},
		"persistentvolumeclaim":  {Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
		"persistentvolumeclaims": {Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
		"pvc":                    {Group: "", Version: "v1", Resource: "persistentvolumeclaims"},
		"persistentvolume":       {Group: "", Version: "v1", Resource: "persistentvolumes"},
		"persistentvolumes":      {Group: "", Version: "v1", Resource: "persistentvolumes"},
		"pv":                     {Group: "", Version: "v1", Resource: "persistentvolumes"},
		"namespace":              {Group: "", Version: "v1", Resource: "namespaces"},
		"namespaces":             {Group: "", Version: "v1", Resource: "namespaces"},
		"node":                   {Group: "", Version: "v1", Resource: "nodes"},
		"nodes":                  {Group: "", Version: "v1", Resource: "nodes"},
		"serviceaccount":         {Group: "", Version: "v1", Resource: "serviceaccounts"},
		"serviceaccounts":        {Group: "", Version: "v1", Resource: "serviceaccounts"},
		"limitrange":             {Group: "", Version: "v1", Resource: "limitranges"},
		"limitranges":            {Group: "", Version: "v1", Resource: "limitranges"},
		"resourcequota":          {Group: "", Version: "v1", Resource: "resourcequotas"},
		"resourcequotas":         {Group: "", Version: "v1", Resource: "resourcequotas"},
		"event":                  {Group: "", Version: "v1", Resource: "events"},
		"events":                 {Group: "", Version: "v1", Resource: "events"},
	}

	appsResources := map[string]schema.GroupVersionResource{
		"deployment":   {Group: "apps", Version: "v1", Resource: "deployments"},
		"deployments":  {Group: "apps", Version: "v1", Resource: "deployments"},
		"statefulset":  {Group: "apps", Version: "v1", Resource: "statefulsets"},
		"statefulsets": {Group: "apps", Version: "v1", Resource: "statefulsets"},
		"daemonset":    {Group: "apps", Version: "v1", Resource: "daemonsets"},
		"daemonsets":   {Group: "apps", Version: "v1", Resource: "daemonsets"},
		"replicaset":   {Group: "apps", Version: "v1", Resource: "replicasets"},
		"replicasets":  {Group: "apps", Version: "v1", Resource: "replicasets"},
	}

	batchResources := map[string]schema.GroupVersionResource{
		"job":      {Group: "batch", Version: "v1", Resource: "jobs"},
		"jobs":     {Group: "batch", Version: "v1", Resource: "jobs"},
		"cronjob":  {Group: "batch", Version: "v1", Resource: "cronjobs"},
		"cronjobs": {Group: "batch", Version: "v1", Resource: "cronjobs"},
	}

	networkingResources := map[string]schema.GroupVersionResource{
		"ingress":         {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
		"ingresses":       {Group: "networking.k8s.io", Version: "v1", Resource: "ingresses"},
		"networkpolicy":   {Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"},
		"networkpolicies": {Group: "networking.k8s.io", Version: "v1", Resource: "networkpolicies"},
	}

	rbacResources := map[string]schema.GroupVersionResource{
		"role":                {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"},
		"roles":               {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "roles"},
		"rolebinding":         {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"},
		"rolebindings":        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "rolebindings"},
		"clusterrole":         {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"},
		"clusterroles":        {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterroles"},
		"clusterrolebinding":  {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"},
		"clusterrolebindings": {Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings"},
	}

	autoscalingResources := map[string]schema.GroupVersionResource{
		"horizontalpodautoscaler":  {Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
		"horizontalpodautoscalers": {Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
		"hpa":                      {Group: "autoscaling", Version: "v2", Resource: "horizontalpodautoscalers"},
	}

	policyResources := map[string]schema.GroupVersionResource{
		"poddisruptionbudget":  {Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"},
		"poddisruptionbudgets": {Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"},
		"pdb":                  {Group: "policy", Version: "v1", Resource: "poddisruptionbudgets"},
	}

	storageResources := map[string]schema.GroupVersionResource{
		"storageclass":   {Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"},
		"storageclasses": {Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"},
		"sc":             {Group: "storage.k8s.io", Version: "v1", Resource: "storageclasses"},
	}

	admissionResources := map[string]schema.GroupVersionResource{
		"mutatingwebhookconfiguration":    {Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"},
		"mutatingwebhookconfigurations":   {Group: "admissionregistration.k8s.io", Version: "v1", Resource: "mutatingwebhookconfigurations"},
		"validatingwebhookconfiguration":  {Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"},
		"validatingwebhookconfigurations": {Group: "admissionregistration.k8s.io", Version: "v1", Resource: "validatingwebhookconfigurations"},
	}

	apiExtensionsResources := map[string]schema.GroupVersionResource{
		"customresourcedefinition":  {Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		"customresourcedefinitions": {Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		"crd":                       {Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
		"crds":                      {Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"},
	}

	resourceSets := []map[string]schema.GroupVersionResource{
		coreResources,
		appsResources,
		batchResources,
		networkingResources,
		rbacResources,
		autoscalingResources,
		policyResources,
		storageResources,
		admissionResources,
		apiExtensionsResources,
	}

	for _, resources := range resourceSets {
		if gvr, found := resources[rt]; found {
			return gvr, nil
		}
	}

	return schema.GroupVersionResource{}, fmt.Errorf("unsupported resource type: %s", resourceKind)
}

func (s *Service) discoverGroupVersionResource(resourceKind string) (schema.GroupVersionResource, error) {
	if s.deps.KubernetesClient == nil {
		return schema.GroupVersionResource{}, fmt.Errorf("kubernetes client not initialized")
	}

	discoveryClient := s.deps.KubernetesClient.Discovery()
	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && apiResourceLists == nil {
		return schema.GroupVersionResource{}, fmt.Errorf("failed to get server resources: %w", err)
	}
	if len(apiResourceLists) == 0 {
		// Some fake discovery clients (client-go) leave ServerPreferredResources unimplemented.
		if _, lists, altErr := discoveryClient.ServerGroupsAndResources(); altErr == nil && len(lists) > 0 {
			apiResourceLists = lists
		}
	}

	searchType := strings.ToLower(resourceKind)
	searchTypePlural := searchType
	if !strings.HasSuffix(searchType, "s") {
		searchTypePlural = searchType + "s"
	}

	for _, apiResourceList := range apiResourceLists {
		gv, err := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if err != nil {
			continue
		}

		for _, apiResource := range apiResourceList.APIResources {
			if strings.EqualFold(apiResource.Kind, resourceKind) {
				return schema.GroupVersionResource{Group: gv.Group, Version: gv.Version, Resource: apiResource.Name}, nil
			}
			if strings.EqualFold(apiResource.Name, searchType) || strings.EqualFold(apiResource.Name, searchTypePlural) {
				return schema.GroupVersionResource{Group: gv.Group, Version: gv.Version, Resource: apiResource.Name}, nil
			}
			if apiResource.SingularName != "" && strings.EqualFold(apiResource.SingularName, searchType) {
				return schema.GroupVersionResource{Group: gv.Group, Version: gv.Version, Resource: apiResource.Name}, nil
			}
		}
	}

	return schema.GroupVersionResource{}, fmt.Errorf("resource type '%s' not found in cluster", resourceKind)
}

func (s *Service) dynamicClient() (dynamic.Interface, error) {
	if s.deps.DynamicClient != nil {
		return s.deps.DynamicClient, nil
	}
	if s.deps.RestConfig == nil {
		return nil, fmt.Errorf("rest config not initialized")
	}
	return dynamic.NewForConfig(s.deps.RestConfig)
}

func (s *Service) context() context.Context {
	if s.deps.Context != nil {
		return s.deps.Context
	}
	return context.Background()
}

func (s *Service) logInfo(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Info(msg, "GenericResource")
	}
}

func (s *Service) logError(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Error(msg, "GenericResource")
	}
}
