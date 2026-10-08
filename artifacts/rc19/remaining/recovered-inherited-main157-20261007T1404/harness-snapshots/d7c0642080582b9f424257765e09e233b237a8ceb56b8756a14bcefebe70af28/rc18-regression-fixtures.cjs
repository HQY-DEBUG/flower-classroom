'use strict';
// Frozen, fictional RC18 states generated once from the immutable RC18 release.
// Tests execute RC19 only. These snapshots preserve the old histories that RC19
// can read but must never regenerate through retired growth/graduation actions.
const fixtures = require('./fixtures/rc18-regression-snapshots.json');
const historical = name => structuredClone(fixtures[name]);
const withoutGlobalProgression = value => {
  const copy = structuredClone(value); delete copy.petProgression; return copy;
};
module.exports = { historical, withoutGlobalProgression };
