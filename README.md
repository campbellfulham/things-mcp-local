# Things MCP Server

This is a zero-dependency bridge that allows Claude and ChatGPT to read and manage [Things 3](https://culturedcode.com/things/) on your Mac.

- Runs completely locally, nothing is downloaded at install
- No third-party packages, only uses Node's built-in modules
- Never writes to the Things database for added protection and cloud syncing
- Can be connected as-is to other AI agents

---

## Features

| Feature | Description |
|---|---|
| **Create** | Add new items with notes, deadlines, reminders, tags, checklists, etc. |
| **Read** | Read any items with full details including in-item checklists, tags, project, area, heading, deadlines, and notes. |
| **Edit** | Edit task details, reschedule, move, add or clear a deadline, edit tags, complete, or cancel a task. Can bulk edit up to 500 items at once. |
| **Find** | Find tool allows for detailed search and filter of any items based on text, tag, status, deadline, or even a created/completed date range. |
| **Misc** | Move to Trash (always reversible), open an item in Things app, and MCP status check. |

## Install for Claude

**Requirements:** macOS, Things 3, and the Claude desktop app (which supplies Node, so there's nothing else to install).

1. In Things: **Settings → General → Enable Things URLs**.
2. Download `things-local.mcpb` from [Releases](../../releases), or build it yourself (see below), then double-click it and click **Install** in the Claude app.
3. The first time Claude uses it, macOS asks whether Claude may control Things, and later whether it may access data from other apps (for checklists, headings and search). Allow both.

### Optional: auth token

Without it, everything works except evening/reminder times, checklist edits, heading moves, deadline clearing and duplicating on *existing* items (Things requires its token for those). To add it, go to **Things → Settings → General → Enable Things URLs → Manage**, copy the token, then paste it into **Claude → Settings → Extensions → Things (Local)** and save.

**Then install a newer version of the extension.** The Claude app only applies a saved token on install or update, so restarting isn't enough. To confirm, ask Claude to run the `status` tool, which reports whether the token arrived without showing it.

## Set up ChatGPT on Mac or iPhone

Use the same 26 Things tools in a local Codex chat on your Mac or from the ChatGPT iPhone app through a paired Mac. For regular Chat or Work, connect a personal custom MCP plugin through OpenAI Secure MCP Tunnel. See the [ChatGPT setup guide](docs/chatgpt.md).

## Limitations

- **macOS only**, as Things' automation interfaces are Mac-only.
- Some edits to existing items need the auth token (above).
- Checklist and heading reading depends on Things' database layout, which Cultured Code doesn't document or guarantee.
- Things doesn't return an ID when an item is created by URL, so the server confirms new items by reading them back by title. If two identical titles are created within a few minutes, it reports the newest.

## Development

```bash
npm test     # offline tests; no Mac or Things needed (Node 22.5+)
npm run pack # builds things-local.mcpb with Anthropic's official packager
```

The tests cover the MCP protocol, the syntax of every script sent to Apple's engine, read/write logic against a simulated Things object model, URL encoding with hostile input, the read-only database layer, and a regression test for each bug in the [changelog](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).

*Unofficial. Not affiliated with or endorsed by Cultured Code. "Things" is a trademark of Cultured Code GmbH & Co. KG.*
