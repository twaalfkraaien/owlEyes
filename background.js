// owlEyes background service worker (storage, gist sync, messaging).

importScripts('browser-polyfill.js');

// Fall back to a minimal promise wrapper over `chrome` if the polyfill failed.
if (typeof browser === 'undefined' && typeof chrome === 'object') {
    const wrap = (obj) => {
        const out = {};
        for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'function') {
                out[key] = (...args) => new Promise((resolve, reject) => {
                    try { val(...args, (...res) => { const [ok] = res; const err = chrome.runtime.lastError; if (err) reject(new Error(err.message)); else resolve(res.length > 1 ? res : res[0]); }); }
                    catch (e) { reject(e); }
                });
            } else if (val && typeof val === 'object') {
                out[key] = wrap(val);
            } else {
                out[key] = val;
            }
        }
        return out;
    };
    try { globalThis.browser = wrap(chrome); } catch (e) {}
}

// Register a listener only if the API exists. Returns true on success.
function safeAdd(parentName, eventName, fn) {
    try {
        const parent = parentName ? browser[parentName] : browser;
        if (parent && parent[eventName] && typeof parent[eventName].addListener === 'function') {
            parent[eventName].addListener(fn);
            debugLog('registered ' + parentName + '.' + eventName);
            return true;
        } else {
            debugLog('SKIP ' + parentName + '.' + eventName + ' (missing API)');
        }
    } catch (e) {
        debugLog('register ' + parentName + '.' + eventName + ' threw: ' + (e && e.message || e));
    }
    return false;
}

// Queue mutations so overlapping async messages can't interleave.
let mutationQueue = Promise.resolve();
function serialize(fn) {
    const run = mutationQueue.then(fn, fn);
    mutationQueue = run.then(() => {}, () => {});
    return run;
}

// ---- Diagnostic logging (persisted for the inspectable options page) ----
async function debugLog(msg) {
    try {
        const { __debug__ } = await browser.storage.local.get({ __debug__: [] });
        const arr = (Array.isArray(__debug__) ? __debug__ : []).slice(-50);
        arr.push({ t: new Date().toISOString(), msg });
        await browser.storage.local.set({ __debug__: arr });
    } catch (e) {}
}

const DEFAULT_LABELS = [];

const DEFAULT_SUBSCRIPTIONS = [];

function defaultState() {
    return {
        labels: DEFAULT_LABELS,
        items: {},            // identifier -> { labels: [{labelId, source}] }
        subscriptions: DEFAULT_SUBSCRIPTIONS,
        uploads: [],          // label-groups pushed to gists on change
        token: '',            // GitHub personal access token used for uploads
        disabledHosts: [],    // hostnames where content script is disabled
        ignoredItems: [],     // identifiers never re-added by gist sync
        syncEnabled: true,
        enabled: true
    };
}

async function getState() {
    const d = defaultState();
    // Passing typed defaults (not key-name strings) so missing keys return them.
    const got = await browser.storage.local.get({
        labels: d.labels,
        items: d.items,                     // {} object
        subscriptions: d.subscriptions,     // [] array
        uploads: d.uploads,                 // [] array
        token: d.token,                     // '' string
        disabledHosts: d.disabledHosts,     // [] array
        ignoredItems: d.ignoredItems,       // [] array
        syncEnabled: true,
        enabled: true
    });
    // Normalize field types to heal previously-corrupted storage.
    const state = {
        labels: Array.isArray(got.labels) ? got.labels : [],
        items: (got.items && typeof got.items === 'object' && !Array.isArray(got.items)) ? got.items : {},
        subscriptions: Array.isArray(got.subscriptions) ? got.subscriptions : [],
        uploads: Array.isArray(got.uploads) ? got.uploads : [],
        token: typeof got.token === 'string' ? got.token : '',
        disabledHosts: Array.isArray(got.disabledHosts) ? got.disabledHosts : [],
        ignoredItems: Array.isArray(got.ignoredItems) ? got.ignoredItems : [],
        syncEnabled: typeof got.syncEnabled === 'boolean' ? got.syncEnabled : true,
        enabled: typeof got.enabled === 'boolean' ? got.enabled : true
    };
    if (sanitizeState(state)) {
        await saveState(state); // persist the cleanup
    }
    return state;
}

// Returns a usable label id, or null if it's empty/"undefined".
function validLabelId(value) {
    return (typeof value === 'string' && value.trim() !== '' && value !== 'undefined')
        ? value
        : null;
}

// Drop corrupt labels and items referencing them. Returns true if changed.
function sanitizeState(state) {
    let changed = false;
    const cleanLabels = [];
    const keptIds = new Set();
    for (const label of state.labels) {
        const id = validLabelId(label && label.id);
        if (!id) { changed = true; continue; }
        // Never show "undefined" as a display name.
        const name = (typeof label.name === 'string' && label.name.trim() !== '' && label.name !== 'undefined')
            ? label.name
            : id;
        if (name !== label.name) changed = true;
        cleanLabels.push({ id, name, color: /^#[0-9a-f]{6}$/i.test(label.color) ? label.color : '#8b8b8b', visible: label.visible !== false, source: label.source || 'local' });
        keptIds.add(id);
    }
    if (cleanLabels.length !== state.labels.length) changed = true;
    state.labels = cleanLabels;

    const cleanedItems = {};
    for (const [id, entry] of Object.entries(state.items)) {
        const key = canonicalKey(id);
        if (!key) continue;
        if (key !== normalizeKey(id)) changed = true;   // Bluesky key migration
        const existing = cleanedItems[key];
        // Dedupe by canonical key, preferring any variant with a local label.
        if (existing) {
            const bothLocal = existing.labels && existing.labels[0] && existing.labels[0].source === 'local';
            const thisLocal = entry && entry.labels && entry.labels[0] && entry.labels[0].source === 'local';
            if (!bothLocal && thisLocal) {
                cleanedItems[key] = entry;
            }
            changed = true;
            continue;
        }
        if (!entry || !Array.isArray(entry.labels)) { changed = true; continue; }
        const filtered = entry.labels.filter(l => keptIds.has(l.labelId));
        if (filtered.length !== entry.labels.length) changed = true;
        if (filtered.length === 0) { changed = true; continue; }
        entry.labels = filtered;
        cleanedItems[key] = entry;
    }
    if (Object.keys(cleanedItems).length !== Object.keys(state.items).length) changed = true;
    state.items = cleanedItems;

    const cleanedIgnored = [];
    const ignoredSeen = new Set();
    for (const raw of (state.ignoredItems || [])) {
        const key = canonicalKey(raw);
        if (key && !ignoredSeen.has(key)) {
            ignoredSeen.add(key);
            cleanedIgnored.push(key);
        } else {
            changed = true;
        }
    }
    if (cleanedIgnored.length !== (state.ignoredItems || []).length) changed = true;
    state.ignoredItems = cleanedIgnored;
    return changed;
}

async function saveState(state) {
    await browser.storage.local.set({
        labels: state.labels,
        items: state.items,
        subscriptions: state.subscriptions,
        uploads: state.uploads,
        token: state.token,
        disabledHosts: state.disabledHosts,
        ignoredItems: state.ignoredItems,
        syncEnabled: state.syncEnabled,
        enabled: state.enabled
    });
    if (!suppressPushCheck) schedulePushCheck();
}

// ---- Gist fetching ------------------------------------------------------

// Normalize a subscription URL (trim, case-insensitive, no trailing slash).
function normalizeGistUrl(url) {
    let u = String(url || '').trim();
    if (!u) return '';
    try {
        const parsed = new URL(u);
        parsed.hash = '';
        parsed.search = '';
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        u = parsed.href;
    } catch (e) {
        return u.toLowerCase(); // not a parseable URL
    }
    return u;
}

// Resolve a gist URL to its first file's raw URL and fetch that JSON.
async function fetchGist(url) {
    let rawUrl = url.trim();
    const match = rawUrl.match(/gist\.github\.com\/[^/]+\/([0-9a-fA-F]+)/);
    if (match) {
        const gistId = match[1];
        const api = `https://api.github.com/gists/${gistId}`;
        const resp = await fetch(api);
        if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
        const gist = await resp.json();
        const files = Object.values(gist.files || {});
        if (files.length === 0) throw new Error('Gist has no files');
        rawUrl = files[0].raw_url;
    }
    const resp = await fetch(rawUrl);
    if (!resp.ok) throw new Error(`Fetch returned ${resp.status}`);
    const text = await resp.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('Gist content is not valid JSON');
    }
    return data;
}

// Parse the flat item map: {"id": "labelId"} or {"id": {labels:[...]}}.
function parseItemMap(data) {
    const out = {};
    for (const [id, entry] of Object.entries(data)) {
        if (!id || id === 'undefined') continue;
        if (typeof entry === 'string') {
            // {"foo": "labelId"} shorthand
            const lid = validLabelId(entry);
            if (!lid) continue;
            out[id.toLowerCase()] = { labels: [{ labelId: lid, source: 'gist' }] };
        } else if (entry && Array.isArray(entry.labels)) {
            const cleaned = entry.labels
                .filter(l => validLabelId(l && l.labelId))
                .map(l => ({ labelId: l.labelId, source: l.source || 'gist' }));
            if (cleaned.length > 0) out[id.toLowerCase()] = { labels: cleaned };
        }
    }
    return out;
}

// Parse a payload into { items, labelMeta }. Supports the wrapper
// {"labels": {...}, "items": {...}} or a legacy flat item map.
function parseGistDatabase(data) {
    const labelMeta = {};
    if (!data || typeof data !== 'object') throw new Error('Invalid database format');

    // Wrapper has "items" as a plain object; a flat map falls through below.
    const isWrapper = data.items && typeof data.items === 'object' && !Array.isArray(data.items);
    const itemSource = isWrapper ? data.items : data;

    if (isWrapper) {
        const lmap = data.labels;
        if (lmap && typeof lmap === 'object') {
            if (Array.isArray(lmap)) {
                for (const l of lmap) {
                    const id = validLabelId(l && l.id);
                    if (!id) continue;
                    labelMeta[id] = {
                        name: validLabelId(l && l.name) || id,
                        color: /^#[0-9a-f]{6}$/i.test((l && l.color) || '') ? l.color : '#8b8b8b'
                    };
                }
            } else {
                for (const [id, meta] of Object.entries(lmap)) {
                    if (!validLabelId(id)) continue;
                    const m = meta && typeof meta === 'object' ? meta : (typeof meta === 'string' ? { name: meta } : {});
                    labelMeta[id] = {
                        name: validLabelId(m.name) || id,
                        color: /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#8b8b8b'
                    };
                }
            }
        }
    }

    return { items: parseItemMap(itemSource), labelMeta };
}

// Canonical lowercase item key so case variants match one item.
function normalizeKey(id) {
    return (typeof id === 'string' ? id.trim().toLowerCase() : '');
}

// Identifier key matching resolveIdentifier's Bluesky form, migrating old keys.
function canonicalKey(id) {
    const key = normalizeKey(id);
    const PREFIX = 'bsky.app/';
    if (key.startsWith(PREFIX) && !key.startsWith(PREFIX + 'profile/') && key.length > PREFIX.length) {
        return PREFIX + 'profile/' + key.slice(PREFIX.length);
    }
    return key;
}

// Merge gist items into local, only adding new identifiers (minus ignored
// ones); existing entries are never overwritten.
function mergeIntoLocal(localItems, gistData, ignoreKeys) {
    let added = 0;
    for (const [id, entry] of Object.entries(gistData)) {
        const key = canonicalKey(id);
        if (!key) continue;
        if (ignoreKeys && ignoreKeys.has(key)) continue;
        // Skip existing keys, including any legacy mixed-case variants.
        if (Object.prototype.hasOwnProperty.call(localItems, key)) continue;
        const exists = Object.keys(localItems).some(k => canonicalKey(k) === key);
        if (exists) continue;
        localItems[key] = entry;
        added++;
    }
    return added;
}

// All label ids referenced by gist items.
function collectGistLabels(gistData) {
    const ids = new Set();
    for (const entry of Object.values(gistData)) {
        for (const l of entry.labels) {
            const id = validLabelId(l.labelId);
            if (id) ids.add(id);
        }
    }
    return ids;
}

async function refreshSubscription(sub, state) {
    try {
        const data = await fetchGist(sub.url);
        const { items: gistData, labelMeta } = parseGistDatabase(data);
        const labelIds = collectGistLabels(gistData);

        // Map gist label ids onto canonical local ids (case-insensitive) so a gist
        // can't create duplicate labels or dangling references.
        const canon = new Map();
        for (const lid of labelIds) {
            const existing = state.labels.find(l => l.id.toLowerCase() === lid.toLowerCase());
            canon.set(lid, existing ? existing.id : lid);
        }

        let changed = false;

        // Add gist labels that are unknown locally; never touch existing local
        // labels (local wins, same as the upload merge).
        for (const lid of labelIds) {
            const cid = canon.get(lid) || lid;
            const meta = labelMeta[lid] || {};
            if (state.labels.some(l => l.id === cid)) continue;
            state.labels.push({
                id: cid,
                name: meta.name || cid,
                color: meta.color || '#8b8b8b',
                visible: true,
                source: 'gist'
            });
            changed = true;
        }

        // Remap item label ids to canonical casing before merging.
        const remapped = {};
        for (const [id, entry] of Object.entries(gistData)) {
            remapped[id] = {
                labels: entry.labels.map(l => ({
                    labelId: canon.get(l.labelId) || l.labelId,
                    source: l.source || 'gist',
                })),
            };
        }

        const ignoreKeys = new Set((state.ignoredItems || []).map(canonicalKey));
        const added = mergeIntoLocal(state.items, remapped, ignoreKeys);
        if (added > 0 || changed) {
            await saveState(state);
        }
        return { added, labelIds: labelIds.size, ok: true, at: Date.now(), lastError: null };
    } catch (e) {
        return { ok: false, at: Date.now(), lastError: String(e && e.message || e) };
    }
}

async function refreshAllSubscriptions(options) {
    const state = await getState();
    for (const sub of state.subscriptions) {
        if (sub.enabled === false) continue;   // per-gist toggle off
        const result = await refreshSubscription(sub, state);
        sub.lastSync = result.at;
        sub.lastError = result.lastError;
        sub.lastCount = result.added;
    }
    await saveState(state);
    notifyContent('refresh');
    if (options && options.includeMissingLabels) {
        await syncMissingLabels(state);
    }
    buildContextMenus(state);
    return state;
}

// Re-add labels referenced by items but missing locally (safety net).
async function syncMissingLabels(state) {
    const known = new Set(state.labels.map(l => l.id));
    for (const entry of Object.values(state.items)) {
        for (const l of (entry.labels || [])) {
            const labelId = validLabelId(l && l.labelId);
            if (!labelId || known.has(labelId)) continue;
            state.labels.push({ id: labelId, name: labelId, color: '#8b8b8b', source: 'gist' });
            known.add(labelId);
        }
    }
    await saveState(state);
}

// ---- Automatic gist uploads (push label-groups to gists on change) -------

// Extract a gist id from a gist URL, or ''.
function extractGistId(url) {
    const m = String(url || '').match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-fA-F]{7,32})/);
    return m ? m[1] : '';
}

// Build a gist database payload (label colors + items with those labels) for
// an upload/export, in the format parseGistDatabase consumes.
function buildGistPayload(labelIds, state) {
    const labelSet = new Set(labelIds);
    const items = {};
    for (const [id, entry] of Object.entries(state.items)) {
        const cur = entry && entry.labels && entry.labels[0] && entry.labels[0].labelId;
        if (!cur || !labelSet.has(cur)) continue;
        items[id] = {
            labels: entry.labels.map(l => ({ labelId: l.labelId, source: 'gist' }))
        };
    }
    const labels = {};
    for (const lid of labelSet) {
        const l = state.labels.find(x => x.id === lid);
        if (l && validLabelId(l.id)) labels[l.id] = { name: l.name || l.id, color: l.color };
    }
    return { labels, items };
}

// Deterministic stringification so equivalent payloads hash equally.
function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort()
            .map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
}

// Cheap digest to detect "did the tag group change?".
function computeHash(payload) {
    const str = canonicalJson(payload);
    let h = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

// Union of two payloads; local wins, gist-only entries preserved (additive).
function mergeGistPayload(gistPayload, localPayload) {
    return {
        labels: Object.assign({}, gistPayload.labels, localPayload.labels),
        items: Object.assign({}, gistPayload.items, localPayload.items)
    };
}

// Push one upload. Additive: reads the gist's current content and merges, so
// re-tagging/removing locally never deletes gist entries. Returns
// { ok, at, error?, hash?, changed? } on the merged payload.
async function pushUpload(upload, state, localPayload) {
    try {
        const gistId = extractGistId(upload.url);
        if (!gistId) throw new Error('Invalid gist URL');
        const token = String(state.token || '').trim();
        if (!token) throw new Error('No GitHub token configured');
        const filename = String(upload.filename || '').trim() || 'owleyes.json';

        const apiUrl = `https://api.github.com/gists/${gistId}`;
        const headers = {
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'owlEyes'
        };

        // Read what's currently in the gist so we can append rather than replace.
        const gres = await fetch(apiUrl, { headers });
        if (!gres.ok) throw new Error('Could not read gist: GitHub API returned ' + gres.status);
        const gist = await gres.json().catch(() => null);
        const file = gist && gist.files && gist.files[filename];
        let gistPayload = { labels: {}, items: {} };
        if (file && file.raw_url) {
            const raw = await fetch(file.raw_url, { headers });
            if (!raw.ok) throw new Error('Could not read gist file: HTTP ' + raw.status);
            const text = await raw.text().catch(() => '');
            if (text && text.trim()) {
                try {
                    const parsed = parseGistDatabase(JSON.parse(text));
                    gistPayload = { labels: parsed.labelMeta, items: parsed.items };
                } catch (e) {
                    throw new Error('Gist file is not valid JSON - refusing to overwrite it');
                }
            }
        }

        const merged = mergeGistPayload(gistPayload, localPayload);
        const mergedHash = computeHash(merged);
        if (mergedHash === upload.lastHash) {
            return { ok: true, at: Date.now(), error: null, hash: mergedHash, changed: false };
        }

        const resp = await fetch(apiUrl, {
            method: 'PATCH',
            headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ files: { [filename]: { content: JSON.stringify(merged, null, 2) } } })
        });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error('GitHub API returned ' + resp.status + (text ? ': ' + text.slice(0, 200) : ''));
        }
        return { ok: true, at: Date.now(), error: null, hash: mergedHash, changed: true };
    } catch (e) {
        return { ok: false, at: Date.now(), error: String(e && e.message || e), hash: null, changed: false };
    }
}

// Push uploads whose tag group changed since the last success (or force all).
async function pushUploads(state, opts) {
    opts = opts || {};
    const force = !!opts.force;
    const uploadId = opts.uploadId || null;
    let pushed = 0, errors = 0, changed = false;
    if (!Array.isArray(state.uploads)) return { pushed, errors };
    for (const upload of state.uploads) {
        if (upload.enabled === false) continue;
        if (uploadId && upload.id !== uploadId) continue;
        const localPayload = buildGistPayload(upload.labels || [], state);
        const localHash = computeHash(localPayload);
        // Skip if the group is unchanged since the last push.
        if (!force && localHash === upload.lastLocalHash) continue;
        const res = await pushUpload(upload, state, localPayload);
        if (res.ok) {
            if (res.hash) upload.lastHash = res.hash;
            upload.lastLocalHash = localHash;
            upload.lastError = null;
            if (res.changed) pushed++;
        } else {
            // Keep hashes stale so the next change/retry attempts again.
            upload.lastError = res.error;
            errors++;
        }
        upload.lastPush = res.at;
        changed = true;
    }
    if (changed) {
        suppressPushCheck = true;
        try {
            await saveState(state);
        } finally {
            suppressPushCheck = false;
        }
    }
    return { pushed, errors };
}

async function pushChangedUploads() {
    const state = await getState();
    if (!state.token) return { pushed: 0, errors: 0 };
    return pushUploads(state, { force: false });
}

async function pushAllUploads() {
    const state = await getState();
    return pushUploads(state, { force: true });
}

// Ensure a push check runs after any mutation. Debounced and dirty-flagged.
let pushDirty = false;
let pushRunning = false;
// While true, saveState skips schedulePushCheck (avoids a retry loop on failure).
let suppressPushCheck = false;
function schedulePushCheck() {
    pushDirty = true;
    queuePushCheck();
}
function queuePushCheck() {
    if (pushRunning) return;
    pushRunning = true;
    serialize(async () => {
        try {
            while (pushDirty) {
                pushDirty = false;
                const state = await getState();
                if (state.token) {
                    await pushUploads(state, { force: false });
                }
            }
        } catch (e) {
            debugLog('push check error: ' + (e && e.message || e));
        } finally {
            pushRunning = false;
            if (pushDirty) queuePushCheck();
        }
    });
}

// ---- Context menus + social media identifier resolution ------------------

// Map a clicked link URL to a canonical identifier (same user = same entity).
function resolveIdentifier(url) {
    let href;
    try {
        href = new URL(url);
    } catch (e) {
        return null;
    }
    const host = href.hostname.replace(/^www\./, '').toLowerCase();
    const path = href.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    const segs = path.split('/').filter(Boolean).map(s => decodeURIComponent(s));

    const mk = (kind, id) => (id ? { identifier: `${kind}${id}` } : null);
    // For URLs like host/<type>/<name>, use segs[1]; otherwise segs[0].
    const named = (prefix) => {
        const id = (segs[1] || segs[0] || '').replace(/^@/, '');
        return id ? mk(prefix, id) : null;
    };
    const handle = (prefix) => {
        const id = (segs[0] || '').replace(/^@/, '');
        return id ? mk(prefix, id) : null;
    };

    switch (host) {
        case 'reddit.com':
            if (segs[0] === 'user' || segs[0] === 'u') return named('reddit.com/user/');
            if (segs[0] === 'r') return named('reddit.com/r/');
            if (path) return mk('reddit.com/user/', path);
            return null;
        case 'twitter.com':
        case 'x.com':
        case 'mobile.twitter.com':
            if (segs[0] === 'i') return null;
            if (segs[0] === 'intent') return null;
            return handle('twitter.com/');
        case 'instagram.com':
            if (segs[0] === 'p' || segs[0] === 'reel' || segs[0] === 'reels' || segs[0] === 'explore') return null;
            return handle('instagram.com/');
        case 'tiktok.com':
        case 'vm.tiktok.com':
            return handle('tiktok.com/');
        case 'youtube.com':
        case 'm.youtube.com':
        case 'www.youtube.com':
            if (segs[0] === 'watch' || segs[0] === 'playlist' || segs[0] === 'shorts' || segs[0] === 'embed' || segs[0] === 'live') return null;
            if (segs[0] === 'channel' || segs[0] === 'c' || segs[0] === 'user') return named('youtube.com/');
            return handle('youtube.com/');
        case 'facebook.com':
        case 'm.facebook.com':
        case 'fb.com':
            if (!segs.length) return null;
            if (['groups', 'events', 'pages', 'people', 'profile.php', 'story.php', 'photo.php', 'photo', 'watch', 'share.php', 'sharer.php', 'messages', 'story', 'hashtag'].includes(segs[0])) return null;
            return mk('facebook.com/', segs[0]);
        case 'github.com':
            if (segs[0] === 'orgs') return named('github.com/');
            if (segs[0] === 'login' || segs[0] === 'settings') return null;
            return handle('github.com/');
        case 'twitch.tv':
        case 'm.twitch.tv':
            if (segs[0] === 'videos' || segs[0] === 'directory' || segs[0] === 'settings') return null;
            return handle('twitch.tv/');
        case 'bsky.app':
        case 'bsky.social':
            if (segs[0] === 'profile') return named('bsky.app/profile/');
            return null;
        case 'threads.net':
            return handle('threads.net/');
        case 'tumblr.com':
            if (segs.length === 0) return mk('tumblr.com/', host);
            if (segs[0] === 'blog' && segs[1]) return mk('tumblr.com/', segs[1]);
            return null;
        case 'mastodon.social':
        case 'mas.to':
        case 'tech.lgbt':
        case 'mstdn.social':
        case 'mastodon.online':
        case 'fosstodon.org':
        case 'hachyderm.io':
        case 'infosec.exchange':
        case 'mathstodon.xyz':
            if (segs[0].startsWith('@')) return mk(host + '/', segs[0].replace(/^@/, ''));
            return null;
        default:
            if (segs.length && segs[0].startsWith('@')) return handle(host + '/');
            return null;
    }
}

// Hosts where the link context menu should be shown.
const SOCIAL_HOSTS = [
    '*://*.reddit.com/*', '*://*.twitter.com/*', '*://*.x.com/*',
    '*://*.instagram.com/*', '*://*.tiktok.com/*', '*://*.youtube.com/*',
    '*://*.facebook.com/*', '*://*.github.com/*', '*://*.twitch.tv/*',
    '*://*.bsky.app/*', '*://*.bsky.social/*', '*://*.threads.net/*',
    '*://*.tumblr.com/*'
];

const CTX_ROOT = 'owleyes-context';
const CTX_TAG_PREFIX = 'owleyes-tag-';

async function buildContextMenus(state) {
    debugLog('buildContextMenus called; labels=' + (state.labels || []).length);
    // Only create items for labels with a real id.
    const validLabels = (state.labels || []).filter(l => validLabelId(l && l.id));
    // Must clear first — Chrome persists the tree across restarts and rejects
    // reusing ids. The polyfill's removeAll returns a promise, so await it.
    try {
        await browser.contextMenus.removeAll();
        debugLog('removeAll complete; creating ' + (validLabels.length + 1) + ' items');
        try {
            browser.contextMenus.create({
                id: CTX_ROOT,
                title: 'owlEyes',
                contexts: ['link'],
                targetUrlPatterns: SOCIAL_HOSTS
            }, () => debugLog('create root ok'));
            const seen = new Set();
            for (const label of validLabels) {
                if (seen.has(label.id)) continue;
                seen.add(label.id);
                try {
                    browser.contextMenus.create({
                        id: CTX_TAG_PREFIX + label.id,
                        parentId: CTX_ROOT,
                        title: `Toggle tag (${label.name})`,
                        contexts: ['link'],
                        targetUrlPatterns: SOCIAL_HOSTS
                    }, () => debugLog('create tag ' + label.id + ' ok'));
                } catch (e) {
                    debugLog('create tag ' + label.id + ' failed: ' + (e && e.message || e));
                }
            }
        } catch (e) {
            debugLog('create threw: ' + (e && e.message || e));
        }
    } catch (e) {
        debugLog('removeAll threw: ' + (e && e.message || e));
    }
}

// Applied label object for an identifier, or null.
function currentLabelFor(state, identifier) {
    const entry = state.items[normalizeKey(identifier)];
    if (!entry || !Array.isArray(entry.labels) || entry.labels.length === 0) return null;
    return state.labels.find(l => l.id === entry.labels[0].labelId) || null;
}

// Note: onShown isn't available here (Opera), so the menu can't know which
// link was right-clicked; the click handler toggles the tag on the target link.

safeAdd('contextMenus', 'onClicked', (info, tab) => {
    return serialize(async () => {
        try {
            if (!info.linkUrl) return;
            const identifier = resolveIdentifier(info.linkUrl);
            if (!identifier) return;

            const state = await getState();
            const id = normalizeKey(identifier.identifier);

            if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(CTX_TAG_PREFIX)) {
                const labelId = info.menuItemId.slice(CTX_TAG_PREFIX.length);
                const current = currentLabelFor(state, id);
                if (current && current.id === labelId) {
                    // Toggling off the applied label removes the item.
                    delete state.items[id];
                } else {
                    state.items[id] = { labels: [{ labelId, source: 'local' }] };
                }
                await saveState(state);
                notifyContent('refresh');
            }
        } catch (e) {}
    });
});

// ---- Messaging ----------------------------------------------------------

async function handleMessage(message, sender) {
    switch (message.type) {
        case 'debugGet': {
            const { __debug__ } = await browser.storage.local.get({ __debug__: [] });
            return { ok: true, log: Array.isArray(__debug__) ? __debug__ : [] };
        }
        case 'debugClear': {
            await browser.storage.local.remove('__debug__');
            return { ok: true };
        }
        case 'getState': {
            const state = await getState();
            return { ok: true, state };
        }
        case 'setItem': {
            const state = await getState();
            const id = normalizeKey(message.identifier);
            if (!id || id === 'undefined') return { ok: false, error: 'empty identifier' };
            const entry = state.items[id] || { labels: [] };
            if (message.labels !== undefined) {
                entry.labels = message.labels
                    .filter(labelId => validLabelId(labelId))
                    .map(labelId => ({ labelId, source: 'local' }));
            }
            if (entry.labels.length === 0) {
                delete state.items[id];
            } else {
                state.items[id] = entry;
            }
            await saveState(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'removeItem': {
            const state = await getState();
            const id = normalizeKey(message.identifier);
            delete state.items[id];
            await saveState(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'clearItems': {
            const state = await getState();
            state.items = {};
            await saveState(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'ignoreItem': {
            // Remove the item locally and add it to the ignore list so gist
            // syncs won't re-add it. The list is local-only (never exported).
            const state = await getState();
            const id = normalizeKey(message.identifier);
            if (!id || id === 'undefined') return { ok: false, error: 'empty identifier' };
            if (!state.ignoredItems) state.ignoredItems = [];
            const already = state.ignoredItems.includes(id);
            if (!already) state.ignoredItems.push(id);
            delete state.items[id];
            await saveState(state);
            notifyContent('refresh');
            return { ok: true, ignored: !already };
        }
        case 'unignoreItem': {
            // Drop an identifier from the ignore list so a future gist sync
            // (or manual re-add) can bring it back.
            const state = await getState();
            const id = normalizeKey(message.identifier);
            state.ignoredItems = (state.ignoredItems || []).filter(x => x !== id);
            await saveState(state);
            return { ok: true };
        }
        case 'addLabel': {
            const state = await getState();
            const id = validLabelId(message && message.labelId);
            if (!id || state.labels.some(l => l.id === id)) {
                return { ok: false, error: 'duplicate or empty id' };
            }
            const name = validLabelId(message.name) || id;
            state.labels.push({ id, name, color: /^#[0-9a-f]{6}$/i.test(message.color || '') ? message.color : '#8b8b8b', visible: true, source: 'local' });
            await saveState(state);
            buildContextMenus(state);
            return { ok: true };
        }
        case 'updateLabel': {
            const state = await getState();
            const label = state.labels.find(l => l.id === message.labelId);
            if (!label) return { ok: false, error: 'not found' };
            if (message.name !== undefined) label.name = message.name;
            if (message.color !== undefined) label.color = message.color;
            if (message.visible !== undefined) label.visible = !!message.visible;
            await saveState(state);
            if (message.name !== undefined) buildContextMenus(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'removeLabel': {
            const state = await getState();
            const labelId = message.labelId;
            // Remove label, and remove all items that become empty.
            state.labels = state.labels.filter(l => l.id !== labelId);
            for (const [id, entry] of Object.entries(state.items)) {
                entry.labels = entry.labels.filter(l => l.labelId !== labelId);
                if (entry.labels.length === 0) delete state.items[id];
            }
            await saveState(state);
            buildContextMenus(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'addSubscription': {
            const state = await getState();
            const raw = (message.url || '').trim();
            if (!raw) return { ok: false, error: 'empty url' };
            const url = normalizeGistUrl(raw);
            if (!url) return { ok: false, error: 'invalid url' };
            // Dedup against normalized forms (trim/case/trailing slash insensitive).
            if (state.subscriptions.some(s => normalizeGistUrl(s.url) === url)) {
                return { ok: false, error: 'already subscribed' };
            }
            const sub = { url, id: 'sub_' + Date.now(), lastSync: null, lastError: null, lastCount: 0, enabled: true };
            state.subscriptions.push(sub);
            await saveState(state);
            const result = await refreshSubscription(sub, state);
            sub.lastSync = result.at;
            sub.lastError = result.lastError;
            sub.lastCount = result.added;
            await saveState(state);
            await syncMissingLabels(state);
            buildContextMenus(state);
            return { ok: result.ok, lastError: result.lastError, added: result.added };
        }
        case 'removeSubscription': {
            const state = await getState();
            state.subscriptions = state.subscriptions.filter(s => s.id !== message.id);
            await saveState(state);
            return { ok: true };
        }
        case 'setSubscriptionEnabled': {
            const state = await getState();
            const sub = state.subscriptions.find(s => s.id === message.id);
            if (!sub) return { ok: false, error: 'not found' };
            sub.enabled = !!message.enabled;
            await saveState(state);
            if (sub.enabled) {
                // Re-enabling a gist syncs it immediately.
                const result = await refreshSubscription(sub, state);
                sub.lastSync = result.at;
                sub.lastError = result.lastError;
                sub.lastCount = result.added;
                await saveState(state);
                await syncMissingLabels(state);
                buildContextMenus(state);
                return { ok: true, added: result.added, lastError: result.lastError };
            }
            return { ok: true };
        }
        case 'refreshSubscriptions': {
            const state = await refreshAllSubscriptions({ includeMissingLabels: true });
            return { ok: true, state };
        }
        case 'setToken': {
            const state = await getState();
            state.token = String(message.token || '').trim();
            await saveState(state);
            return { ok: true };
        }
        case 'addUpload': {
            const state = await getState();
            const raw = (message.url || '').trim();
            const url = normalizeGistUrl(raw);
            if (!url || !extractGistId(url)) return { ok: false, error: 'invalid gist url' };
            const labelIds = (Array.isArray(message.labels) ? message.labels : [])
                .filter(lid => validLabelId(lid) && state.labels.some(l => l.id === lid));
            if (labelIds.length === 0) return { ok: false, error: 'select at least one label' };
            let filename = String(message.filename || '').trim().replace(/[\\/:*?"<>|]/g, '');
            if (!filename) filename = 'owleyes.json';
            const upload = {
                id: 'pub_' + Date.now(),
                name: String(message.name || '').trim() || 'Upload',
                url,
                filename,
                labels: labelIds,
                enabled: true,
                lastHash: null,
                lastPush: null,
                lastError: null
            };
            state.uploads.push(upload);
            // Set change-hashes without pushing — setup must not clobber the
            // gist; the first group change pushes (merging existing content).
            const localSnapshot = buildGistPayload(upload.labels || [], state);
            upload.lastHash = computeHash(localSnapshot);
            upload.lastLocalHash = upload.lastHash;
            await saveState(state);
            return { ok: true, upload };
        }
        case 'removeUpload': {
            const state = await getState();
            state.uploads = state.uploads.filter(u => u.id !== message.id);
            await saveState(state);
            return { ok: true };
        }
        case 'setUploadEnabled': {
            const state = await getState();
            const upload = state.uploads.find(u => u.id === message.id);
            if (!upload) return { ok: false, error: 'not found' };
            upload.enabled = !!message.enabled;
            await saveState(state);
            return { ok: true };
        }
        case 'pushUploadNow': {
            const state = await getState();
            const res = await pushUploads(state, { force: true, uploadId: message.id });
            return { ok: true, pushed: res.pushed, errors: res.errors };
        }
        case 'pushAllUploads': {
            const state = await getState();
            const res = await pushUploads(state, { force: true });
            return { ok: true, pushed: res.pushed, errors: res.errors };
        }
        case 'setSyncEnabled': {
            const state = await getState();
            state.syncEnabled = !!message.enabled;
            await saveState(state);
            return { ok: true };
        }
        case 'setEnabled': {
            const state = await getState();
            state.enabled = !!message.enabled;
            await saveState(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'toggleHost': {
            const state = await getState();
            // Normalize exactly as the content script's hostname() does.
            const host = String(message.host || '')
                .trim().toLowerCase().replace(/^www\./, '').replace(/\/+$/, '');
            if (!host) return { ok: false, error: 'empty host' };
            if (state.disabledHosts.includes(host)) {
                state.disabledHosts = state.disabledHosts.filter(h => h !== host);
            } else {
                state.disabledHosts.push(host);
            }
            await saveState(state);
            let tabId = message.tabId;
            if (tabId) {
                try { await browser.tabs.sendMessage(tabId, { type: 'refresh' }); } catch (e) {}
            }
            return { ok: true, disabledHosts: state.disabledHosts };
        }
        case 'lookup': {
            const state = await getState();
            const id = normalizeKey(message.identifier);
            const entry = state.items[id];
            const resolved = entry ? resolveLabels(entry.labels, state.labels) : [];
            return { ok: true, labels: resolved };
        }
        case 'getAllLabels': {
            const state = await getState();
            return { ok: true, labels: state.labels };
        }
        case 'setLabelsForItem': {
            const state = await getState();
            const id = normalizeKey(message.identifier);
            if (!id || id === 'undefined') return { ok: false, error: 'empty identifier' };
            const labels = (message.labels || [])
                .filter(labelId => validLabelId(labelId))
                .map(labelId => ({ labelId, source: 'local' }));
            if (labels.length === 0) {
                delete state.items[id];
            } else {
                state.items[id] = { labels };
            }
            await saveState(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'importFull': {
            const state = await getState();
            state.labels = Array.isArray(message.labels) ? message.labels : state.labels;
            state.items = (message.items && typeof message.items === 'object' && !Array.isArray(message.items)) ? message.items : {};
            // Sanitize so imported data obeys the same invariants as local data.
            sanitizeState(state);
            await saveState(state);
            buildContextMenus(state);
            notifyContent('refresh');
            return { ok: true };
        }
        case 'importItems': {
            // Merge a flat item map or {labels, items} wrapper into local items.
            const state = await getState();
            let gistData, labelMeta;
            try {
                const parsed = parseGistDatabase(message.items);
                gistData = parsed.items;
                labelMeta = parsed.labelMeta;
            } catch (e) {
                return { ok: false, error: String(e && e.message || e) };
            }
            const labelIds = collectGistLabels(gistData);
            // Case-insensitive so "SCAM" maps onto a local "scam".
            for (const lid of labelIds) {
                const meta = labelMeta[lid] || {};
                const existing = state.labels.find(l => l.id.toLowerCase() === lid.toLowerCase());
                if (!existing) {
                    state.labels.push({ id: lid, name: meta.name || lid, color: meta.color || '#8b8b8b', visible: true, source: 'gist' });
                } else if (meta.color && existing.color !== meta.color) {
                    existing.color = meta.color;
                }
            }
            const added = mergeIntoLocal(state.items, gistData);
            await saveState(state);
            buildContextMenus(state);
            notifyContent('refresh');
            return { ok: true, added };
        }
        default:
            return { ok: false, error: 'unknown message type' };
    }
}

function resolveLabels(entryLabels, allLabels) {
    return entryLabels
        .map(l => allLabels.find(x => x.id === l.labelId))
        .filter(Boolean);
}

// Tell content scripts in open tabs to re-scan.
function notifyContent(message) {
    browser.tabs.query({}).then((tabs) => {
        for (const tab of tabs) {
            try {
                browser.tabs.sendMessage(tab.id, { type: 'refresh' }).catch(() => {});
            } catch (e) {}
        }
    }).catch(() => {});
}

safeAdd('runtime', 'onMessage', (message, sender, sendResponse) => {
    // Serialize so concurrent mutations can't race.
    serialize(() => handleMessage(message, sender))
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // keep the channel open for the async response
});

// ---- Alarm-based periodic refresh --------------------------------------

const UPDATE_INTERVAL_MINUTES = 6 * 60; // every 6 hours

try {
    browser.alarms.create('refresh-gists', { periodInMinutes: UPDATE_INTERVAL_MINUTES });
} catch (e) {}

safeAdd('alarms', 'onAlarm', (alarm) => {
    return serialize(async () => {
        try {
            if (alarm.name === 'refresh-gists') {
                const state = await getState();
                if (state.syncEnabled) {
                    await refreshAllSubscriptions({ includeMissingLabels: true });
                }
                // Retry uploads that failed or changed while the worker slept.
                await pushChangedUploads();
            }
        } catch (e) {}
    });
});

// Refresh subscriptions and build the context menu on install.
safeAdd('runtime', 'onInstalled', () => {
    return serialize(async () => {
        debugLog('onInstalled fired');
        try {
            const state = await getState();
            if (state.syncEnabled) {
                await refreshAllSubscriptions({ includeMissingLabels: true });
            }
        } catch (e) {}
        try {
            const state = await getState();
            buildContextMenus(state);
        } catch (e) {
            debugLog('onInstalled build failed: ' + (e && e.message || e));
        }
    });
});

// Rebuild the context menu on worker start: MV3 wakes are frequent and
// onInstalled only fires on install/update, so this keeps the menu present.
debugLog('worker started');
getState().then(state => debugLog('got state; triggering build').then(() => buildContextMenus(state))).catch(e => debugLog('startup build failed: ' + (e && e.message || e)));
