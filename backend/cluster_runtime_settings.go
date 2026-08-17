package backend

func (m *ClusterRuntimeManager) SetKubernetesClientRateLimits(qps, burst int) {
	if m != nil {
		m.applyKubernetesClientRateLimits(qps, burst)
	}
}
