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
			// The window closes without answering anything it was asked.
			r.rendererLost(name)
			_, err := r.closePanelWindow(name)
			r.reportPanelLifecycleError(err, "close panel for removed cluster")
		}
	}()
}
