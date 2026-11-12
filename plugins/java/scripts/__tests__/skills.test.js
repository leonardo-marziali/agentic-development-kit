'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SKILLS, renderSkills } = require('../build-skills');

const PLUGIN = path.join(__dirname, '..', '..');
const SKILLS_DIR = path.join(PLUGIN, 'skills');

const PREAMBLE =
  'Before applying this skill, read `.claude/java-standards.json` at the repository root. If it ' +
  "doesn't exist, or the file you're working on is outside its `include`/`exclude` scope, follow the " +
  'conventions of the surrounding code instead.';

function read(name) {
  return fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8');
}

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'frontmatter');
  return Object.fromEntries(
    match[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [
        line.slice(0, i),
        line
          .slice(i + 1)
          .trim()
          .replace(/^'|'$/g, ''),
      ];
    }),
  );
}

const ALL_IDS = [
  ...Array.from({ length: 24 }, (_, i) => `J${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `B${i + 1}`),
  ...Array.from({ length: 58 }, (_, i) => `S${i + 1}`),
  ...Array.from({ length: 11 }, (_, i) => `D${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `T${i + 1}`),
];

test('every rule of the standard is defined in exactly one skill', () => {
  for (const id of ALL_IDS) {
    const owners = SKILLS.filter(({ name }) => read(name).includes(`**${id}. `));
    assert.equal(
      owners.length,
      1,
      `${id} is defined in ${owners.map((s) => s.name).join(', ') || 'no skill'}`,
    );
  }
});

test('each skill has its frontmatter, Java paths and the scope preamble', () => {
  for (const { name } of SKILLS) {
    const text = read(name);
    const meta = frontmatter(text);
    assert.equal(meta.name, name);
    assert.ok(
      meta.description.length > 40 && meta.description.length <= 1536,
      `${name} description`,
    );
    assert.equal(meta.paths, '**/*.java, **/pom.xml, **/build.gradle*');
    assert.ok(text.replaceAll(/\s+/g, ' ').includes(PREAMBLE), `${name} preamble`);
  }
});

test('the committed skills match what the standard generates', () => {
  for (const [name, content] of Object.entries(renderSkills())) {
    assert.equal(read(name), content, `${name} is stale: run node scripts/build-skills.js`);
  }
});

test('skills keep no links to anchors of the original single-page standard', () => {
  for (const { name } of SKILLS) assert.doesNotMatch(read(name), /\]\(#/, name);
});
