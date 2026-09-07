// This repo is a private plugin marketplace, not an npm package — the
// version that matters is the git tag / GitHub release, not package.json's
// "version" field. There's no @semantic-release/npm (nothing to publish),
// so package.json's "version" field intentionally stays "0.0.0" and only
// CHANGELOG.md is committed back to main by @semantic-release/git — see
// README's "Releases & versioning" for why that push needs a
// branch-protection bypass actor for the release workflow.
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md'],
      },
    ],
    '@semantic-release/github',
  ],
};
