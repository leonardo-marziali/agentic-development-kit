// This repo is a private plugin marketplace, not an npm package — the
// version that matters is the git tag / GitHub release, not package.json's
// "version" field. Only the plugins needed to compute that version and
// publish a tag + GitHub release are enabled; no @semantic-release/npm
// (nothing to publish) and no @semantic-release/git (no commit pushed back
// to the protected main branch — see README's "Releases & versioning").
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/github',
  ],
};
