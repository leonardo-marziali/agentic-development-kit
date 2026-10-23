'use strict';

/*
 * SonarQube has two severity vocabularies, depending on the mode a rule is
 * reported in:
 *
 *   Standard:  BLOCKER  CRITICAL  MAJOR   MINOR  INFO
 *   MQR:       BLOCKER  HIGH      MEDIUM  LOW    INFO   (per software-quality impact)
 *
 * SLOOP reports both for most issues. Everything downstream — sorting, the
 * --min-severity threshold, the hooks' blocking policy — needs one ladder, so
 * the two are folded onto the same five ranks.
 */

const RANKS = {
  BLOCKER: 5,
  CRITICAL: 4,
  HIGH: 4,
  MAJOR: 3,
  MEDIUM: 3,
  MINOR: 2,
  LOW: 2,
  INFO: 1,
};

function rank(severity) {
  return RANKS[String(severity || '').toUpperCase()] || 0;
}

function isSeverity(value) {
  return rank(value) > 0;
}

/*
 * Pulls { severity, type } out of one issue, in either shape SLOOP uses:
 *
 *   - AnalyzeFilesResponse.rawIssues: { severity, type, impacts: { QUALITY: SEV } }
 *   - raiseIssues' RaisedIssueDto: { severityMode: { severity, type } }
 *     or { severityMode: { cleanCodeAttribute, impacts: [{ softwareQuality, impactSeverity }] } }
 *
 * The MQR impact wins when present: it is the vocabulary current SonarQube
 * versions show, and its highest impact is never lower than what the standard
 * severity would say for the same rule.
 */
function normalize(issue) {
  const mode = issue.severityMode || {};
  const standardSeverity = issue.severity || mode.severity || null;
  const standardType = issue.type || mode.type || null;

  let impacts = [];
  if (Array.isArray(mode.impacts)) {
    impacts = mode.impacts.map((i) => [i.softwareQuality, i.impactSeverity]);
  } else if (issue.impacts && typeof issue.impacts === 'object') {
    impacts = Array.isArray(issue.impacts)
      ? issue.impacts.map((i) => [i.softwareQuality, i.impactSeverity || i.severity])
      : Object.entries(issue.impacts);
  }

  let top = null;
  for (const [quality, severity] of impacts) {
    if (!top || rank(severity) > rank(top.severity)) top = { quality, severity };
  }

  const severity =
    top && rank(top.severity) >= rank(standardSeverity) ? top.severity : standardSeverity;
  return {
    severity: severity ? String(severity).toUpperCase() : 'INFO',
    type: standardType || (top ? top.quality : null),
  };
}

module.exports = { RANKS, rank, isSeverity, normalize };
