// owlEyes content script — scans pages for identifiers and highlights them
// with the user's label colors.

let enabled = true;
let disabledHosts = [];
let allItems = {};
let allLabels = [];

// Display-name aliases (lowercased) -> label, inferred while matching @handles
// so names render on X/Twitter where handles show as display names.
let displayNameMap = new Map();

function hostname() {
    return location.hostname.replace(/^www\./, '').toLowerCase();
}

function isDisabled() {
    return !enabled || disabledHosts.includes(hostname());
}

async function loadState() {
    try {
        const res = await browser.runtime.sendMessage({ type: 'getState' });
        if (res && res.ok) {
            enabled = res.state.enabled !== false;
            disabledHosts = res.state.disabledHosts || [];
            allItems = res.state.items || {};
            allLabels = res.state.labels || [];
            return true;
        }
    } catch (e) {}
    return false;
}

function labelForId(labelId) {
    return allLabels.find(l => l.id === labelId);
}

// Escape text for use in a regex of exact identifiers.
function matchesForIdentifier(id) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Word/delimiter boundaries; 'i' matches stored-lowercase ids against
    // any page casing, e.g. @Foo.
    return new RegExp(`(?<![\\p{L}\\p{N}_:/@#.-])${esc}(?![\\p{L}\\p{N}_:/@#.-])`, 'giu');
}

// Display forms of a canonical identifier, e.g. "twitter.com/foo" also matches
// the bare "@foo". The bare word alone isn't matched (false-positive risk).
function identifierForms(id) {
    const forms = [id];
    if (id.includes('/')) {
        const bare = id.slice(id.lastIndexOf('/') + 1).replace(/^@/, '');
        if (bare && bare.length >= 2) {
            forms.push('@' + bare);   // "@foo"
        }
    }
    return forms;
}

// Infer a display name from the DOM around an "@handle" node (for X/Twitter).
// Conservative: only short letter/space strings that aren't a handle/URL/prompt.
function captureDisplayName(handleNode, bare) {
    const exclusions = /(\/|https?:|www\.|\.\.|\b(replying to|replied|from|follow|you|joined|verified)\b)/i;
    let el = handleNode.parentElement;
    for (let depth = 0; el && depth < 4; depth++) {
        for (const child of el.childNodes) {
            if (child === handleNode) continue;
            const text = (child.textContent || '').trim();
            if (!text) continue;
            const lower = text.toLowerCase();
            if (lower === bare) continue;
            if (text.includes('@')) continue;
            if (!/^[\p{L}][\p{L}\s.'-]{1,39}$/u.test(text)) continue;
            if (exclusions.test(text)) continue;
            return text;
        }
        el = el.parentElement;
    }
    return null;
}

// Which text nodes are worth scanning.
function shouldScanNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return false;
    if (!(node.parentElement instanceof HTMLElement)) return false;
    const tag = node.parentElement.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'NOSCRIPT') return false;
    // Skip text already inside one of our own highlight spans.
    if (node.parentElement.classList && node.parentElement.classList.contains('owleyes-label')) return false;
    return true;
}

function applyHighlights() {
    if (isDisabled()) return;

    displayNameMap.clear();

    // One walker pass over all text nodes.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return shouldScanNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });

    const nodes = [];
    let node;
    let guard = 0;
    while ((node = walker.nextNode()) && guard++ < 200000) {
        nodes.push(node);
    }

    for (const textNode of nodes) {
        highlightTextNode(textNode);
    }

    // Pass 2: highlight display-name aliases inferred during Pass 1.
    applyDisplayNames();
}

// Wraps matching spans within a text node without breaking up the DOM
// structure for other scripts. Returns true if it modified the node.
// Unwrap existing highlight spans so a re-scan can drop stale highlights.
// Returns the number of spans removed.
function clearHighlights() {
    const spans = document.querySelectorAll('.owleyes-label');
    let count = 0;
    for (const span of spans) {
        const parent = span.parentNode;
        if (!parent) continue;
        parent.insertBefore(document.createTextNode(span.textContent), span);
        parent.removeChild(span);
        count++;
    }
    return count;
}

function highlightTextNode(textNode) {
    const text = textNode.nodeValue;
    if (!text || text.length === 0) return false;

    let changed = false;
    const fragments = [];
    let lastIndex = 0;

    for (const id of Object.keys(allItems)) {
        // Only reasonable-length identifiers to avoid pathological regex.
        if (id.length < 2 || id.length > 64) continue;

        const labelObj = labelForId(allItems[id].labels[0] && allItems[id].labels[0].labelId);
        if (!labelObj || labelObj.visible === false) continue;

        for (const form of identifierForms(id)) {
            if (!text.toLowerCase().includes(form.toLowerCase())) continue;
            const regex = matchesForIdentifier(form);
            let match;
            while ((match = regex.exec(text)) !== null) {
                fragments.push({ start: match.index, end: match.index + match[0].length, label: labelObj });
            }
            // For "@handle" matches, infer the display name too.
            if (form[0] === '@' && labelObj) {
                const disp = captureDisplayName(textNode, form.slice(1));
                if (disp) displayNameMap.set(disp.toLowerCase(), labelObj);
            }
        }
    }

    if (fragments.length === 0) return false;

    fragments.sort((a, b) => a.start - b.start);

    // Merge overlapping/adjacent ranges.
    const merged = [];
    for (const f of fragments) {
        const last = merged[merged.length - 1];
        if (last && f.start <= last.end) {
            last.end = Math.max(last.end, f.end);
        } else {
            merged.push({ start: f.start, end: f.end, label: f.label });
        }
    }

    // Build replacement content as a fragment.
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of merged) {
        if (m.start > cursor) {
            frag.appendChild(document.createTextNode(text.slice(cursor, m.start)));
        }
        const span = document.createElement('span');
        span.className = 'owleyes-label';
        span.dataset.labelId = m.label.id;
        span.style.backgroundColor = m.label.color;
        span.style.color = bestTextColor(m.label.color);
        span.textContent = text.slice(m.start, m.end);
        frag.appendChild(span);
        cursor = m.end;
    }
    if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode.replaceChild(frag, textNode);
    return true;
}

// Wrap a display-name alias in one text node. Looser boundaries than regular
// identifiers: a name adjacent to punctuation still matches; alphanumeric
// adjacency ("johnsmith123") is rejected.
function matchesForDisplayName(name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'gi');
}

function highlightNameInNode(textNode, name, labelObj) {
    const text = textNode.nodeValue;
    if (!text || text.length === 0) return;
    if (!text.toLowerCase().includes(name)) return;

    const fragments = [];
    const regex = matchesForDisplayName(name);
    let match;
    while ((match = regex.exec(text)) !== null) {
        fragments.push({ start: match.index, end: match.index + match[0].length, label: labelObj });
    }
    if (fragments.length === 0) return;

    fragments.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const f of fragments) {
        const last = merged[merged.length - 1];
        if (last && f.start <= last.end) last.end = Math.max(last.end, f.end);
        else merged.push(f);
    }

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of merged) {
        if (m.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.start)));
        const span = document.createElement('span');
        span.className = 'owleyes-label';
        span.dataset.labelId = m.label.id;
        span.style.backgroundColor = m.label.color;
        span.style.color = bestTextColor(m.label.color);
        span.textContent = text.slice(m.start, m.end);
        frag.appendChild(span);
        cursor = m.end;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));

    textNode.parentNode.replaceChild(frag, textNode);
}

// Highlight the display-name aliases collected during Pass 1.
function applyDisplayNames() {
    if (displayNameMap.size === 0) return;
    const names = Array.from(displayNameMap.entries());   // [lower, labelObj]
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return shouldScanNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    const nodes = [];
    let node;
    let guard = 0;
    while ((node = walker.nextNode()) && guard++ < 200000) nodes.push(node);
    for (const textNode of nodes) {
        for (const [name, labelObj] of names) {
            highlightNameInNode(textNode, name, labelObj);
        }
    }
}

// Choose black or white text based on background luminance.
function bestTextColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'inherit';
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#111111' : '#ffffff';
}

// Rebuild the scan safely, avoiding loops from our own injected spans.
let scanning = false;
function scan() {
    if (scanning) return;
    scanning = true;
    try {
        applyHighlights();
    } finally {
        scanning = false;
    }
}

let scanScheduled = null;
function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = setTimeout(() => {
        scanScheduled = null;
        scan();
    }, 400);
}

// ---- Context menu support (manual tagging) -----------------------------

browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'refresh') {
        loadState().then(() => {
            clearHighlights();
            scan();
        });
    }
});

// Re-scan as dynamic content loads.
const observer = new MutationObserver(() => scheduleScan());
let observerStarted = false;

async function init() {
    const loaded = await loadState();
    if (loaded && !isDisabled()) {
        scan();
    }
    if (loaded && !observerStarted) {
        observer.observe(document.body, { childList: true, subtree: true });
        observerStarted = true;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
