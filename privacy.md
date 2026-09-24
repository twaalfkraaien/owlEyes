# owlEyes Privacy Policy

Effective date: September 24, 2026

owlEyes is a browser extension that tags usernames, URLs, domains and
subreddits with user-defined labels and colors, and optionally shares those
databases with other users through GitHub gists.

This policy describes what data the extension stores, what it transmits,
and who it is transmitted to. Keep in mind the extension stores and processes
everything on your own device or your own GitHub account.

## Data collection

The extension **does not collect or send any data to its developer**. It has
no servers, no analytics, no telemetry, and no advertising. It makes network
requests only to GitHub, and only when you use a gist feature (see below).

## Locally stored data

All of the following is stored in your browser's extension storage
(`browser.storage.local`) and never leaves your device unless you use/enable a gist
feature:

- The identifiers you tag (usernames, URLs, domains, subreddits, free text)
  and the label applied to each.
- Your labels (id, name, color).
- Your GitHub gist subscriptions and upload configurations (gist URL,
  filename, labels included).
- Your GitHub personal access token (see "GitHub token" below).
- Hosts where highlighting is disabled, and your ignored-items list.
- Whether the extension and automatic gist syncing are enabled.

This data can be deleted at any time from the extension's settings (Clear all,
Remove, Export/Import, or by uninstalling the extension).

## Data transmitted to GitHub

The only parties the extension communicates with are GitHub's API
(`api.github.com`) and gist content host (`gist.githubusercontent.com`), and
only when you opt in:

- **Gist subscriptions.** When you subscribe to a gist, the extension fetches
  that gist's JSON content and merges the identifiers it contains into your
  local database. This happens when you refresh, subscribe, or on the automatic
  ~6 hour sync you can disable in settings.
- **Gist uploads.** When you configure an upload and push, the extension reads
  your current database, merges it with the gist's existing content, and
  writes the combined JSON back to the gist you specified. This transmits the
  identifiers tagged with the labels you selected to that gist.
- **GitHub token.** If you enter a personal access token to enable uploads,
  it is sent only to GitHub's API in order to authenticate as your own GitHub
  account. Nothing else can read or use it.

Anyone who can view the gists you subscribe to or upload to (per your GitHub
privacy settings) can see the identifiers they contain. You control which
gists you use and whether this sharing happens at all.

## Browsing activity

To highlight tagged identifiers on pages, the extension reads the text content
of the pages you visit. This is processed entirely locally to find matches; the
page content is never sent off your device.

## Permissions

- `storage` — store your database and settings locally.
- `contextMenus` — tag items via the right-click menu.
- `alarms` — run automatic gist syncing at the interval you choose.
- `activeTab` and `scripting` — apply tags to the active page from the popup.
- Content scripts on all sites — highlight your tags on pages you visit.

## Retention and deletion

- Local data remains on your device until you delete it or uninstall the
  extension. Uninstalling does not remove any gists you created or edited.
- Gist copies described above are stored by GitHub under your account and are
  subject to GitHub's own Terms of Service and privacy policy. Remove items on
  GitHub or delete the gist to delete those copies.
- Updating, disabling, or uninstalling the extension stops all future network
  activity.

## Children

The extension does not knowingly collect information from anyone, including
children; no personal information is collected by the developer at all.

## Changes to this policy

If this policy changes, the updated version will be published at the same URL
with a new effective date.

## Contact

If you have any questions, contact me via GitHub Issue.
