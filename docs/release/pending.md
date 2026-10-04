### Added

- Attention flags a Karpenter NodePool whose nodes use more than 80% of its CPU or memory limit (`spec.limits`), as "Karpenter NodePool near its limits". It uses the same calculation and threshold as the warning color in the Karpenter table and NodePool details.
- Attention flags Argo CD Applications and ApplicationSets that need a look. Errors: an Application whose health is Degraded ("Argo CD Application degraded"), whose last sync failed ("Argo CD Application sync failed"), or that reports an error condition such as a ComparisonError when Argo CD cannot render or compare it ("Argo CD Application error"), and an ApplicationSet whose generator or template is failing ("Argo CD ApplicationSet error"). Warnings: an Application that is out of sync ("Argo CD Application out of sync") or whose resources are missing ("Argo CD Application resources missing").

### Changed

- On the object map, the mouse wheel now zooms in and out around the pointer instead of scrolling the map. Trackpad two-finger scrolling zooms too; drag the background to move the map.
- NetworkPolicy details now draw each ingress and egress rule as a flow: the allowed sources lead to the policy's pods (or the pods lead to the allowed destinations), with the rule's ports on the arrow. Each rule is its own card, colored blue for ingress and purple for egress, with the policy's own pods outlined in the same color. Each source is its own box that reads as a sentence, such as "All pods in namespace groundcover", so separate boxes are alternatives and the namespace and pod selectors inside one box apply together. A namespace selected by its name label shows the namespace name instead of the raw selector. Addresses an IP range excludes are shown as red exclusion chips. A direction the policy blocks entirely is shown as denied, and a direction with no rules in the policy says so.
- Ingress, HTTPRoute, GRPCRoute, and TLSRoute details now show their rules in the same flow layout as NetworkPolicy: each request match leads to its backend, with ports, and for routes that split traffic, each backend's share.
- Service details show the Service's ports flowing to the pods its selector picks. Each port chip gives its name, protocol, Service port and target port, and its node port, and the pods show their ready and not-ready counts. A new DNS name row shows the in-cluster name, a headless Service notes that its DNS name returns pod IPs, and an ExternalName Service shows the external host it aliases.
- EndpointSlice details show the slice's ports flowing to its endpoints: ready endpoints (each pod with its address and node) and not-ready endpoints in a separate dashed box, plus a link to the Service that owns the slice.
- The Argo CD view shows each Application's Sync and Health as status chips, matching the Application's details.

### Fixed

- The Network view's Network column no longer cuts off or overlaps a Service's cluster IP and ports. Port lists now collapse like host and address lists ("8686/TCP +5", with every port in the tooltip and search), the column has room for the cluster IP and collapsed ports in full, and in any narrow column of labeled values one label no longer draws over another.
- Service details no longer report "No endpoints" when the endpoints could not be read, and headless Services that define no ports now count their endpoints in the Services table and details.
- Service details show the Status row only when the Service needs attention, and a Service whose endpoint list is empty is now flagged with "no endpoints" instead of looking healthy.
- HTTPRoute and GRPCRoute details no longer reduce a rule's matches to a single path or method. Path match type, method, headers, and query parameters are all shown, and route backends show their port and weight.
- NetworkPolicy details no longer drop selector expressions such as `In` or `DoesNotExist`, and no longer show an empty selector, which matches every namespace or pod, as blank.
