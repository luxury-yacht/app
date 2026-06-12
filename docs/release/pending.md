### Fixed

- Fixed clusters getting stuck at "Still loading cluster data" forever when a watched resource type can never sync — for example Gateway API resources installed at an older API version than the app watches, or resources your credentials cannot list. Such resources no longer block the cluster from becoming ready. (#225)
- Kubernetes watch failures that keep recurring with the same error (such as a resource type the cluster doesn't serve) are now logged only once, instead of repeating every few seconds.
