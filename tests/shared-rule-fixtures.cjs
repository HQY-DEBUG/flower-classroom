'use strict';
const Rules = require('../src/score-rules.js');
// RC18's shared catalog adds a rules mirror and version 2 to an archived
// panel. Every other classroom field is still compared exactly by the tests.
function mirroredLegacyPanel(source) {
  const expected = JSON.parse(JSON.stringify(source));
  expected.version = 2;
  expected.settings.scoreRules = Rules.list(source);
  return expected;
}
module.exports = {mirroredLegacyPanel};
