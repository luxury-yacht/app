### Added

- Command Palette improvements
  - Ranked results. The best match comes first instead of using a predefined order.
  - Multi-word search. Every word must match, in any order, for commands and cluster objects. Extra spaces no longer hide results, and words also match an object's kind. Browse and the Diff Objects picker get the same multi-word search.
  - Words that match kinds like pod, svc, or deploy are highlighted in the search box, with the kind they filter to shown on the right.
  - Added a tooltip icon beside the search box to explain how search works.
  - Kubeconfigs section renamed to Clusters. Added a new Favorite Clusters group.
  - Clicking outside the palette closes it without also clicking what's underneath.
  - The Command Palette now stays inside the window at any zoom level.
