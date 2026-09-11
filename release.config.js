// This repo is a private plugin marketplace whose own version is the git tag,
// not package.json's "version" — so the root package.json stays "0.0.0" and
// only CHANGELOG.md is committed back to main by @semantic-release/git (see
// README's "Releases & versioning" for why that push needs a
// branch-protection bypass actor for the release workflow).
//
// The one thing here that IS published to npm is packages/ad-lfl-kit, the
// shared hook loop the plugins depend on. @semantic-release/npm stamps the
// release version into that package alone via pkgRoot and publishes it; its
// "version" field stays "0.0.0-development" in git for the same reason the
// root's stays "0.0.0". The published version is what plugins pin in their
// own package-lock.json, so a release must land before a plugin can pin it.
module.exports = {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    [
      '@semantic-release/npm',
      {
        pkgRoot: 'packages/ad-lfl-kit',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md'],
      },
    ],
    '@semantic-release/github',
  ],
};
