### Added

### Changed

- On the object map, the mouse wheel now zooms in and out around the pointer instead of scrolling the map. Trackpad two-finger scrolling zooms too; drag the background to move the map.
- NetworkPolicy details now draw each ingress and egress rule as a flow: the allowed sources lead to the policy's pods (or the pods lead to the allowed destinations), with the rule's ports on the arrow. Each rule is its own card, colored blue for ingress and purple for egress, with the policy's own pods outlined in the same color. Each source is its own box, so separate boxes are alternatives and the namespace and pod selectors inside one box apply together. A direction the policy blocks entirely is shown as denied, and a direction it does not restrict says so.

### Fixed

- NetworkPolicy details no longer drop selector expressions such as `In` or `DoesNotExist`, and no longer show an empty selector, which matches every namespace or pod, as blank.
