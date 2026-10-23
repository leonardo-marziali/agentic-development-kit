'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rank, isSeverity, normalize } = require('../severity');

test('the two vocabularies share one ladder', () => {
  assert.equal(rank('BLOCKER'), 5);
  assert.equal(rank('CRITICAL'), rank('HIGH'));
  assert.equal(rank('MAJOR'), rank('MEDIUM'));
  assert.equal(rank('MINOR'), rank('LOW'));
  assert.equal(rank('info'), 1);
  assert.equal(rank('nope'), 0);
  assert.equal(isSeverity('nope'), false);
});

test('rawIssues shape: the highest MQR impact wins over the standard severity', () => {
  // Shape observed from SLOOP 12.1 for python:S5754.
  const raw = { severity: 'CRITICAL', type: 'CODE_SMELL', impacts: { MAINTAINABILITY: 'HIGH' } };
  assert.deepEqual(normalize(raw), { severity: 'HIGH', type: 'CODE_SMELL' });
});

test('RaisedIssueDto MQR shape: the highest of several impacts', () => {
  const raised = {
    severityMode: {
      cleanCodeAttribute: 'TRUSTWORTHY',
      impacts: [
        { softwareQuality: 'MAINTAINABILITY', impactSeverity: 'LOW' },
        { softwareQuality: 'SECURITY', impactSeverity: 'BLOCKER' },
      ],
    },
  };
  assert.deepEqual(normalize(raised), { severity: 'BLOCKER', type: 'SECURITY' });
});

test('RaisedIssueDto standard shape', () => {
  assert.deepEqual(normalize({ severityMode: { severity: 'MAJOR', type: 'BUG' } }), {
    severity: 'MAJOR',
    type: 'BUG',
  });
});

test('a standard severity above every impact is kept', () => {
  assert.equal(
    normalize({ severity: 'BLOCKER', impacts: { RELIABILITY: 'LOW' } }).severity,
    'BLOCKER',
  );
});

test('no severity at all reads as INFO rather than crashing', () => {
  assert.deepEqual(normalize({}), { severity: 'INFO', type: null });
});
