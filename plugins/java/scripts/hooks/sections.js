'use strict';

/*
 * Extra report sections for the Stop loop (NullAway, ArchUnit). Each one is
 * `{ name, partition, run(context) → { findings } }`; `partition: false`
 * means its findings aren't scoped to changed lines (ArchUnit scopes by
 * package and freeze store instead).
 */

const SECTIONS = [];

function registerSection(section) {
  if (!SECTIONS.some((existing) => existing.name === section.name)) SECTIONS.push(section);
}

function registeredSections() {
  return [...SECTIONS];
}

module.exports = { registerSection, registeredSections };
