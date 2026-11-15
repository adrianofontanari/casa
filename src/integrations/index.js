/* Integration routes for the room bridge. Each handler is called as handler(req, ctx) and
   resolves {status, json}. No module makes a request at load time: every request happens
   inside a route call, and each source has an off switch (see docs/dev/routes.md). */
'use strict';

const weather = require('./weather.js');
const air = require('./air.js');
const webcam = require('./webcam.js');
const ics = require('./ics.js');
const music = require('./music.js');

module.exports = {
  routes: Object.assign({}, weather.routes, air.routes, webcam.routes, ics.routes, music.routes),
};
