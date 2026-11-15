/* Decides when the room is paused. The room runs only while all three signals are true:
   - docVisible: the window is not minimised or hidden (Page Visibility API)
   - inView:     the iframe has a box on screen (IntersectionObserver; false when its tab is
                 in the background or the sidebar holding it is collapsed)
   - focused:    the Obsidian window that holds the view has focus (focus inside the room iframe counts)
   `post(paused)` is called only when the result changes, or on force(). */
class PauseState {
  constructor(post) {
    this.post = post;
    this.signals = { docVisible: true, inView: true, focused: true };
    this.paused = null;
  }

  set(name, value) {
    this.signals[name] = !!value;
    this.update(false);
  }

  isPaused() {
    const s = this.signals;
    return !(s.docVisible && s.inView && s.focused);
  }

  update(force) {
    const next = this.isPaused();
    if (force || next !== this.paused) {
      this.paused = next;
      try { this.post(next); } catch (e) { /* the frame may be gone */ }
    }
    return next;
  }

  force() {
    return this.update(true);
  }
}

module.exports = { PauseState };
