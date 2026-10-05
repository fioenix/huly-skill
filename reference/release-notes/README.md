# Proposed historical release note cleanup

[`v1.10.4-sanitized.md`](./v1.10.4-sanitized.md) is a proposed replacement body for
[GitHub release v1.10.4](https://github.com/fioenix/huly-skill/releases/tag/v1.10.4).
It preserves the bug, fix, regression-test coverage, and repair-script semantics,
while removing a deployment-specific workspace name, project identifiers, and
operational counts from the final bullet.

The existing disclosure intent is unknown. Applying this to the historical
GitHub Release, and making the matching edit to `CHANGELOG.md`'s 1.10.4 entry,
requires the owner's review. This PR only prepares the replacement; it does not
edit the release or rewrite Git history. Previously published copies may remain.
