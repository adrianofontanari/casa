/* Route table for the room bridge: route name (the part after /api/) -> owner.
   "shell" routes are answered by src/plugin itself. "vault" and "integrations" routes are
   answered by modules in src/vault and src/integrations (see docs/dev/shell.md for the
   module conventions). `file` names the module when it differs from the route name.
   Routes not in this table can still be served if an owner's index.js
   exports them in `routes`; anything else is a 404. */
module.exports = {
  state: { owner: 'shell', methods: ['GET', 'POST'] },
  settings: { owner: 'shell', methods: ['GET', 'POST'] },
  open: { owner: 'shell', methods: ['POST'] },
  link: { owner: 'shell', methods: ['POST'] },
  'open-settings': { owner: 'shell', methods: ['POST'] },

  focus: { owner: 'vault' },
  today: { owner: 'vault' },
  tasks: { owner: 'vault' },
  notes: { owner: 'vault', file: 'postits' },
  quotes: { owner: 'vault' },
  onboarding: { owner: 'vault' },

  weather: { owner: 'integrations' },
  forecast: { owner: 'integrations', file: 'weather' },
  geocode: { owner: 'integrations', file: 'weather' },
  air: { owner: 'integrations' },
  webcam: { owner: 'integrations' },
  calendar: { owner: 'integrations' },
  music: { owner: 'integrations' },
};
