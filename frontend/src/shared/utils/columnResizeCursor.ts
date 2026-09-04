import './columnResizeCursor.css';

let activeDrags = 0;

// Leave the inline cursor to Wails so its edge handler cannot capture and
// later restore a column cursor after the column gesture has finished.
export const acquireColumnResizeCursor = () => {
  activeDrags += 1;
  document.body.classList.add('column-resizing');
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeDrags -= 1;
    if (activeDrags === 0) {
      document.body.classList.remove('column-resizing');
    }
  };
};
