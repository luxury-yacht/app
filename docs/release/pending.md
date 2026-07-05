### Fixed

- The Pods tab for a Deployment or ReplicaSet could show "No pods found" due to a race condition involving the deployment's replicaset. Pod ownership is now re-resolved if the ReplicaSet arrives after the pods, so the tab fills in correctly.
- With several panels of the same kind open at once (for example two Deployments), closing one could silently stop the other's Details and Events from auto-refreshing. Each panel now tracks its refresh independently.
- The Pods tab inside an object panel only received live updates while the app's main view was that namespace's Pods view — on any other view it froze after the first load, eventually showing "Awaiting metrics data...". The panel's pod list now streams updates regardless of which main view is active.
