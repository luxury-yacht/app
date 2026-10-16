### Added

### Changed

- Object maps:
  - A workload's map now shows the Services, EndpointSlices, PodDisruptionBudgets, NetworkPolicies, and Ingresses around its Pods.
  - Maps build much faster on large clusters: about 70 ms instead of about 760 ms at 10,000 Pods.
  - Nodes you drag stay where you drop them through kind filters, focus mode, and live updates. Reset layout puts them back.
  - When a large namespace map is cut to its object limit, it keeps connected objects and their cluster-scoped neighbors, such as the Node a Pod runs on.
- Windows executables and installers are now signed! Thank you to the [SignPath Foundation](https://signpath.org/) for providing free code signing and certificates for open-source projects like Luxury Yacht.

### Fixed

- Object maps:
  - Custom resources that share a built-in kind name, such as an Istio Gateway or a Calico NetworkPolicy, no longer offer a map that can't show anything.
  - Users who can read only RBAC objects can open object maps.
  - An empty map still shows which kinds were skipped for missing permissions.
  - HorizontalPodAutoscaler maps open when the cluster lists HPAs as `autoscaling/v1`.
