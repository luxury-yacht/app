package resourcestream

func (m *Manager) canListWatch(group, resource string) bool {
	return m.permissions == nil || m.permissions.CanListWatch(group, resource)
}
