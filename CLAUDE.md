# Project Instructions

After completing a task and presenting it for review, stop and wait for explicit user input. Do not interpret server logs or tool output as user feedback.

## Worktree setup

When working in a worktree, symlink the data directory and Python virtual environment from the main repo:

```
ln -s /Users/dfoygel/OrderHistory/data data
ln -s /Users/dfoygel/OrderHistory/.venv .venv
```

## TODO-driven workflow

Work items live in TODO.md. When asked to work on a TODO item:

- **Planning**: For larger or ambiguous items, write a detailed implementation plan inline in TODO.md under that item's section. Note any important choices or decisions. If you have questions, include them in TODO.md for the user to review. Do not start implementation until the user confirms.
- **Implementation**: For smaller or well-defined items, proceed directly unless you have critical questions.

When the user says "answers provided in TODO.md", read the updated TODO.md for their responses and proceed with implementation.

Always run full test suite before starting the project as well as at the end.

Update README.md as needed to keep the documentation and instructions accurate.

## Git workflow

For all code changes: create a new feature branch, do the work, then open a PR. Do not merge — wait for the user to review and approve.

Branch protection is enabled on main — direct pushes are rejected. All changes must go through a PR.

Never merge a feature branch that is behind main without first incorporating the latest main changes and verifying all tests pass on the combined result.

After merging a PR, delete the source branch if it is completely safe to do so (i.e. all commits are accounted for on main, whether via regular or squash merge). Do this automatically without asking.

## Visual Verification

For UI changes: use `preview_start` to run the dev server on a random port, then use preview tools (snapshot, screenshot, inspect, click) to verify changes visually before reporting done. Never ask the user to check manually. Give the user the localhost URL so they can also view the changes.

## PR approval workflow

When the user says "LGTM" in chat: update TODO.md to show a short summary of the completed task (consistent with the style of other completed items), then merge the open PR.

## Markdown file handling

The user edits CLAUDE.md, TODO.md, and NOTES.md periodically. These edits may sit uncommitted on disk — that's fine, don't commit them proactively.

There are two distinct cases:

1. **User asks for a markdown update in chat** (e.g., "update TODO.md #12"): include that change in the current PR or commit. It's part of the task.
2. **Pre-existing uncommitted markdown edits** (changes the user made on their own before this task): bundle these into the next PR branch so they don't get lost, but only when creating a PR for other work.
