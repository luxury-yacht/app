- Keep the clusters tab bar persistent, even if only one cluster is open.
- When no clusters are open, show only a + button
- When clusters are open, show the + button to the right. The + button must never scroll off the visible area.
- Remove the kubeconfig dropdown and replace it with an Open Cluster modal.
  - Open Cluster modal will replace the functionality currently in Settings -> Kubeconfig
  - Each directory shows files with contexts
- Clusters can still be opened via Command Palette
- Clusters can still be closed with ctrl/cmd+w
  - Closing the last cluster should no longer close the app

Here's a mockup of the Open Cluster modal

Hierarchy is

```
directory
 |- filename
     |- context
```

- In addition to clicking the + button, ctrl/cmd+O opens the Open Cluster modal
  - Add "Open Cluster" to the OS File menu
- Only show files that contain contexts. Do not rely on extensions, or lack of extensions
- Attempt to validate the contexts, and put a warning icon next to invalid contexts. Invalid contexts should not be clickable
  - Validate syntax only, no connectivity checks
- Click a context to open the cluster tab
- Clusters that are already open should be indentifiable in the list
- Directories and filenames are collapsible, but all expanded by default
  - Remember collapsed/expanded state
- Close buttons for directories appear on hover only
- Don't auto-open the modal when zero clusters are open or at launch

```
|------------------------------------|
| Open Cluster                       |
|                                    |
| ~/.kube                        [x] |
|   |- dev-clusters                  |
|   |   |- dev-us-east-1             |
|   |   |- dev-us-west-2             |
|   |- prod-clusters                 |
|       |- prod-us-east-1            |
| /usr/local/kubeconfigs         [x] |
|   |- stg-clusters                  |
|   |   |- stg-us-east-1             |
|   |- prod-clusters                 |
|       | - prod-eu-central-1        |
|       | - prod-eu-central-2        |
|                                    |
|    [ Add Directory ] [ Cancel ]    |
|                                    |
|------------------------------------|
```

- When complete, we should no longer need the Kubeconfigs section in Settings, so remove it.
