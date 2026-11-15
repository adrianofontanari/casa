/* Settings tab. Every change goes through plugin.updateSettings, which validates it the same
   way POST /api/settings does and tells open rooms to refresh. */
const { PluginSettingTab, Setting } = require('obsidian');

const CALENDAR_HELP = [
  ['Google', 'Calendar settings > your calendar > Integrate calendar > Secret address in iCal format.'],
  ['Outlook', 'Settings > Calendar > Shared calendars > Publish a calendar > copy the ICS link.'],
  ['iCloud', 'Calendar app > share the calendar > Public Calendar > copy the link.'],
];

function debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments;
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(null, args); }, ms);
  };
}

function cityLabel(r) {
  const full = [r.name, r.admin1, r.country].filter((x) => x && String(x).trim()).join(', ');
  return full.length <= 80 ? full : String(r.name || '').trim().slice(0, 80);
}

class CasaSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /* Apply a patch; on a bad value show the reason under the setting instead of saving. */
  apply(patch, errorEl) {
    try {
      this.plugin.updateSettings(patch);
      if (errorEl) errorEl.setText('');
      return true;
    } catch (e) {
      if (errorEl) errorEl.setText(e.message || String(e));
      return false;
    }
  }

  textSetting(el, opts) {
    const s = this.plugin.getSettings();
    const setting = new Setting(el).setName(opts.name).setDesc(opts.desc);
    const err = setting.descEl.createDiv({ cls: 'casa-setting-error' });
    const save = debounce((v) => this.apply({ [opts.key]: v }, err), 600);
    setting.addText((t) => {
      t.setPlaceholder(opts.placeholder || '').setValue(s[opts.key] || '').onChange(save);
      t.inputEl.addClass('casa-setting-wide');
      if (opts.secret) t.inputEl.setAttribute('autocomplete', 'off');
    });
    return setting;
  }

  display() {
    const el = this.containerEl;
    el.empty();
    el.addClass('casa-settings');
    const s = this.plugin.getSettings();

    new Setting(el)
      .setName('Calm mode')
      .setDesc('Keep the room still: no animations.')
      .addToggle((t) => t.setValue(s.calm).onChange((v) => this.apply({ calm: v })));

    new Setting(el)
      .setName('Show buddy')
      .setDesc('The penguin who keeps you company in the room.')
      .addToggle((t) => t.setValue(s.buddy).onChange((v) => this.apply({ buddy: v })));

    new Setting(el)
      .setName('Units')
      .addDropdown((d) => d
        .addOption('metric', 'Metric (°C, km/h)')
        .addOption('imperial', 'Imperial (°F, mph)')
        .setValue(s.units)
        .onChange((v) => this.apply({ units: v })));

    new Setting(el)
      .setName('Music')
      .setDesc('Music and ambient sounds in the room. Nothing is downloaded until you press play.')
      .addToggle((t) => t.setValue(s.musicOn).onChange((v) => this.apply({ musicOn: v })));

    this.citySection(el);

    new Setting(el).setName('Calendar').setHeading();
    const cal = this.textSetting(el, {
      key: 'calendarUrl',
      name: 'Calendar link (ICS)',
      desc: 'Shows your events on the wall calendar. Empty means no calendar and no request. Keep this link private: anyone with it can read your calendar. It is stored in this vault\'s plugin data.',
      placeholder: 'https://… or webcal://…',
      secret: true,
    });
    const help = cal.descEl.createEl('ul', { cls: 'casa-setting-help' });
    for (const [who, how] of CALENDAR_HELP) {
      const li = help.createEl('li');
      li.createEl('strong', { text: who + ': ' });
      li.appendText(how);
    }

    new Setting(el).setName('Window and air').setHeading();
    new Setting(el)
      .setName('Webcam')
      .setDesc('A live view through the window. Off: no webcam requests.')
      .addToggle((t) => t.setValue(s.webcamOn).onChange((v) => this.apply({ webcamOn: v })));
    this.textSetting(el, {
      key: 'webcamUrl',
      name: 'Webcam image link',
      desc: 'A still image that refreshes, shown through the window. Leave empty for the default.',
      placeholder: 'https://…/image.jpg',
    });
    new Setting(el)
      .setName('Air quality')
      .setDesc('Air quality for your city. Off: no air quality requests.')
      .addToggle((t) => t.setValue(s.airOn).onChange((v) => this.apply({ airOn: v })));
    this.textSetting(el, {
      key: 'airUrl',
      name: 'Air quality sensor link',
      desc: 'Data from a sensor you trust. Leave empty to use public air quality data for your city.',
      placeholder: 'https://…',
    });

    this.dailySection(el);

    new Setting(el).setName('Welcome').setHeading();
    new Setting(el)
      .setName('Run the welcome again')
      .setDesc('Open the room and walk through the first-time setup.')
      .addButton((b) => b.setButtonText('Start').onClick(() => { this.plugin.runWelcomeAgain(); }));
  }

  citySection(el) {
    new Setting(el).setName('Weather').setHeading();
    const s = this.plugin.getSettings();
    new Setting(el)
      .setName('Weather data')
      .setDesc('Weather, forecast and daylight for your city. Off: no weather requests.')
      .addToggle((t) => t.setValue(s.weatherOn).onChange((v) => this.apply({ weatherOn: v })));
    const chosen = new Setting(el).setName('City');
    const renderChosen = () => {
      const c = this.plugin.getSettings().city;
      chosen.setDesc(c ? 'Chosen: ' + c.name + ' (' + c.lat.toFixed(2) + ', ' + c.lon.toFixed(2) + ')' :
        'No city yet. Weather, air and daylight need one.');
    };
    renderChosen();
    chosen.addExtraButton((b) => b.setIcon('x').setTooltip('Clear city').onClick(() => {
      this.apply({ city: null });
      renderChosen();
    }));

    let query = s.city ? s.city.name.split(',')[0] : '';
    const search = new Setting(el).setName('Find a city').setDesc('Type a name and press Search.');
    const results = el.createDiv({ cls: 'casa-city-results' });
    const run = async () => {
      results.empty();
      const q = query.trim();
      if (!q) return;
      results.createDiv({ cls: 'casa-city-status', text: 'Searching…' });
      const reply = await this.plugin.callRoute('geocode', 'GET', { q: q });
      results.empty();
      if (reply.status === 501) {
        results.createDiv({ cls: 'casa-city-status', text: 'City search is not available in this build.' });
        return;
      }
      if (reply.status !== 200) {
        results.createDiv({ cls: 'casa-city-status', text: 'Search failed: ' + ((reply.json && reply.json.error) || reply.status) });
        return;
      }
      const list = (reply.json && reply.json.results) || [];
      if (!list.length) {
        results.createDiv({ cls: 'casa-city-status', text: 'No match. Try another spelling.' });
        return;
      }
      for (const r of list.slice(0, 8)) {
        const btn = results.createEl('button', { cls: 'casa-city-option', text: cityLabel(r) });
        btn.addEventListener('click', () => {
          if (this.apply({ city: { name: cityLabel(r), lat: r.lat, lon: r.lon } })) {
            results.empty();
            renderChosen();
          }
        });
      }
    };
    search.addText((t) => {
      t.setPlaceholder('City name').setValue(query).onChange((v) => { query = v; });
      t.inputEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); run(); } });
    });
    search.addButton((b) => b.setButtonText('Search').onClick(() => { run(); }));
  }

  dailySection(el) {
    new Setting(el).setName('Daily notes').setHeading();
    const s = this.plugin.getSettings();
    const mode = new Setting(el)
      .setName('Daily notes source')
      .setDesc('Where Casa reads today\'s goal and tasks.');
    const detected = mode.descEl.createDiv({ cls: 'casa-setting-detected' });
    const custom = el.createDiv();
    const renderCustom = () => {
      custom.empty();
      if (this.plugin.getSettings().dailyMode !== 'custom') return;
      this.textSetting(custom, { key: 'dailyFolder', name: 'Folder', desc: 'Folder of your daily notes. Empty means the vault root.', placeholder: 'Daily' });
      this.textSetting(custom, { key: 'dailyFormat', name: 'File name format', desc: 'Date format of the file name, for example YYYY-MM-DD.', placeholder: 'YYYY-MM-DD' });
      this.textSetting(custom, { key: 'dailyTemplate', name: 'Template', desc: 'Optional note used for a new daily note.', placeholder: 'Templates/Daily.md' });
    };
    mode.addDropdown((d) => d
      .addOption('auto', 'Auto-detect')
      .addOption('custom', 'Custom folder and format')
      .setValue(s.dailyMode)
      .onChange((v) => { if (this.apply({ dailyMode: v })) renderCustom(); }));
    renderCustom();

    this.plugin.callRoute('onboarding', 'GET').then((reply) => {
      const d = reply && reply.status === 200 && reply.json && reply.json.daily;
      if (!d) return;
      const names = { core: 'Daily notes core plugin', periodic: 'Periodic Notes', journals: 'Journals', casa: 'Casa default' };
      detected.setText('Detected: ' + (names[d.source] || d.source || 'unknown') +
        (d.folder ? ', folder "' + d.folder + '"' : '') + (d.format ? ', format ' + d.format : '') + '.');
    }, () => {});
  }
}

module.exports = { CasaSettingTab };
