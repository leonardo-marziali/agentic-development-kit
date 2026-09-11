'use strict';

/*
 * Agentic development lint-fix-loop kit: the session-scoped "track what was
 * touched, then check it before the session ends" pattern, shared by the
 * plugins in this marketplace.
 */

module.exports = {
  ...require('./exec'),
  ...require('./hook-input'),
  ...require('./state'),
  ...require('./track'),
  ...require('./loop'),
};
