**Luxury Yacht 1.10.0 is a large release, and a complete rewrite of some important backend systems.** It contains significant performance improvements, but many thousands of lines of code were changed to accomplish this. While I've done my best to test and make sure this is release-worthy, I can't cover every possible scenario. If you run into any problems, please open an issue.

### Added

- If your account does not have permission to list namespaces, you can now add/remove the specific namespaces you do have access to, right in the sidebar. If a namespace you added turns out to be off-limits, only that namespace is affected — the rest keep working. A few views that can only read the whole cluster at once (Events, Autoscaling, Helm, and Gateway API) show a "no permission" message instead. ([#243](https://github.com/luxury-yacht/app/issues/243)).
- Object Age is now calculated by the frontend, so it should update in realtime without requiring any new data from the backend.
- A clearer message when a sign-in helper is missing. Some clusters use an external helper program to log in. If the app can't run it, it now tells you exactly which program your cluster is asking for and what to do about it.
- There is now a "Collecting metrics…" note while CPU/memory data is still loading, on the Cluster Overview and other places that show usage.

### Changed

- The app no longer guesses where cloud sign-in helpers are installed. It used to automatically look in Google Cloud SDK and Homebrew install folders. Now it relies on your system setup and your kubeconfig. ([#240](https://github.com/luxury-yacht/app/issues/240))
- Faster loading of the namespaces list. We display the namespaces as quickly as possible, then retroactively determine the workload state for namespace dimming (when enabled).
- The Cluster Overview will now show at least partial data to users with limited permissions instead of failing to load entirely. ([#244](https://github.com/luxury-yacht/app/issues/244)).
- Clearer resource bars. When usage goes over its limit, the over-limit part of the bar now has a striped pattern, so you can still see where the limit is even on a full red bar.
- Legend added to the Resource Utilization card on the Cluster Overview page.
- Friendlier sign-in errors. Login problems now show a plain, readable message (like "The cluster credentials have expired") instead of raw technical output.

### Fixed

- Screens you don't have permission to see now say so right away — "Insufficient permissions" — instead of spinning forever.
- The Details panel should now update when an object changes — it could previously keep showing old information for the rest of the session.
