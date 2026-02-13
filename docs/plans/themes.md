# themes

The app has a simple themes system. It consists of only 4 values.

- hue
- saturation
- brightness
- accent color

I want the following changes:

- Add a field for the theme name
- Add a field for cluster match pattern (what is a good name for this?)
  - Automatically load this theme if the cluster name matches the pattern
  - Support standard wildcards like \* and ? (avoid complex regex)
- Make all of the values clickable/editable, like the accent color currently is
- Add save button
  - Save the theme data in the standard persistence file
- Show a simple table that lists all of the themes

```
Theme Name         Pattern
----------         -------
Royal Blue         *dev*        Edit icon   Delete icon
Forest Green       stg-?        Edit icon   Delete icon
Danger Red         prod*        Edit icon   Delete icon
Light Purple       -            Edit icon   Delete icon
```
