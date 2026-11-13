# Changelog

Most bugs below were found by testing against a real Things library rather than by the offline suite. Each fix has a regression test, except where noted (fixes that need Things itself were verified live).

## 1.3.4 – 1.3.6: pre-publish QA
- **Bug (security):** if Things failed while handling a URL that carried the auth token, the token could appear in the error shown to Claude. **Fix:** the token is stripped from every error, log line and response, with a regression test that forces a failure.
- **Bug:** a missing or empty database was reported as "the database layout has changed". **Fix:** the server now says the database couldn't be found or opened.
- **Docs:** the token-gated features listed in the README and in the server's instructions to Claude now include clearing deadlines and duplicating.
- **Tests:** strengthened the projects-first lookup test and the read-only database test, which could have passed without proving their claims.
- **Bug (found live):** restoring a completed or cancelled item from the Trash reopened it, because Things reopens a closed item when it's moved into a list. **Fix:** restore puts its status back, so it returns to the Logbook. (Verified live; needs Things to test.)
- **Bug (found live):** `get_item`, `get_list` and edit results showed `when: null` for Someday items, because Things' scripting doesn't report Someday as a date. **Fix:** fill it in from the database, as `find` already did.
- **Bug (found live):** a completed or cancelled *to-do* couldn't be trashed ("could not find that item"); the 1.3 workaround only covered projects. **Fix:** the same reopen, trash, restore-status workaround now covers to-dos, with the same side effect on the completion date. (Verified live; needs Things to test.)

## 1.3.0 – 1.3.3: everything Things lets outside tools do
Audited every action in Cultured Code's [URL scheme](https://culturedcode.com/things/support/articles/2803573/) and [AppleScript](https://culturedcode.com/things/support/articles/4562654/) references against the tool list, then closed the gaps.
- **Added** `set_checklist_items` (tick, untick or cancel individual items by position or text), `duplicate_item`, `update_tag` (rename or nest), `restore_from_trash` (undocumented by Things; confirmed live), `when: "inbox"`, and `remove_from_project` / `remove_from_area` on single and bulk edits.
- **Bug:** completing or cancelling a project left its open to-dos open; the app closes them. **Fix:** close the project's open to-dos first, found through the read-only database (including to-dos under headings).
- **Bug (root cause of several):** Things' JavaScript scripting treats only *open* projects as projects; a completed or cancelled project comes back as a plain to-do. **Fix:** every result's `type` now comes from the database, and projects show accurate open and total to-do counts.
- **Bug:** a completed or cancelled project couldn't be trashed by any scripting route. **Fix:** briefly reopen it, trash it, then restore its status. Side effect: its completion date becomes the day it was trashed.
- **Bug:** creating an item in a deleted project or area silently landed it in the Inbox. **Fix:** refused with a clear error.
- **Not possible from outside Things** (no URL-scheme or AppleScript support): creating repeating to-dos or changing their schedule, reordering items, adding/renaming/archiving headings in an existing project, calendar events. **Deliberately excluded:** emptying the Trash and deleting tags or areas (permanent).

## 1.2.2: lessons from things.py
Compared this project's database queries with [things.py](https://github.com/thingsapi/things.py), the established Python library for reading Things.
- **Bug (latent, found by reading things.py):** Things keeps a hidden template behind every repeating to-do, which `find`, `get_tag_usage` and `get_headings` would have listed as an extra open item. **Fix:** exclude templates, as things.py does.
- **Added** reminder times to `find` results.
- **Comparison:** matches things.py's handling of trashed projects and headings; goes further on inherited tags, area filtering and a live Today list.

## 1.2.1: auth token, solved
- No code changes; version bump only.
- **Bug:** the saved auth token never reached the extension, even after restarts. A `status` tool (added in 1.0.4) reports whether the token arrived without revealing it, and showed it arriving as an unfilled placeholder. **Cause:** the Claude app applies a saved token only when an extension is installed or updated. **Fix:** update to a new version with the token already saved; README documents this.

## 1.2.0: search, bulk editing, tag reporting
Closes the feature gap with [hald/things-mcp](https://github.com/hald/things-mcp), after a tool-by-tool comparison.
- **Added** `find`: one tool that filters by any combination of tag, status, type, project, area, text, created/completed windows (`7d`, `2w`, `3m`, `1y`) and deadline/scheduled ranges. Tag matches include child tags and tags inherited from an item's project or area. Searching a 30,000-item library takes about 25 ms.
- **Added** `bulk_update`: one change across up to 500 items. All IDs are verified first and the batch is refused if any is missing; failures are reported per item.
- **Added** `get_tag_usage`: usage per tag, plus unused tags for cleanup.
- **Changed** `rename_area` → `update_area`, which can also set an area's tags.
- **Added** `prepend_checklist` to `update_item`.
- **Fixed** the Someday list to include open to-dos inside Someday projects, as Things itself shows them.
- **Designed in:** to-dos under a heading don't record their project in the database, so project filters resolve the project through the heading.
- **Bug (caught before release):** trashing a project marks only the project, not its to-dos, so the first version of `find` counted to-dos in trashed projects as live. **Fix:** exclude items whose project or heading is trashed.
- **Packaging note:** changing the manifest's author name made the Claude app install a second copy instead of updating. The author field is now fixed.

## 1.1.0: read checklists and headings
- **Added** `get_checklist` and `get_headings`. Things' scripting doesn't expose either, so these read Things' SQLite database in read-only mode. Verified against real checklists and projects, matching Things' own counts and on-screen order.
- **Decision:** reading the database is unofficial, so it is strictly read-only and never used for changes. (Later versions extended it to `find` and `get_tag_usage`; all writes still go through Things' official interfaces.)

## 1.0.4: token diagnostics
- **Added** the `status` tool: version, whether the auth token arrived (never showing it), and whether the database is readable. See 1.2.1.

## 1.0.3: projects and deadlines
- **Bug:** trashing a project failed with "could not find that item": lookups checked to-dos before projects, and Things also accepts a project's ID as a to-do. **Fix:** look up projects first.
- **Bug:** clearing a deadline failed, because Things' scripting can't empty a date. **Fix:** use the official URL scheme, where an empty `deadline=` clears it (requires the auth token).

## 1.0.2: live-testing fixes
- **Bug:** moving items to Today, Anytime or Someday failed with "Can't convert types". **Fix:** a small classic-AppleScript helper, with inputs passed as arguments, never inserted into the script.
- **Bug:** projects were labelled "to-do". **Fix:** check membership in the project list (superseded in 1.3).
- **Bug:** search with "include closed" missed projects and Logbook items. **Fix:** search all three.
- **Improved:** if an edit fails partway, the error now says which changes already applied.

## 1.0.1: startup timeout
- **Bug:** Claude reported "Request timed out" because the server only started when Node ran its file directly, and the Claude app loads extensions through a wrapper. **Fix:** always start, plus a regression test that loads the server through a wrapper.

## 1.0.0: initial release
- 16 tools for reading, creating and editing to-dos, projects, areas and tags.
- Zero dependencies, no network, writes only via AppleScript/JXA and the `things:///` URL scheme.
