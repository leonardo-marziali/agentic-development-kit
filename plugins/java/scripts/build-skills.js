#!/usr/bin/env node
'use strict';

/*
 * Generates the plugin's guidance skills from the single-page standard in
 * standards/java-standards.md, one skill per topic, so the two never drift:
 *
 *   node scripts/build-skills.js
 *
 * Each skill carries its sections verbatim, with headings demoted one level,
 * links into the single page turned into plain text, and a preamble that
 * hands brownfield code back to its own conventions. A test checks the
 * committed skills match this output.
 */

const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..');
const STANDARD = path.join(PLUGIN, 'standards', 'java-standards.md');
const SKILLS_DIR = path.join(PLUGIN, 'skills');
const PATHS = '**/*.java, **/pom.xml, **/build.gradle*';

const SKILLS = [
  {
    name: 'java-language-standards',
    title: 'Java language standards',
    parts: ['## 1. Java'],
    description:
      'Use when writing or reviewing Java code in a project that follows the java-standards opt-in. Covers Javadoc and comments, naming, member, field and argument order, var, text blocks, records and sealed types, imports, visibility, overloads for optional arguments, null-safety with JSpecify and NullAway, Optional, reuse, utility classes and explained empty bodies (rules J1 to J25).',
  },
  {
    name: 'java-build-standards',
    title: 'Java build standards (Maven and Gradle)',
    parts: ['## 2. Build (Maven and Gradle)'],
    description:
      'Use when editing pom.xml or build.gradle in a project that follows the java-standards opt-in. Covers choosing and parameterizing dependency versions, declaring the Java version, Eclipse JDT formatting, ArchUnit, the OpenAPI contract check, coverage gates and configuring Lombok with MapStruct (rules B1 to B10).',
  },
  {
    name: 'spring-boot-architecture',
    title: 'Spring Boot architecture',
    parts: ['### Foundations', '### Layers and flow', '### Services', '### Package structure'],
    description:
      'Use when designing or changing Spring Boot services, controllers, configuration or package layout in a project that follows the java-standards opt-in. Covers Lombok, logging, constructor injection, typed configuration, visibility of managed classes, how domain objects cross the layers, the update flow with ETag and If-Match, entity versus use case services, and package by feature (rules S1 to S12 and S25).',
  },
  {
    name: 'mapstruct-mapping',
    title: 'Models and MapStruct mapping',
    parts: ['### Models', '### Mapping', '### Method naming'],
    description:
      'Use when creating DTOs, domain objects, entities or MapStruct mappers in a project that follows the java-standards opt-in. Covers the model set, DTO and entity Lombok style, one mapper per layer boundary, @Context lookups, no java() expressions, abstract mappers with nullability proxies, explicit ignores and the fixed method vocabulary (rules S13 to S24).',
  },
  {
    name: 'spring-rest-api-design',
    title: 'REST API design',
    parts: [
      '### REST design',
      '### REST validation',
      '### OpenAPI',
      '### Pagination',
      '### Error handling',
    ],
    description:
      'Use when adding or changing REST endpoints, request and response DTOs, validation, OpenAPI annotations, pagination or error handling in a project that follows the java-standards opt-in. Covers Richardson level 2, standard HTTP and RFC features, resource naming, PATCH with JSON Merge Patch and JSON Patch, validation split, OpenAPI documentation, PageableDto and PageDto, ProblemDetail errors and bulk operations (rules S26 to S43).',
  },
  {
    name: 'spring-data-persistence',
    title: 'Persistence with Spring Data',
    parts: ['### Persistence'],
    description:
      'Use when writing repositories, entities, queries, auditing, migrations or filters with Spring Data JPA or MongoDB in a project that follows the java-standards opt-in. Covers repositories that hide the store, generated ids, UTC times, automatic auditing, JaVers, avoiding N+1 queries, query preference order, Liquibase, and QueryDSL predicate classes (rules S44 to S53).',
  },
  {
    name: 'spring-boot-integrations',
    title: 'Caching, HTTP logging and outbound HTTP',
    parts: ['### Caching', '### HTTP logging', '### Outbound HTTP'],
    description:
      'Use when adding caching, Logbook HTTP logging, outbound HTTP clients or Resilience4j in a project that follows the java-standards opt-in. Covers stale-tolerant Spring Cache use, Logbook configuration and masking, one RestClient-based client per remote system speaking the domain, timeouts, OAuth2 client credentials and fault tolerance (rules S54 to S58).',
  },
  {
    name: 'java-ddd-events',
    title: 'Domain-driven and event-driven design',
    parts: ['## 4. Domain-Driven and Event-Driven Design'],
    description:
      'Use when modelling domain objects, state machines, events, messaging or scheduled jobs in a project that follows the java-standards opt-in. Covers plain-Java domain classes, construction and invariants, step builders, rehydration, explicit state machines, optimistic locking, the transactional outbox, idempotent consumers, versioned schemas and safe scheduled jobs (rules D1 to D11).',
  },
  {
    name: 'java-testing-standards',
    title: 'Testing standards',
    parts: ['## 5. Testing'],
    description:
      'Use when writing or reviewing tests in a Java project that follows the java-standards opt-in. Covers branch coverage, shouldXWhenY naming with @Nested and AssertJ, parameterized tests, unit tests for domain and services, slice tests for controllers and integrations, WireMock, and the shortcuts never to take (rules T1 to T7).',
  },
];

const PREAMBLE = [
  'Before applying this skill, read `.claude/java-standards.json` at the',
  "repository root. If it doesn't exist, or the file you're working on is",
  'outside its `include`/`exclude` scope, follow the conventions of the',
  'surrounding code instead.',
  '',
  'Break a rule only with a concrete reason, and write that reason down. At',
  'Stop, the java plugin blocks on violations in lines you changed; mark a',
  'justified exception with `// java-rules:allow <ID> <reason>`.',
].join('\n');

// The standard's lines from `heading` up to the next heading of the same or a higher level.
function extract(lines, heading) {
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`heading not found in the standard: ${heading}`);
  const level = heading.indexOf(' ');
  let end = lines.length;
  let inFence = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*```/.test(lines[i])) inFence = !inFence;
    // A `### PAYPAL ###` comment in a properties block is not a heading.
    const match = !inFence && /^(#+) /.exec(lines[i]);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

// Headings move up so the part's own heading becomes `##`; chapter numbers go.
function demote(part) {
  const shift = part[0].indexOf(' ') - 2;
  let inFence = false;
  return part.map((line) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const match = !inFence && /^(#+) (.*)$/.exec(line);
    if (!match) return line;
    const text = match[2].replace(/^\d+\.\s+/, '');
    return `${'#'.repeat(Math.max(2, match[1].length - shift))} ${text}`;
  });
}

function unlink(text) {
  return text.replaceAll(/\[([^\]]+)\]\(#[^)]*\)/g, '$1');
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function render(skill, lines) {
  const body = skill.parts
    .map((heading) => demote(extract(lines, heading)).join('\n').trim())
    .join('\n\n');
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${quote(skill.description)}`,
    `paths: ${quote(PATHS)}`,
    '---',
    '',
    '<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->',
    '<!-- markdownlint-disable MD013 -->',
    '',
    `# ${skill.title}`,
    '',
    PREAMBLE,
    '',
    unlink(body),
    '',
  ].join('\n');
}

function renderSkills() {
  const lines = fs.readFileSync(STANDARD, 'utf8').split('\n');
  return Object.fromEntries(SKILLS.map((skill) => [skill.name, render(skill, lines)]));
}

function main() {
  for (const [name, content] of Object.entries(renderSkills())) {
    const file = path.join(SKILLS_DIR, name, 'SKILL.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    process.stdout.write(`wrote ${path.relative(PLUGIN, file)}\n`);
  }
}

if (require.main === module) main();

module.exports = { SKILLS, renderSkills, extract };
