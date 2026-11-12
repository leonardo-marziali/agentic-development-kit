'use strict';

/*
 * Extra report sections for the Stop loop (NullAway, ArchUnit). Each one is
 * `{ name, scope, run(context) → { findings } }`. `scope` says which
 * findings block: `'lines'` (the default) those on lines the session
 * changed, `'files'` those in files it touched (ArchUnit, whose findings
 * carry no reliable line), `'all'` every one.
 */

const SECTIONS = [];

function registerSection(section) {
  if (!SECTIONS.some((existing) => existing.name === section.name)) SECTIONS.push(section);
}

function registeredSections() {
  return [...SECTIONS];
}

module.exports = { registerSection, registeredSections };
