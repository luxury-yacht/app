package resourcemodel

import (
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
)

type ResourceRelationshipIndexOptions struct {
	Pods                *corev1.PodList
	RoleBindings        *rbacv1.RoleBindingList
	ClusterRoleBindings *rbacv1.ClusterRoleBindingList
}

type ResourceRelationshipIndex struct {
	configMapUsedBy                  map[namespacedName][]ResourceLink
	secretUsedBy                     map[namespacedName][]ResourceLink
	persistentVolumeClaimMountedBy   map[namespacedName][]ResourceLink
	serviceAccountUsedByPods         map[namespacedName][]ResourceLink
	roleUsedByBindings               map[namespacedName][]ResourceLink
	clusterRoleUsedByClusterBindings map[string][]ResourceLink
	clusterRoleUsedByRoleBindings    map[string][]ResourceLink
	serviceAccountRoleBindings       map[namespacedName][]ResourceLink
	serviceAccountClusterBindings    map[namespacedName][]ResourceLink
}

type namespacedName struct {
	namespace string
	name      string
}

func NewResourceRelationshipIndex(clusterID string, options ResourceRelationshipIndexOptions) *ResourceRelationshipIndex {
	idx := &ResourceRelationshipIndex{
		configMapUsedBy:                  map[namespacedName][]ResourceLink{},
		secretUsedBy:                     map[namespacedName][]ResourceLink{},
		persistentVolumeClaimMountedBy:   map[namespacedName][]ResourceLink{},
		serviceAccountUsedByPods:         map[namespacedName][]ResourceLink{},
		roleUsedByBindings:               map[namespacedName][]ResourceLink{},
		clusterRoleUsedByClusterBindings: map[string][]ResourceLink{},
		clusterRoleUsedByRoleBindings:    map[string][]ResourceLink{},
		serviceAccountRoleBindings:       map[namespacedName][]ResourceLink{},
		serviceAccountClusterBindings:    map[namespacedName][]ResourceLink{},
	}
	idx.indexPods(clusterID, options.Pods)
	idx.indexRoleBindings(clusterID, options.RoleBindings)
	idx.indexClusterRoleBindings(clusterID, options.ClusterRoleBindings)
	idx.sort()
	return idx
}

func (idx *ResourceRelationshipIndex) ConfigMapUsedBy(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.configMapUsedBy, namespace, name))
}

func (idx *ResourceRelationshipIndex) SecretUsedBy(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.secretUsedBy, namespace, name))
}

func (idx *ResourceRelationshipIndex) PersistentVolumeClaimMountedBy(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.persistentVolumeClaimMountedBy, namespace, name))
}

func (idx *ResourceRelationshipIndex) ServiceAccountUsedByPods(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.serviceAccountUsedByPods, namespace, name))
}

func (idx *ResourceRelationshipIndex) RoleUsedByBindings(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.roleUsedByBindings, namespace, name))
}

func (idx *ResourceRelationshipIndex) ClusterRoleUsedByClusterBindings(name string) []ResourceLink {
	return copyResourceLinks(idx.clusterRoleUsedByClusterBindings[name])
}

func (idx *ResourceRelationshipIndex) ClusterRoleUsedByRoleBindings(name string) []ResourceLink {
	return copyResourceLinks(idx.clusterRoleUsedByRoleBindings[name])
}

func (idx *ResourceRelationshipIndex) ServiceAccountRoleBindings(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.serviceAccountRoleBindings, namespace, name))
}

func (idx *ResourceRelationshipIndex) ServiceAccountClusterRoleBindings(namespace, name string) []ResourceLink {
	return copyResourceLinks(idx.links(idx.serviceAccountClusterBindings, namespace, name))
}

func (idx *ResourceRelationshipIndex) links(values map[namespacedName][]ResourceLink, namespace, name string) []ResourceLink {
	if idx == nil {
		return nil
	}
	return values[namespacedName{namespace: namespace, name: name}]
}

func (idx *ResourceRelationshipIndex) indexPods(clusterID string, pods *corev1.PodList) {
	if pods == nil {
		return
	}
	for _, pod := range pods.Items {
		podLink := podResourceLink(clusterID, pod)
		for name := range podConfigMapNames(pod) {
			appendUniqueLink(idx.configMapUsedBy, namespacedName{namespace: pod.Namespace, name: name}, podLink)
		}
		for name := range podSecretNames(pod) {
			appendUniqueLink(idx.secretUsedBy, namespacedName{namespace: pod.Namespace, name: name}, podLink)
		}
		for name := range podPersistentVolumeClaimNames(pod) {
			appendUniqueLink(idx.persistentVolumeClaimMountedBy, namespacedName{namespace: pod.Namespace, name: name}, podLink)
		}
		serviceAccountName := pod.Spec.ServiceAccountName
		if serviceAccountName == "" {
			serviceAccountName = "default"
		}
		appendUniqueLink(idx.serviceAccountUsedByPods, namespacedName{namespace: pod.Namespace, name: serviceAccountName}, podLink)
	}
}

func (idx *ResourceRelationshipIndex) indexRoleBindings(clusterID string, bindings *rbacv1.RoleBindingList) {
	if bindings == nil {
		return
	}
	for _, binding := range bindings.Items {
		link := rbacRoleBindingLink(clusterID, binding)
		switch binding.RoleRef.Kind {
		case "Role":
			appendUniqueLink(idx.roleUsedByBindings, namespacedName{namespace: binding.Namespace, name: binding.RoleRef.Name}, link)
		case "ClusterRole":
			idx.clusterRoleUsedByRoleBindings[binding.RoleRef.Name] = append(idx.clusterRoleUsedByRoleBindings[binding.RoleRef.Name], link)
		}
		for _, subject := range binding.Subjects {
			if subject.Kind != "ServiceAccount" || subject.Name == "" {
				continue
			}
			namespace := subject.Namespace
			if namespace == "" {
				namespace = binding.Namespace
			}
			appendUniqueLink(idx.serviceAccountRoleBindings, namespacedName{namespace: namespace, name: subject.Name}, link)
		}
	}
}

func (idx *ResourceRelationshipIndex) indexClusterRoleBindings(clusterID string, bindings *rbacv1.ClusterRoleBindingList) {
	if bindings == nil {
		return
	}
	for _, binding := range bindings.Items {
		link := rbacClusterRoleBindingLink(clusterID, binding)
		if binding.RoleRef.Kind == "ClusterRole" {
			idx.clusterRoleUsedByClusterBindings[binding.RoleRef.Name] = append(idx.clusterRoleUsedByClusterBindings[binding.RoleRef.Name], link)
		}
		for _, subject := range binding.Subjects {
			if subject.Kind != "ServiceAccount" || subject.Name == "" || subject.Namespace == "" {
				continue
			}
			appendUniqueLink(idx.serviceAccountClusterBindings, namespacedName{namespace: subject.Namespace, name: subject.Name}, link)
		}
	}
}

func (idx *ResourceRelationshipIndex) sort() {
	sortNamespacedLinkMap(idx.configMapUsedBy)
	sortNamespacedLinkMap(idx.secretUsedBy)
	sortNamespacedLinkMap(idx.persistentVolumeClaimMountedBy)
	sortNamespacedLinkMap(idx.serviceAccountUsedByPods)
	sortNamespacedLinkMap(idx.roleUsedByBindings)
	sortNamespacedLinkMap(idx.serviceAccountRoleBindings)
	sortNamespacedLinkMap(idx.serviceAccountClusterBindings)
	sortNamedLinkMap(idx.clusterRoleUsedByClusterBindings)
	sortNamedLinkMap(idx.clusterRoleUsedByRoleBindings)
}

func podPersistentVolumeClaimNames(pod corev1.Pod) map[string]struct{} {
	names := map[string]struct{}{}
	for _, volume := range pod.Spec.Volumes {
		if volume.PersistentVolumeClaim != nil && volume.PersistentVolumeClaim.ClaimName != "" {
			names[volume.PersistentVolumeClaim.ClaimName] = struct{}{}
		}
	}
	return names
}

func podConfigMapNames(pod corev1.Pod) map[string]struct{} {
	names := map[string]struct{}{}
	for _, volume := range pod.Spec.Volumes {
		if volume.ConfigMap != nil && volume.ConfigMap.Name != "" {
			names[volume.ConfigMap.Name] = struct{}{}
		}
		if volume.Projected != nil {
			for _, source := range volume.Projected.Sources {
				if source.ConfigMap != nil && source.ConfigMap.Name != "" {
					names[source.ConfigMap.Name] = struct{}{}
				}
			}
		}
	}
	addConfigMapNamesFromContainers(names, pod.Spec.Containers)
	addConfigMapNamesFromContainers(names, pod.Spec.InitContainers)
	for _, container := range pod.Spec.EphemeralContainers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name != "" {
				names[envFrom.ConfigMapRef.Name] = struct{}{}
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name != "" {
				names[env.ValueFrom.ConfigMapKeyRef.Name] = struct{}{}
			}
		}
	}
	return names
}

func addConfigMapNamesFromContainers(names map[string]struct{}, containers []corev1.Container) {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name != "" {
				names[envFrom.ConfigMapRef.Name] = struct{}{}
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name != "" {
				names[env.ValueFrom.ConfigMapKeyRef.Name] = struct{}{}
			}
		}
	}
}

func podSecretNames(pod corev1.Pod) map[string]struct{} {
	names := map[string]struct{}{}
	for _, volume := range pod.Spec.Volumes {
		if volume.Secret != nil && volume.Secret.SecretName != "" {
			names[volume.Secret.SecretName] = struct{}{}
		}
		if volume.Projected != nil {
			for _, source := range volume.Projected.Sources {
				if source.Secret != nil && source.Secret.Name != "" {
					names[source.Secret.Name] = struct{}{}
				}
			}
		}
	}
	for _, pullSecret := range pod.Spec.ImagePullSecrets {
		if pullSecret.Name != "" {
			names[pullSecret.Name] = struct{}{}
		}
	}
	addSecretNamesFromContainers(names, pod.Spec.Containers)
	addSecretNamesFromContainers(names, pod.Spec.InitContainers)
	for _, container := range pod.Spec.EphemeralContainers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.SecretRef != nil && envFrom.SecretRef.Name != "" {
				names[envFrom.SecretRef.Name] = struct{}{}
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name != "" {
				names[env.ValueFrom.SecretKeyRef.Name] = struct{}{}
			}
		}
	}
	return names
}

func addSecretNamesFromContainers(names map[string]struct{}, containers []corev1.Container) {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.SecretRef != nil && envFrom.SecretRef.Name != "" {
				names[envFrom.SecretRef.Name] = struct{}{}
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name != "" {
				names[env.ValueFrom.SecretKeyRef.Name] = struct{}{}
			}
		}
	}
}

func appendUniqueLink(values map[namespacedName][]ResourceLink, key namespacedName, link ResourceLink) {
	for _, existing := range values[key] {
		if resourceLinkSortKey(existing) == resourceLinkSortKey(link) {
			return
		}
	}
	values[key] = append(values[key], link)
}

func sortNamespacedLinkMap(values map[namespacedName][]ResourceLink) {
	for key := range values {
		sortResourceLinksByObjectName(values[key])
	}
}

func sortNamedLinkMap(values map[string][]ResourceLink) {
	for key := range values {
		sortResourceLinksByObjectName(values[key])
	}
}

func copyResourceLinks(links []ResourceLink) []ResourceLink {
	if len(links) == 0 {
		return nil
	}
	return append([]ResourceLink(nil), links...)
}
