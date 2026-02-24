# Project Instructions

## Git workflow

For all code changes: create a PR and ask the user to review and approve before merging to main.

Branch protection is enabled on main — direct pushes are rejected. All changes must go through a PR.

## Visual Verification

For UI changes: use `preview_start` to run the dev server, then use preview tools
(snapshot, screenshot, inspect, click) to verify changes visually before reporting
done. Never ask the user to check manually.

## TODO.md

The user edits TODO.md periodically. It's fine to leave it uncommitted on disk. When creating the next PR for any other reason, check if TODO.md has local uncommitted changes and bundle them into that PR branch before merging.
