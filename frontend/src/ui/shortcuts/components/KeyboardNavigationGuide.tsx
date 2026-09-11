export function KeyboardNavigationGuide() {
  return (
    <section className="keyboard-navigation-guide" aria-label="Keyboard navigation guide">
      <h3>Moving around</h3>
      <p>
        <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> visit controls in the current region.{' '}
        <kbd>Ctrl+Tab</kbd> / <kbd>Ctrl+Shift+Tab</kbd> switch regions and restore your last
        control. Control is the Control key on every platform.
      </p>
      <dl>
        <dt>Tables</dt>
        <dd>
          Arrows choose a row. Tab visits the current row’s links and buttons; Shift+Tab goes back.
          Escape returns to row navigation. Enter opens the row. Shift+F10 opens its menu.
        </dd>
        <dt>Tabs</dt>
        <dd>
          Left/Right moves focus between tabs; Enter or Space selects one. Tab reaches Close. Delete
          or Backspace also closes a focused tab.
        </dd>
        <dt>Status and popups</dt>
        <dd>
          Focus a status indicator and press Enter or Space for details. Tab visits popup controls;
          Shift+Tab goes back. Escape closes the popup and returns to its trigger.
        </dd>
        <dt>Object map</dt>
        <dd>
          Tab reaches the map search field and toolbar controls. Type in the search field and press
          Enter to center a matching object; press Enter again to cycle through matches.
        </dd>
        <dt>Sidebar</dt>
        <dd>
          Arrows choose a view. Tab reaches the sidebar buttons, including Add namespace and removal
          of manually added namespaces. Enter or Space activates a button.
        </dd>
        <dt>Editors and dialogs</dt>
        <dd>
          Editors keep their own Tab behavior; Ctrl+Tab leaves their region. Dialogs keep focus
          inside until dismissed.
        </dd>
      </dl>
    </section>
  );
}
