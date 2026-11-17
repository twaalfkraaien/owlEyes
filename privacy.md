# owlEyes Privacy Policy

Effective date: November 17, 2026

owlEyes is a browser extension that tags usernames, URLs, domains and
subreddits with user-defined labels and colors, and optionally shares those
databases with other users through GitHub gists.

This policy describes what data the extension stores, what it transmits,
and who it is transmitted to. Keep in mind the extension stores and processes
everything on your own device or your own GitHub account.

## Notice and consent

On a fresh install, owlEyes shows an in-extension data notice before it does any
work. No page text is read, no identifier is stored, and no network request is
made until you click "I agree".

You can withdraw consent at any time from the "Privacy & consent" link in
Settings. Withdrawing consent stops page scanning, syncing and Bluesky actions, and removes stored GitHub and
Bluesky credentials. Your labels and tagged identifiers stay on your device
until you clear them. Automatic gist sync is off by default.

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

## Data transmitted to third parties

The extension communicates only with GitHub (via `api.github.com` and
`gist.githubusercontent.com`) and, only if you sign in, Bluesky (via
`bsky.social`) — in both cases only when you opt in:

- **Gist subscriptions.** When you subscribe to a gist, the extension fetches
  that gist's JSON content and merges the identifiers it contains into your
  local database. This happens when you refresh, subscribe, or on the automatic
  ~6 hour sync, which is off by default and can be enabled in settings.
- **Gist uploads.** When you configure an upload and push, the extension reads
  your current database, merges it with the gist's existing content, and
  writes the combined JSON back to the gist you specified. This transmits the
  identifiers tagged with the labels you selected to that gist.
- **GitHub token.** If you enter a personal access token to enable uploads,
  it is sent only to GitHub's API in order to authenticate as your own GitHub
  account. Nothing else can read or use it.
- **Bluesky sign-in.** If you optionally sign in with a Bluesky app password,
  the extension talks to `bsky.social` to authenticate that account and to
  apply your auto block/mute settings. It sends Bluesky handles to look up
  the matching account DID and records block/mute actions on your own Bluesky
  account. This happens when you tag an account with an auto block/mute
  label, visit their Bluesky profile, or use the "block all listed accounts
  now" button. When not signed in, no Bluesky data is transmitted and the
  page-clicker approach is used instead.

Anyone who can view the gists you subscribe to or upload to (per your GitHub
privacy settings) can see the identifiers they contain. You control which
gists you use and whether this sharing happens at all.

## Browsing activity

To highlight tagged identifiers and apply auto block/mute, the extension reads
the text content of pages on X/Twitter (`x.com`, `twitter.com`) and Bluesky
(`bsky.app`) — the sites it is installed for. This is processed entirely
locally to find matches; the page content is never sent off your device.

## Permissions

- `storage` — store your database and settings locally.
- `contextMenus` — tag items via the right-click menu.
- `alarms` — run automatic gist syncing at the interval you choose.
- `activeTab` — apply tags to the active page from the popup.
- Content scripts and host access on `x.com`, `twitter.com` and `bsky.app` — highlight your tags and run auto block/mute there.
- Optional host access for `api.github.com`/`gist.githubusercontent.com` (gist sync) and `bsky.social` (Bluesky API, only if you sign in) — requested only when you use those features.

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
