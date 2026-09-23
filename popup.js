// owlEyes popup logic

let state = null;
let selectedLabel = null;

async function refresh() {
    const res = await browser.runtime.sendMessage({ type: 'getState' });
    state = res.state;
    document.getElementById('enabled-toggle').checked = state.enabled;

    const sel = document.getElementById('label-select');
    sel.innerHTML = '';
    if (state.labels.length === 0) {
        const hint = document.createElement('p');
        hint.className = 'muted';
        hint.textContent = 'No labels yet. Create one in Settings to start tagging.';
        sel.appendChild(hint);
    }
    for (const label of state.labels) {
        const btn = document.createElement('button');
        btn.textContent = label.name;
        btn.style.backgroundColor = label.color;
        btn.style.borderColor = label.color;
        btn.style.color = '#fff';
        btn.dataset.id = label.id;
        btn.addEventListener('click', () => {
            selectedLabel = label.id;
            [...sel.children].forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('apply-btn').disabled = false;
        });
        sel.appendChild(btn);
    }
}

async function init() {
    await refresh();
    document.getElementById('enabled-toggle').addEventListener('change', async (e) => {
        await browser.runtime.sendMessage({ type: 'setEnabled', enabled: e.target.checked });
    });

    // Prefill identifier with current selection or hostname.
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab.url) {
            let id = tab.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
            document.getElementById('identifier').value = id;
        }
    } catch (e) {}

    document.getElementById('apply-btn').addEventListener('click', async () => {
        const identifier = document.getElementById('identifier').value.trim();
        if (!identifier || !selectedLabel) return;
        await browser.runtime.sendMessage({
            type: 'setItem',
            identifier,
            labels: [selectedLabel]
        });
        window.close();
    });

    document.getElementById('options-btn').addEventListener('click', () => {
        browser.runtime.openOptionsPage();
        window.close();
    });

    document.getElementById('identifier').addEventListener('input', () => {
        document.getElementById('apply-btn').disabled = !(selectedLabel && document.getElementById('identifier').value.trim());
    });
}

init();
