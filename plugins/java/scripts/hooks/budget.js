'use strict';

/*
 * One time budget for a whole stop. Claude Code kills the Stop hook at its
 * 180 s timeout, and a killed hook reports nothing, so every slow step (the
 * engine, the build tool, javac, ArchUnit) takes its timeout from what's
 * left, and the optional sections are skipped, with a warning, when too
 * little is left for them. JAVA_PLUGIN_STOP_BUDGET_MS overrides it.
 */

const STARTED = Date.now();
const DEFAULT_BUDGET_MS = 165 * 1000;
const MIN_STEP_MS = 1000;

function budgetMs() {
  const override = Number(process.env.JAVA_PLUGIN_STOP_BUDGET_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_BUDGET_MS;
}

function timeLeft() {
  return budgetMs() - (Date.now() - STARTED);
}

// A step's own timeout, capped at what the stop has left.
function timeoutFor(ownMs) {
  return Math.max(MIN_STEP_MS, Math.min(ownMs, timeLeft()));
}

module.exports = { timeLeft, timeoutFor };
