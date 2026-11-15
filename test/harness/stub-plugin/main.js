// Stand-in for the Casa plugin, used only by the test harness to prove the
// launch -> enable -> open view -> screenshot -> network log -> close loop
// before the real build exists. Same plugin id, view and command names as Casa.
const { Plugin, ItemView } = require('obsidian');

const VIEW_TYPE = 'casa-room';

const ROOM_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; font: 16px sans-serif; background: #f4ecd8; color: #333; }
  #hello { position: absolute; left: 24px; top: 16px; font-size: 32px; }
  #goal { position: absolute; left: 40%; top: 40%; width: 20%; height: 20%; background: #e0a96d; }
  #log { position: absolute; left: 24px; bottom: 16px; }
</style></head><body>
<div id="hello">hello</div>
<canvas id="goal" data-casa-id="goal"></canvas>
<div id="log">no click yet</div>
<script>
  // Hotspot lookup the harness uses to click an object by id (CSS px in this viewport).
  window.CasaDebug = { hotspot: function (id) {
    var el = document.querySelector('[data-casa-id="' + id + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  } };
  document.addEventListener('click', function (e) {
    var hit = e.target && e.target.getAttribute && e.target.getAttribute('data-casa-id');
    document.getElementById('log').textContent = 'click ' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + (hit ? ' on ' + hit : '');
    if (hit) document.dispatchEvent(new CustomEvent('casa:open', { detail: { id: hit } }));
  });
  document.addEventListener('casa:open', function (e) {
    parent.postMessage({ casa: 1, id: 1, route: '/api/focus', method: 'POST', body: { focus: 'clicked ' + e.detail.id } }, '*');
  });
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.casa && 'pause' in d) document.dispatchEvent(new CustomEvent(d.pause ? 'casa:pause' : 'casa:resume'));
  });
</script></body></html>`;

class StubView extends ItemView {
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Casa'; }
  getIcon() { return 'home'; }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('casa-stub-view');
    const frame = this.contentEl.createEl('iframe', { cls: 'casa-stub-frame casa-room-frame' });
    frame.setAttribute('srcdoc', ROOM_HTML);
    this.frame = frame;
    this.onMessage = async (e) => {
      const d = e.data || {};
      if (e.source !== frame.contentWindow || !d.casa || d.route !== '/api/focus') return;
      await this.app.vault.adapter.write('Casa stub.md', String(d.body && d.body.focus) + '\n');
      frame.contentWindow.postMessage({ casa: 1, id: d.id, status: 200, json: { ok: true } }, '*');
    };
    window.addEventListener('message', this.onMessage);
  }
  async onClose() { window.removeEventListener('message', this.onMessage); }
}

module.exports = class CasaStub extends Plugin {
  onload() {
    this.registerView(VIEW_TYPE, (leaf) => new StubView(leaf));
    this.addCommand({ id: 'open-room', name: 'Open room', callback: () => this.openRoom() });
  }
  async openRoom() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
};
