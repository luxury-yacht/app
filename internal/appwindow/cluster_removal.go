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
			// Not the renderer's acknowledgement, which a workspace switch refuses
			// for its destinations: a cluster that goes away closes its panel windows
			// whatever state they are in, and closing a destination aborts the switch.
			r.reportPanelLifecycleError(r.closePanelWindow(name, false), "close panel for removed cluster")
		}
	}()
}
