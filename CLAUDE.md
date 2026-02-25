# Project Instructions

## Git workflow

For all code changes: create a PR and ask the user to review and approve before merging to main.

Branch protection is enabled on main — direct pushes are rejected. All changes must go through a PR.

After merging a PR, delete the source branch if it is completely safe to do so (i.e. all commits are accounted for on main, whether via regular or squash merge). Do this automatically without asking.

## Visual Verification

For UI changes: use `preview_start` to run the dev server, then use preview tools
(snapshot, screenshot, inspect, click) to verify changes visually before reporting
done. Never ask the user to check manually.

## Local edits to markdown files

The user edits CLAUDE.md, TODO.md, and NOTES.md periodically. It's fine to leave it uncommitted on disk. When creating the next PR for any other reason, check if any of those have local uncommitted changes and bundle them into that PR branch before merging.
