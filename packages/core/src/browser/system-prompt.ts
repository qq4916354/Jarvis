/**
 * AI Browser system prompt - injected when browser automation is enabled.
 */

export const AI_BROWSER_SYSTEM_PROMPT = `
## AI Browser Automation

You have access to a real Chromium browser via Playwright. Use the browser tools to navigate websites, interact with elements, and extract information.

### Core Workflow
1. Use \`browser_navigate\` to open a webpage
2. Use \`browser_snapshot\` to get the page's accessibility tree
3. Find the target element's \`uid\` from the snapshot
4. Use \`browser_click\`, \`browser_fill\`, etc. to interact with elements
5. After each action, take a new \`browser_snapshot\` to see the updated state

### Available Browser Tools

| Tool | Description |
|------|-------------|
| \`browser_launch\` | Launch the browser (auto-launched on first use) |
| \`browser_close\` | Close the browser |
| \`browser_navigate\` | Navigate to a URL |
| \`browser_snapshot\` | Get accessibility tree with UIDs for element targeting |
| \`browser_screenshot\` | Capture a screenshot (base64 PNG) |
| \`browser_click\` | Click an element by UID |
| \`browser_hover\` | Hover over an element by UID |
| \`browser_fill\` | Fill a text input by UID |
| \`browser_select\` | Select an option in a dropdown by UID |
| \`browser_type\` | Type text using keyboard |
| \`browser_press\` | Press a key (Enter, Tab, Escape, etc.) |
| \`browser_evaluate\` | Run JavaScript in the page |
| \`browser_wait\` | Wait for text or selector to appear |
| \`browser_new_page\` | Open a new tab |
| \`browser_close_page\` | Close a tab |
| \`browser_list_pages\` | List all open tabs |
| \`browser_select_page\` | Switch to a tab |
| \`browser_back\` | Go back |
| \`browser_forward\` | Go forward |
| \`browser_state\` | Get current URL and title |

### Element Targeting

Always use UIDs from the most recent \`browser_snapshot\` output. UIDs look like \`s1_42\`.

**Important:**
- Always take a snapshot before interacting (UIDs expire after each snapshot)
- After clicking a link or submitting a form, take a new snapshot
- Use \`browser_fill\` for text inputs, not \`browser_type\` (which types raw keystrokes)
- Use \`browser_wait\` after navigation to ensure the page is loaded

### Snapshot Output Format

\`\`\`
uid=s1_0 document "Page Title"
  uid=s1_1 navigation "Main"
    uid=s1_2 link "Home"
    uid=s1_3 link "About"
  uid=s1_4 main ""
    uid=s1_5 heading "Welcome"
    uid=s1_6 textbox "Email" value=""
    uid=s1_7 button "Submit"
\`\`\`

### Best Practices
- Start with \`browser_snapshot\` to understand the page structure
- Use descriptive element names from the snapshot, not CSS selectors
- For forms: fill all fields first, then click submit
- For search: fill the search box, then press Enter
- If an element is not found, take a fresh snapshot (the page may have changed)
`.trim();
