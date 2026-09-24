// owlEyes options page logic

let state = null;

async function getState() {
    const res = await browser.runtime.sendMessage({ type: 'getState' });
    state = res.state;
    return state;
}

async function send(type, extra) {
    return browser.runtime.sendMessage({ type, ...extra });
}

// ---- Tab switching ------------------------------------------------------

document.querySelectorAll('nav button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// ---- Delay helper for debounced refresh ---------------------------------

function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---- Labels tab ---------------------------------------------------------

async function renderLabels() {
    await getState();
    const list = document.getElementById('label-list');
    list.innerHTML = '';

    if (state.labels.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No labels yet. Create your first one below — it starts blank so you can design it your way.';
        list.appendChild(empty);
    }

    for (const label of state.labels) {
        const card = document.createElement('div');
        card.className = 'label-card';

        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = label.color;
        swatch.title = 'Click to pick a color';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = label.color;
        colorInput.title = 'Choose label color';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = label.name;
        nameInput.title = 'Label name';

        const idSpan = document.createElement('span');
        idSpan.className = 'id';
        idSpan.textContent = label.id;

        const vis = document.createElement('label');
        vis.className = 'visible-toggle';
        vis.title = 'Show or hide this group\u2019s highlights on pages';
        const visCb = document.createElement('input');
        visCb.type = 'checkbox';
        visCb.checked = label.visible !== false;
        visCb.addEventListener('change', async () => {
            const res = await send('updateLabel', { labelId: label.id, visible: visCb.checked });
            if (res && res.ok) {
                flashAction((visCb.checked ? 'Showing ' : 'Hiding ') + '"' + label.name + '" on pages');
            } else {
                visCb.checked = !visCb.checked;
            }
        });
        const visText = document.createElement('span');
        visText.textContent = 'Visible';
        vis.append(visCb, visText);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'primary';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
            const res = await send('updateLabel', {
                labelId: label.id,
                name: nameInput.value.trim() || label.name,
                color: colorInput.value
            });
            if (res && res.ok) {
                swatch.style.backgroundColor = colorInput.value;
                flashSave(saveBtn);
                await Promise.all([renderUploads(), renderUploadControls()]);
            } else {
                alert('Failed to save: ' + ((res && res.error) || 'unknown error'));
            }
        });

        const del = document.createElement('button');
        del.className = 'danger';
        del.textContent = 'Delete';
        del.addEventListener('click', async () => {
            if (!confirm(`Delete label "${label.name}" and remove it from all items?`)) return;
            await send('removeLabel', { labelId: label.id });
            await Promise.all([renderLabels(), renderItems(), renderDatabasesRow(), renderDbControls(), renderExportLabels(), renderUploadControls(), renderUploads()]);
        });

        card.append(swatch, colorInput, nameInput, idSpan, vis, saveBtn, del);
        list.appendChild(card);
    }
}

// Brief visual confirmation that a save succeeded.
function flashSave(btn) {
    const original = btn.textContent;
    btn.textContent = 'Saved';
    btn.disabled = true;
    setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
    }, 900);
}

document.getElementById('add-label').addEventListener('click', async () => {
    const id = document.getElementById('new-label-id').value.trim();
    if (!id) return alert('Enter an id for the label');
    await send('addLabel', {
        labelId: id,
        name: document.getElementById('new-label-name').value.trim() || id,
        color: document.getElementById('new-label-color').value
    });
    document.getElementById('new-label-id').value = '';
    document.getElementById('new-label-name').value = '';
    await Promise.all([renderLabels(), renderExportLabels(), renderUploadControls()]);
});

// ---- Databases tab (visible list of saved items) ------------------------

let dbSearch = '';
let dbFilterLabel = '';   // label id to filter the list by; '' = show all

// Update the count badge, add-form picker, and filter dropdown.
async function renderDbControls() {
    await getState();
    const count = Object.keys(state.items).length;
    const badge = document.getElementById('db-count');
    badge.textContent = count === 0 ? 'Empty' : count + (count === 1 ? ' item' : ' items');

    // Add-form picker: starts with a placeholder option.
    const addSelect = document.getElementById('db-new-label');
    addSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a label…';
    addSelect.appendChild(placeholder);
    for (const label of state.labels) {
        const opt = document.createElement('option');
        opt.value = label.id;
        opt.textContent = label.name;
        addSelect.appendChild(opt);
    }

    // Label filter dropdown.
    const filter = document.getElementById('db-filter-label');
    const prevFilter = filter.value || dbFilterLabel;
    filter.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All labels';
    filter.appendChild(allOpt);
    for (const label of state.labels) {
        const opt = document.createElement('option');
        opt.value = label.id;
        opt.textContent = label.name;
        filter.appendChild(opt);
    }
    filter.value = prevFilter && state.labels.some(l => l.id === prevFilter) ? prevFilter : '';
    dbFilterLabel = filter.value;
    updateAddFormState();
    renderItems();
}

function updateAddFormState() {
    const canAdd = document.getElementById('db-new-id').value.trim() &&
        document.getElementById('db-new-label').value;
    document.getElementById('db-add').disabled = !canAdd;
}

async function renderItems() {
    await getState();
    const list = document.getElementById('item-list');
    list.innerHTML = '';
    const needle = dbSearch.toLowerCase();

    let entries = Object.entries(state.items);
    if (dbFilterLabel) {
        entries = entries.filter(([, entry]) => {
            const cur = entry && entry.labels && entry.labels[0] && entry.labels[0].labelId;
            return cur === dbFilterLabel;
        });
    }
    entries = entries
        .filter(([id]) => !needle || id.toLowerCase().includes(needle))
        .sort((a, b) => a[0].localeCompare(b[0]));

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = needle
            ? 'No items match your search.'
            : dbFilterLabel
                ? 'Nothing tagged with this label yet.'
                : 'Nothing saved yet. Add an item above, or tag a username from the popup / right-click menu.';
        list.appendChild(empty);
        return;
    }

    // Header row
    const head = document.createElement('div');
    head.className = 'item-row item-head';
    head.innerHTML = '<span class="item-id">Identifier</span><span>Label</span><span></span>';
    list.appendChild(head);

    for (const [id, entry] of entries) {
        const row = document.createElement('div');
        row.className = 'item-row';

        const idCell = document.createElement('div');
        idCell.className = 'item-id';
        const idText = document.createElement('span');
        idText.textContent = id;
        idCell.appendChild(idText);

        // Color chip + label dropdown.
        const labelCell = document.createElement('div');
        labelCell.className = 'label-cell';
        const chip = document.createElement('span');
        chip.className = 'chip';
        const current = entry.labels[0] && entry.labels[0].labelId;
        const currentLabel = state.labels.find(l => l.id === current);
        chip.style.backgroundColor = currentLabel ? currentLabel.color : '#888';
        const select = document.createElement('select');
        const noneOpt = document.createElement('option');
        noneOpt.value = '__none__';
        noneOpt.textContent = '(none)';
        select.appendChild(noneOpt);
        for (const label of state.labels) {
            const opt = document.createElement('option');
            opt.value = label.id;
            opt.textContent = label.name;
            select.appendChild(opt);
        }
        select.value = current || '__none__';
        select.addEventListener('change', async () => {
            if (select.value === '__none__') {
                await send('removeItem', { identifier: id });
                flashAction('Removed "' + id + '"');
            } else {
                await send('setItem', { identifier: id, labels: [select.value] });
                const lbl = state.labels.find(l => l.id === select.value);
                chip.style.backgroundColor = lbl ? lbl.color : '#888';
                flashAction('Saved "' + id + '" as ' + (lbl ? lbl.name : select.value));
            }
            await Promise.all([renderItems(), renderDbControls()]);
        });
        labelCell.append(chip, select);

        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const ignoreBtn = document.createElement('button');
        ignoreBtn.textContent = 'Ignore';
        ignoreBtn.title = 'Remove locally and never re-add from gist sync';
        ignoreBtn.addEventListener('click', async () => {
            if (!confirm(`Ignore "${id}"? It will be removed from the database and gist syncs won't re-add it.`)) return;
            await send('ignoreItem', { identifier: id });
            flashAction('Ignored "' + id + '"');
            await Promise.all([renderItems(), renderIgnored(), renderDbControls()]);
        });
        actions.appendChild(ignoreBtn);
        const delBtn = document.createElement('button');
        delBtn.className = 'danger';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', async () => {
            await send('removeItem', { identifier: id });
            flashAction('Removed "' + id + '"');
            await Promise.all([renderItems(), renderDbControls()]);
        });
        actions.appendChild(delBtn);

        row.append(idCell, labelCell, actions);
        list.appendChild(row);
    }
}

// A small transient toast confirming an action saved.
let actionToastTimer = null;
function flashAction(text) {
    let toast = document.getElementById('action-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'action-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(actionToastTimer);
    actionToastTimer = setTimeout(() => toast.classList.remove('show'), 1500);
}

function renderDatabasesRow() {
    return renderItems();
}

// The locally-stored ignore list: identifiers removed by the user that gist
// syncs must not re-add. Rendered to the right of the database with
// Unignore actions; the column stays visible even when the list is empty.
async function renderIgnored() {
    await getState();
    const list = document.getElementById('ignored-list');
    const countEl = document.getElementById('ignored-count');
    const ignored = state.ignoredItems || [];
    countEl.textContent = ignored.length;
    list.innerHTML = '';

    if (ignored.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No ignored items yet. Use Ignore on an item so a gist sync won\u2019t re-add it.';
        list.appendChild(empty);
        return;
    }

    for (const id of ignored) {
        const row = document.createElement('div');
        row.className = 'ignored-row item-row';
        const idCell = document.createElement('div');
        idCell.className = 'item-id';
        idCell.textContent = id;
        const note = document.createElement('span');
        note.className = 'muted';
        note.textContent = 'not re-added by gist sync';
        const un = document.createElement('button');
        un.textContent = 'Unignore';
        un.addEventListener('click', async () => {
            await send('unignoreItem', { identifier: id });
            flashAction('Unignored "' + id + '"');
            await Promise.all([renderIgnored(), renderDbControls()]);
        });
        row.append(idCell, note, un);
        list.appendChild(row);
    }
}

document.getElementById('db-new-id').addEventListener('input', updateAddFormState);
document.getElementById('db-new-label').addEventListener('change', updateAddFormState);

document.getElementById('db-filter-label').addEventListener('change', (e) => {
    dbFilterLabel = e.target.value;
    renderItems();
});

document.getElementById('db-add').addEventListener('click', async () => {
    await getState();
    const id = document.getElementById('db-new-id').value.trim().toLowerCase();
    const labelId = document.getElementById('db-new-label').value;
    if (!id) return alert('Enter an identifier to tag');
    if (!labelId) return alert('Choose a label to apply');
    if (!state.labels.length) {
        return alert('You need at least one label before tagging items. Create one on the Labels tab first.');
    }
    const res = await send('setItem', { identifier: id, labels: [labelId] });
    if (res && res.ok) {
        document.getElementById('db-new-id').value = '';
        flashAction('Saved "' + id + '" to your database');
        await Promise.all([renderItems(), renderDbControls()]);
    } else {
        alert('Failed to save: ' + ((res && res.error) || 'unknown error'));
    }
});

document.getElementById('db-search').addEventListener('input', debounce((e) => {
    dbSearch = e.target.value.trim();
    renderItems();
}, 200));

document.getElementById('db-clear').addEventListener('click', async () => {
    if (!confirm('Remove ALL items from the local database?')) return;
    await send('clearItems');
    flashAction('Database cleared');
    await Promise.all([renderItems(), renderDbControls()]);
});

// ---- Gists tab ----------------------------------------------------------

function fmtSync(sub) {
    if (sub.enabled === false) return 'paused';
    if (sub.lastError) return 'last sync failed: ' + sub.lastError;
    if (sub.lastSync) {
        const d = new Date(sub.lastSync);
        let text = 'synced ' + d.toLocaleString() + ' (added ' + (sub.lastCount || 0) + ' new)';
        return text;
    }
    return 'not synced yet';
}

async function renderGists() {
    await getState();
    document.getElementById('sync-enabled').checked = state.syncEnabled;
    const list = document.getElementById('gist-list');
    list.innerHTML = '';
    if (state.subscriptions.length === 0) {
        list.innerHTML = '<p class="muted">No gist subscriptions yet.</p>';
        return;
    }
    for (const sub of state.subscriptions) {
        const row = document.createElement('div');
        row.className = 'gist-row';

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = sub.enabled !== false;
        toggle.title = 'Toggle this gist on/off';
        toggle.addEventListener('change', async () => {
            const res = await send('setSubscriptionEnabled', { id: sub.id, enabled: toggle.checked });
            if (!res || !res.ok) {
                toggle.checked = !toggle.checked;
                return alert('Failed to update: ' + ((res && res.error) || 'unknown error'));
            }
            if (toggle.checked && res.added) flashAction('Synced, added ' + res.added + ' item(s)');
            await renderGists();
            await Promise.all([renderLabels(), renderItems()]);
        });

        const main = document.createElement('div');
        main.className = 'gist-main';
        const url = document.createElement('span');
        url.className = 'url';
        const urlText = sub.enabled === false ? '(disabled) ' + sub.url : sub.url;
        url.textContent = urlText;
        const meta = document.createElement('span');
        meta.className = sub.lastError && sub.enabled !== false ? 'err' : 'meta';
        meta.textContent = fmtSync(sub);
        main.append(url, meta);

        const rm = document.createElement('button');
        rm.className = 'danger';
        rm.textContent = 'Remove';
        rm.addEventListener('click', async () => {
            await send('removeSubscription', { id: sub.id });
            await renderGists();
            await Promise.all([renderLabels(), renderItems()]);
        });
        row.append(toggle, main, rm);
        list.appendChild(row);
    }
}

document.getElementById('sync-enabled').addEventListener('change', async (e) => {
    await send('setSyncEnabled', { enabled: e.target.checked });
});

document.getElementById('add-gist').addEventListener('click', async () => {
    const url = document.getElementById('gist-url').value.trim();
    if (!url) return alert('Paste a gist URL');
    const res = await send('addSubscription', { url });
    if (!res.ok) {
        alert('Failed to subscribe: ' + (res.lastError || 'unknown error'));
    } else {
        document.getElementById('gist-url').value = '';
    }
    await renderGists();
    await Promise.all([renderLabels(), renderItems()]);
});

document.getElementById('refresh-gists').addEventListener('click', async () => {
    await send('refreshSubscriptions');
    await renderGists();
    await Promise.all([renderLabels(), renderItems()]);
});

// ---- Gist Uploads tab ----------------------------------------------------

let uploadLabelsSelected = new Set();

function updateUploadAddState() {
    const name = document.getElementById('upload-name').value.trim();
    const url = document.getElementById('upload-url').value.trim();
    const labels = [...uploadLabelsSelected].filter(id =>
        state && state.labels.some(l => l.id === id));
    document.getElementById('add-upload').disabled = !(name && url && labels.length > 0);
}

async function renderUploadControls() {
    await getState();
    document.getElementById('gh-token').value = state.token || '';
    const list = document.getElementById('upload-label-list');
    list.innerHTML = '';
    const addBtn = document.getElementById('add-upload');
    if (state.labels.length === 0) {
        list.innerHTML = '<p class="muted">No labels yet. Create one on the Labels tab first.</p>';
        addBtn.disabled = true;
        return;
    }
    for (const label of state.labels) {
        const wrap = document.createElement('label');

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = label.id;
        cb.checked = uploadLabelsSelected.has(label.id);
        cb.addEventListener('change', () => {
            if (cb.checked) uploadLabelsSelected.add(label.id);
            else uploadLabelsSelected.delete(label.id);
            updateUploadAddState();
        });

        const chip = document.createElement('span');
        chip.className = 'ex-chip';
        chip.style.backgroundColor = label.color;

        const name = document.createElement('span');
        name.textContent = label.name;
        name.style.flex = '1';

        wrap.append(cb, chip, name);
        list.appendChild(wrap);
    }
    updateUploadAddState();
}

function fmtPush(u) {
    if (u.enabled === false) return 'paused';
    if (u.lastError) return 'last push failed: ' + u.lastError;
    if (u.lastPush) return 'pushed ' + new Date(u.lastPush).toLocaleString();
    return 'configured — pushes on the next change to these labels';
}

async function renderUploads() {
    await getState();
    const list = document.getElementById('upload-list');
    list.innerHTML = '';
    if (state.uploads.length === 0) {
        list.innerHTML = '<p class="muted">No uploads yet.</p>';
        return;
    }
    for (const upload of state.uploads) {
        const row = document.createElement('div');
        row.className = 'upload-row';

        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = upload.enabled !== false;
        toggle.title = 'Toggle this upload on/off';
        toggle.addEventListener('change', async () => {
            const res = await send('setUploadEnabled', { id: upload.id, enabled: toggle.checked });
            if (!res || !res.ok) { toggle.checked = !toggle.checked; return; }
            await renderUploads();
        });

        const main = document.createElement('div');
        main.className = 'upload-main';
        const title = document.createElement('span');
        title.className = 'url';
        title.textContent = upload.name || upload.url;
        const dest = document.createElement('span');
        dest.className = 'meta';
        dest.textContent = upload.url + ' › ' + upload.filename;
        const chips = document.createElement('span');
        chips.className = 'chips';
        for (const lid of upload.labels) {
            const lbl = state.labels.find(l => l.id === lid);
            const c = document.createElement('span');
            c.className = 'chip';
            c.style.backgroundColor = lbl ? lbl.color : '#888';
            c.textContent = lbl ? lbl.name : lid;
            chips.appendChild(c);
        }
        const meta = document.createElement('span');
        meta.className = upload.lastError && upload.enabled !== false ? 'err' : 'meta';
        meta.textContent = fmtPush(upload);
        main.append(title, dest, chips, meta);

        const pushBtn = document.createElement('button');
        pushBtn.textContent = 'Push now';
        pushBtn.addEventListener('click', async () => {
            const res = await send('pushUploadNow', { id: upload.id });
            if (res && res.ok && res.pushed > 0) flashAction('Pushed "' + (upload.name || upload.url) + '"');
            await renderUploads();
        });

        const rm = document.createElement('button');
        rm.className = 'danger';
        rm.textContent = 'Remove';
        rm.addEventListener('click', async () => {
            if (!confirm(`Remove upload "${upload.name || upload.url}"? (the gist itself is not touched)`)) return;
            await send('removeUpload', { id: upload.id });
            await renderUploads();
        });

        row.append(toggle, main, pushBtn, rm);
        list.appendChild(row);
    }
}

document.getElementById('save-token').addEventListener('click', async () => {
    const token = document.getElementById('gh-token').value.trim();
    await send('setToken', { token });
    flashAction('Token saved');
});

['upload-name', 'upload-url', 'upload-filename'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateUploadAddState);
});

document.getElementById('add-upload').addEventListener('click', async () => {
    await getState();
    const labels = [...uploadLabelsSelected].filter(id => state.labels.some(l => l.id === id));
    const res = await send('addUpload', {
        name: document.getElementById('upload-name').value.trim(),
        url: document.getElementById('upload-url').value.trim(),
        filename: document.getElementById('upload-filename').value.trim(),
        labels
    });
    if (!res || !res.ok) return alert('Failed to add upload: ' + ((res && res.error) || 'unknown error'));
    document.getElementById('upload-name').value = '';
    document.getElementById('upload-url').value = '';
    uploadLabelsSelected.clear();
    document.querySelectorAll('#upload-label-list input[type=checkbox]').forEach(cb => cb.checked = false);
    flashAction('Upload configured — will push on the next change to these labels');
    await Promise.all([renderUploads(), renderUploadControls()]);
});

document.getElementById('push-all').addEventListener('click', async () => {
    const res = await send('pushAllUploads');
    if (res && res.ok) {
        flashAction('Pushed ' + (res.pushed || 0) + ' upload(s)' + (res.errors ? ' — ' + res.errors + ' failed' : ''));
    }
    await renderUploads();
});

// ---- Import / Export ----------------------------------------------------

function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Build a checkbox for each label so the user can choose which to export.
async function renderExportLabels() {
    await getState();
    const list = document.getElementById('export-label-list');
    list.innerHTML = '';
    if (state.labels.length === 0) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'No labels yet.';
        list.appendChild(p);
        return;
    }
    for (const label of state.labels) {
        const wrap = document.createElement('label');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = label.id;
        checkbox.checked = true;

        const chip = document.createElement('span');
        chip.className = 'ex-chip';
        chip.style.backgroundColor = label.color;

        const name = document.createElement('span');
        name.textContent = label.name;
        name.style.flex = '1';

        const count = document.createElement('span');
        count.className = 'muted';
        count.textContent = '0 items';
        count.dataset.labelId = label.id;

        const itemCount = Object.values(state.items).filter(
            it => it && it.labels && it.labels[0] && it.labels[0].labelId === label.id
        ).length;
        count.textContent = itemCount + (itemCount === 1 ? ' item' : ' items');

        wrap.append(checkbox, chip, name, count);
        list.appendChild(wrap);
    }
}

function selectedExportLabelIds() {
    const ids = [];
    document.querySelectorAll('#export-label-list input[type=checkbox]').forEach(cb => {
        if (cb.checked) ids.push(cb.value);
    });
    return ids;
}

// Flat item map (only items tagged with the given labels), keys = identifier.
function buildFlatItems(labelIds) {
    const labelSet = new Set(labelIds);
    const items = {};
    for (const [id, entry] of Object.entries(state.items)) {
        const cur = entry && entry.labels && entry.labels[0] && entry.labels[0].labelId;
        if (!cur || !labelSet.has(cur)) continue;
        // Mark as gist-source so re-import treats these as gist origin.
        items[id] = {
            labels: entry.labels.map(l => ({ labelId: l.labelId, source: 'gist' }))
        };
    }
    return items;
}

// Gist-compatible export (label name + color + items) — the format gist
// subscriptions consume, so colors travel with a shared export.
function buildGistExport(labelIds) {
    const labelSet = new Set(labelIds);
    const labels = {};
    for (const label of state.labels) {
        if (!labelSet.has(label.id)) continue;
        labels[label.id] = { name: label.name || label.id, color: label.color };
    }
    const items = buildFlatItems(labelIds);
    return { labels, items };
}

// Full export payload (labels + items).
function buildFullPayload(labelIds) {
    const labelSet = new Set(labelIds);
    const labels = state.labels.filter(l => labelSet.has(l.id));
    const items = buildFlatItems(labelIds);
    return { name: 'owlEyes database', labels, items };
}

document.getElementById('export-check-all').addEventListener('click', () => {
    document.querySelectorAll('#export-label-list input[type=checkbox]').forEach(cb => cb.checked = true);
});

document.getElementById('export-check-none').addEventListener('click', () => {
    document.querySelectorAll('#export-label-list input[type=checkbox]').forEach(cb => cb.checked = false);
});

// "Export selected" writes a shareable gist-compatible database (with colors).
document.getElementById('export').addEventListener('click', async () => {
    await getState();
    const ids = selectedExportLabelIds();
    if (ids.length === 0) return alert('Select at least one label to export.');
    const payload = buildGistExport(ids);
    const count = Object.keys(payload.items).length;
    download(`owleyes-${ids.join('-')}.json`, JSON.stringify(payload, null, 2));
    flashAction('Exported ' + count + (count === 1 ? ' item' : ' items') + ' with colors for: ' + ids.join(', '));
});

// "Export everything" writes the full wrapper for backup/restore.
document.getElementById('export-all').addEventListener('click', async () => {
    await getState();
    const payload = buildFullPayload(state.labels.map(l => l.id));
    const count = Object.keys(payload.items).length;
    download('owleyes-database-full.json', JSON.stringify(payload, null, 2));
    flashAction('Exported ' + count + (count === 1 ? ' item' : ' items') + ' (full backup)');
});

document.getElementById('import').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        const text = await file.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { return alert('Invalid JSON'); }

        // Full database wrapper (from "Export everything").
        if (data && data.name === 'owlEyes database' && data.labels && data.items) {
            if (confirm('Replace the entire local database with this file?')) {
                await send('importFull', { labels: data.labels, items: data.items });
                await Promise.all([renderLabels(), renderItems(), renderGists(), renderDbControls(), renderUploads(), renderUploadControls()]);
            }
            return;
        }

        // Otherwise treat it as a gist-compatible flat item map ({"id": "labelId"} or
        // {"id": {labels:[...]}}); a flat map may legitimately contain an
        // "items"/"labels" identifier, so don't gate on that key's absence.
        const res = await send('importItems', { items: data });
        if (res && res.ok) {
            await Promise.all([renderLabels(), renderItems(), renderDatabasesRow(), renderDbControls(), renderUploads(), renderUploadControls()]);
            return alert('Merged ' + res.added + ' items');
        }
        alert('Unrecognized format');
    });
    input.click();
});

// ---- Initial render -----------------------------------------------------

(async function init() {
    await Promise.all([renderLabels(), renderItems(), renderGists(), renderDbControls(), renderExportLabels(), renderUploads(), renderUploadControls(), renderIgnored()]);
})();
