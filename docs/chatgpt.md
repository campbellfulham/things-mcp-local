# Use Things 3 with ChatGPT

The same Mac server runs all 26 tools available in Claude, with the same inputs and Things operations. This includes search and filters, projects, areas, tags, headings, checklists, creation, edits to up to 500 items at a time, duplication, Trash and restore. `show_in_things` brings Things to the front on the Mac. [Existing features and limits](../README.md#features)

| Where you want to use it | Connection |
| --- | --- |
| Codex in the ChatGPT Mac app | The app starts the server locally using standard input and output (stdio). |
| Codex in the ChatGPT iPhone app | Pair your iPhone with the Mac and start or resume a chat on that Mac. |
| Chat or Work on the web, desktop, or iPhone | Create a personal custom MCP plugin on the web with Secure MCP Tunnel. Use it where the installed plugin is available to your account and workspace. |

ChatGPT on the web supports Streamable HTTP and SSE for URL-based MCP connections. Secure MCP Tunnel can reach the existing stdio server from the Mac over an outbound connection to OpenAI. The server and database stay on the Mac, and the setup requires no public endpoint or inbound port. Tool arguments and returned Things entries are sent to ChatGPT when you use the integration, including in Codex. Keep the plugin private, and keep any tokens, database files, and tool transcripts out of GitHub. [Local MCP setup](https://learn.chatgpt.com/docs/extend/mcp) · [Custom MCP plugins](https://developers.openai.com/api/docs/guides/custom-mcp-server) · [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) · [Plugin availability](https://learn.chatgpt.com/docs/plugins)

## Prepare the Mac

1. Run Things 3 under your own signed-in macOS user and enable **Things → Settings → General → Enable Things URLs**.
2. Install Node.js 22.5 or newer and download or clone this repository on the Mac. Run `command -v node` in Terminal to find the absolute Node path. The examples use `/opt/homebrew/bin/node` and `/Users/you/things-mcp-local`. Replace those paths with yours.
3. For sync to Things on iPhone, use the same Things Cloud account on both devices. The iPhone uses the Mac bridge for all MCP calls. [Things Cloud setup](https://culturedcode.com/things/support/articles/2803586/)

### Optional Things URL token

For full parity, including evening and reminder-time edits, checklist edits, heading moves, clearing deadlines, and duplicating existing items, copy the Things URL token from **Things → Settings → General → Enable Things URLs → Manage**.

Create a private file outside the repository using Terminal and edit it locally. The commands below create it without replacing an existing token file.

```sh
mkdir -p "$HOME/.config/things-mcp-local"
(umask 077; touch "$HOME/.config/things-mcp-local/things.env")
chmod 600 "$HOME/.config/things-mcp-local/things.env"
open -e "$HOME/.config/things-mcp-local/things.env"
```

Set `THINGS_AUTH_TOKEN="your-token-here"` on one line, save it as plain text, and use the absolute path in the setup below. Restart the server after changing it. The `status` tool reports whether the token was received. The Things token is separate from the OpenAI tunnel key.

## Codex on Mac and iPhone

On the Mac, add the following block once to your Codex user configuration at `~/.codex/config.toml`, using your absolute paths. If you are skipping the Things token, remove the entire `--env-file=…` argument.

```toml
[mcp_servers.things_local]
command = "/opt/homebrew/bin/node"
args = [
  "--env-file=/Users/you/.config/things-mcp-local/things.env",
  "/Users/you/things-mcp-local/server/index.js",
  "--chatgpt",
]
default_tools_approval_mode = "writes"
tool_timeout_sec = 300
```

Restart the ChatGPT desktop app or select **Restart** in **Settings → MCP servers**. Start a local Codex chat on this Mac and use `/mcp` to check for `things_local`. Ask it to call `status`, then `get_list` for Inbox to check macOS access. Review any macOS prompts for ChatGPT to automate Things or read application data.

For iPhone, on the Mac open **ChatGPT → Settings → Connections → Control this Mac or PC → Set up**. Scan the QR code with the iPhone using the same ChatGPT account and workspace. In the iPhone app, open **Codex** (or **Remote**), choose your Mac, and start or resume the local chat. Keep the Mac signed in, awake, online, and running the ChatGPT app. [Pairing and host requirements](https://learn.chatgpt.com/docs/remote-connections)

To disconnect, remove or disable `things_local` in **Settings → MCP servers** and restart. To remove phone access, remove the paired device under **Settings → Connections**.

## Personal plugin for Chat or Work

This setup requires access to **Add custom MCP server** in your ChatGPT workspace and to Secure MCP Tunnel in OpenAI Platform. Use a personal plugin and associate its tunnel only with the intended organization and workspace. Creating a tunnel requires Tunnels Read + Manage. Running it and selecting it require Tunnels Read + Use.

1. In [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels), create a tunnel, copy its ID, and download the official `tunnel-client` for your Mac. Run `tunnel-client help quickstart` after installing the binary.
2. Create a restricted Platform runtime API key with Tunnels Read + Use. Save just the key in a separate owner-only file outside the repository, for example `/Users/you/.config/things-mcp-local/tunnel.key` (mode `600`). Supply it by file reference as shown below.
3. From Terminal under the same macOS user as Things, configure and start the tunnel. Substitute your tunnel ID and absolute paths. Skip the `--env-file=…` argument inside the command if you are skipping the Things token.

   ```sh
   tunnel-client init --sample sample_mcp_stdio_local \
     --profile things-local-chatgpt \
     --tunnel-id tunnel_YOUR_ID \
     --control-plane-api-key-ref file:/Users/you/.config/things-mcp-local/tunnel.key \
     --mcp-command '"/opt/homebrew/bin/node" "--env-file=/Users/you/.config/things-mcp-local/things.env" "/Users/you/things-mcp-local/server/index.js" --chatgpt'

   tunnel-client doctor --profile things-local-chatgpt --explain
   tunnel-client run --profile things-local-chatgpt
   ```

4. While the tunnel is running, open [ChatGPT Plugins](https://chatgpt.com/plugins) in your browser. Select **+ → Add custom MCP server**, name it **Things (Mac)**, choose **Tunnel**, then select or enter your tunnel ID. Select **No authentication** at the MCP server step for this private stdio backend. Tunnel and plugin access are governed by OpenAI account and workspace permissions. Keep the plugin in your personal plugins and install it.
5. In a supported Chat or Work conversation, choose **@Things (Mac)** and run `status`. Then try an Inbox read, create one clearly labeled test to-do, and confirm it in Things on Mac and iPhone. For changes, review the tool arguments before approving. Try the same plugin in the iPhone app under the same account and workspace. If it is unavailable there, use the paired Mac through Codex on iPhone.

Keep the tunnel running on the awake Mac during use. Stop it with Ctrl+C to take the connection offline. Uninstall the plugin or remove its connection in ChatGPT to disconnect it. [Tunnel setup and permissions](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) · [Custom MCP setup and confirmations](https://developers.openai.com/api/docs/guides/custom-mcp-server)

## Troubleshooting

- **macOS permissions.** Run the first reads while at the Mac so you can approve the prompts. Check **System Settings → Privacy & Security → Automation** for the app that launched the server, usually ChatGPT for local Codex or Terminal for the tunnel. If `status` reports that the database is unreadable, check the macOS data access prompt and confirm Node is at least 22.5.
- **Tunnel discovery.** Keep `tunnel-client run` active, rerun `doctor`, and verify the Platform key permissions and association with the target ChatGPT workspace.
- **Large updates.** The tunnel has a 120-second request deadline, which can interrupt the response to a slow bulk update. Verify what applied with `find` before retrying and use smaller batches through the tunnel. Local Codex uses the configurable timeout above. [Tunnel limits](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#limits)

## Offline checks

Run `npm test` from the repository root. Tests exercise discovery in both modes, confirm that the ChatGPT mode uses the same tool names and input schemas, and check local token loading and data handling against synthetic fixtures.
