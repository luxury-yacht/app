# Task

Your task is to do a thorough, deep investigation of multi-cluster support in the app.

Problems:

- It is easy for the app to get in a state where it is unusable if there are authentication errors.
  - Cluster tabs become unresponsive and cannot be opened or closed.
  - Clusters that should have functional authentication do not load data.

Expected Behaviors:

- The app has true and correct multi-cluster support.
- Each cluster must handle its own authentication, and failures in one cluster must not affect other clusters in any way.
- Each cluster must be fully isolated from other clusters.
  - Data must not be shared
  - Auth must not be shared
  - Caches must not be shared
