#!/usr/bin/env node
'use strict';

/*
A stand-in for the JDT engine (JAVA_PLUGIN_ENGINE_CMD), driven by markers in
the files it is given:
  - FORMAT_ME becomes FORMATTED when the file's lines are to be formatted;
  - a line containing RULE:<ID> yields a FINDING for that rule on that line;
  - BROKEN yields an ERROR.
Each call is appended to $FAKE_ENGINE_LOG as one JSON line { args, request }.
*/

const fs = require('node:fs');

const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
const request = fs.readFileSync(flag('--request'), 'utf8');
if (process.env.FAKE_ENGINE_LOG) {
  fs.appendFileSync(process.env.FAKE_ENGINE_LOG, `${JSON.stringify({ args, request })}\n`);
}

for (const line of request.split('\n').filter(Boolean)) {
  const tab = line.lastIndexOf('\t');
  const file = line.slice(0, tab);
  const ranges = line.slice(tab + 1);
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes('BROKEN')) {
    process.stdout.write(`ERROR\t${file}\thas syntax errors; not formatted or checked\n`);
    continue;
  }
  if (ranges !== '-' && text.includes('FORMAT_ME')) {
    text = text.replaceAll('FORMAT_ME', 'FORMATTED');
    fs.writeFileSync(file, text);
    process.stdout.write(`FORMATTED\t${file}\n`);
  }
  if (flag('--rules') === 'on') {
    text.split('\n').forEach((content, index) => {
      const match = /RULE:(\w+)/.exec(content);
      if (match)
        process.stdout.write(
          `FINDING\t${file}\t${index + 1}\t${match[1]}\tfake ${match[1]} finding\n`,
        );
    });
  }
}
