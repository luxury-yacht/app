### Added

### Changed

- Object maps:
  - Maps follow one predictable rule: an object appears if links that all point the same way connect it to the object you opened the map for. There are no depth limits or special cases, and every link between objects on the map is drawn. Use the namespace map to see everything in a namespace.
  - Maps show only the relationships Kubernetes keeps. A Service reaches its Pods through its EndpointSlices, and PodDisruptionBudgets and NetworkPolicies link to the Pods they select. Open a Pod's map to see the Services, PDBs, and NetworkPolicies that act on it.
  - Maps build much faster on large clusters: about 60 ms instead of about 760 ms at 10,000 Pods.
  - Nodes you drag stay where you drop them through kind filters, focus mode, and live updates. Reset layout puts them back.
  - When a large namespace map is cut to its object limit, it keeps connected objects and their cluster-scoped neighbors, such as the Node a Pod runs on.
- Windows executables and installers are now signed! Thank you to the [SignPath Foundation](https://signpath.org/) for providing free code signing and certificates for open-source projects like Luxury Yacht.

### Fixed

- Object maps:
  - Custom resources that share a built-in kind name, such as an Istio Gateway or a Calico NetworkPolicy, no longer offer a map that can't show anything.
  - Users who can read only RBAC objects can open object maps.
  - An empty map still shows which kinds were skipped for missing permissions.
  - HorizontalPodAutoscaler maps open when the cluster lists HPAs as `autoscaling/v1`.
