### Added

### Changed

- On the object map, the mouse wheel now zooms in and out around the pointer instead of scrolling the map. Trackpad two-finger scrolling zooms too; drag the background to move the map.
- NetworkPolicy details now draw each ingress and egress rule as a flow: the allowed sources lead to the policy's pods (or the pods lead to the allowed destinations), with the rule's ports on the arrow. Each rule is its own card, colored blue for ingress and purple for egress, with the policy's own pods outlined in the same color. Each source is its own box that reads as a sentence, such as "All pods in namespace groundcover", so separate boxes are alternatives and the namespace and pod selectors inside one box apply together. A namespace selected by its name label shows the namespace name instead of the raw selector. Addresses an IP range excludes are shown as red exclusion chips. A direction the policy blocks entirely is shown as denied, and a direction with no rules in the policy says so.
- Ingress, HTTPRoute, GRPCRoute, and TLSRoute details now show their rules in the same flow layout as NetworkPolicy: each request match leads to its backend, with ports, and for routes that split traffic, each backend's share.
- Service details show the Service's ports flowing to the pods its selector picks. Each port chip gives its name, protocol, Service port and target port, and its node port, and the pods show their ready and not-ready counts. A new DNS name row shows the in-cluster name, a headless Service notes that its DNS name returns pod IPs, and an ExternalName Service shows the external host it aliases.

### Fixed

- HTTPRoute and GRPCRoute details no longer reduce a rule's matches to a single path or method. Path match type, method, headers, and query parameters are all shown, and route backends show their port and weight.
- NetworkPolicy details no longer drop selector expressions such as `In` or `DoesNotExist`, and no longer show an empty selector, which matches every namespace or pod, as blank.
