package appwindow

// Capture the old native identities before returning to the backend mutation.
// Cleanup runs after that notification without nesting selection and window locks.
func (r *Registry) clusterRemoved(clusterID string) {
	windows := r.panels.Names(clusterID)
	if len(windows) == 0 {
		return
	}
	go func() {
		for _, name := range windows {
			if _, err := r.panels.Descriptor(name); err != nil {
				continue
			}
			r.reportPanelLifecycleError(r.AcknowledgePanelWindowClose(name), "close panel for removed cluster")
		}
	}()
}
