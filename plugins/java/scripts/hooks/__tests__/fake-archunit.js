#!/usr/bin/env node
'use strict';

// A stand-in for the ArchUnit runner (JAVA_PLUGIN_ARCHUNIT_CMD): logs its
// arguments to $FAKE_ARCHUNIT_LOG and prints $FAKE_ARCHUNIT_OUTPUT.
const fs = require('node:fs');

if (process.env.FAKE_ARCHUNIT_LOG) {
  fs.appendFileSync(process.env.FAKE_ARCHUNIT_LOG, `${JSON.stringify(process.argv.slice(2))}\n`);
}
process.stdout.write(process.env.FAKE_ARCHUNIT_OUTPUT || '');
