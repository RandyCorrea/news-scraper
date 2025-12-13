const REPO_OWNER = 'RandyCorrea';
const REPO_NAME = 'news-scraper';
const NEWS_SOURCE = 'data/news.json';
const PORTALS_SOURCE = 'data/portals.json';

// DOM Elements
const GRID = document.getElementById('news-grid');
const PORTALS_LIST = document.getElementById('portals-list');
const TOAST = document.getElementById('toast');
const TOAST_MSG = document.getElementById('toast-message');

// State
let newsData = [];
let portalsData = [];

// Init
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Global Error Handler for user visibility
        window.onerror = function (msg, url, line) {
            GRID.innerHTML = `<div class="error-msg">JS Error: ${msg} (Line ${line})</div>`;
            return false;
        };

        // Tab Switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // Load Data
        await Promise.all([loadNews(), loadPortals()]);

        // Events
        document.getElementById('test-portal-btn').addEventListener('click', testPortalExtraction);
        document.getElementById('save-portal-btn').addEventListener('click', saveNewPortal);
        document.getElementById('trigger-btn').addEventListener('click', triggerScraper);
        document.getElementById('check-links-btn').addEventListener('click', checkLinks);
        document.getElementById('verify-btn').addEventListener('click', verifyToken);

        // Initial Icons
        lucide.createIcons();
    } catch (e) {
        console.error("Init Error", e);
        GRID.innerHTML = `<div style="padding:20px; color:red;">
            <h3>Initialization Error</h3>
            <pre>${e.message}\n${e.stack}</pre>
        </div>`;
    }
});

async function loadNews() {
    try {
        const response = await fetch(NEWS_SOURCE + '?t=' + Date.now()); // bust cache
        if (!response.ok) throw new Error('Failed to load news');
        newsData = await response.json();
        renderNews(newsData);
    } catch (error) {
        console.error(error);
        GRID.innerHTML = `<div style="grid-column:1/-1;text-align:center">No news data found.</div>`;
    }
}

async function loadPortals() {
    try {
        const response = await fetch(PORTALS_SOURCE + '?t=' + Date.now());
        if (!response.ok) throw new Error('Failed to load portals');
        portalsData = await response.json();
        renderPortals(portalsData);
    } catch (error) {
        console.error("Portals load error:", error);
    }
}

function renderNews(articles) {
    if (!articles || articles.length === 0) {
        GRID.innerHTML = '<p class="no-data">No articles found.</p>';
        return;
    }

    // Sort by predicted score desc
    articles.sort((a, b) => (b.predicted_score || 0) - (a.predicted_score || 0));

    GRID.innerHTML = articles.map(article => {
        const rating = article.user_score || 0;
        const pred = article.predicted_score ? article.predicted_score.toFixed(1) : '?';

        return `
        <article class="card" data-url="${article.url}" data-id="${article.id}">
            <div class="card-image-container">
                <span class="prediction-badge">AI Score: ${pred}</span>
                <img src="${article.image || 'https://placehold.co/600x400'}" alt="Img" class="card-image" onerror="this.src='https://placehold.co/600x400?text=Error'">
            </div>
            <div class="card-content">
                <span class="source-badge">${article.source}</span>
                <a href="${article.url}" target="_blank" class="card-title">${article.title}</a>
                
                <div class="rating-container">
                    <span class="rating-label">Rate this:</span>
                    <div class="stars" data-id="${article.id}">
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `
                            <span class="star ${n <= rating ? 'active' : ''}" data-val="${n}" onclick="rateArticle(${article.id}, ${n})">★</span>
                        `).join('')}
                    </div>
                </div>

                <div class="card-meta">
                    <span class="date">${new Date(article.scraped_at).toLocaleDateString()}</span>
                    <div class="status-indicator">
                        <div class="status-dot" id="status-${article.id}"></div>
                    </div>
                </div>
            </div>
        </article>
    `}).join('');

    lucide.createIcons();
}

function renderPortals(portals) {
    PORTALS_LIST.innerHTML = portals.map(p => `
        <div class="portal-item">
            <div class="portal-info">
                <strong>${p.url}</strong>
                <span class="portal-url">${p.section} | Enabled: ${p.enabled}</span>
            </div>
            <button class="btn danger" onclick="deletePortal(${p.id})">Delete</button>
        </div>
    `).join('');
    lucide.createIcons();
}

// Actions

async function verifyToken() {
    const token = document.getElementById('gh-token').value.trim();
    const btn = document.getElementById('verify-btn');

    if (!token) {
        showToast('Enter token first', 'error');
        return;
    }

    btn.innerHTML = '...';
    try {
        const res = await fetch('https://api.github.com/user', {
            headers: { 'Authorization': `token ${token}` }
        });

        if (res.ok) {
            const user = await res.json();
            showToast(`Connected as ${user.login}`, 'success');
            btn.innerHTML = '<i data-lucide="check"></i>';
            btn.classList.add('success');
            lucide.createIcons();
        } else {
            throw new Error('Invalid Token');
        }
    } catch (e) {
        showToast('Token Invalid!', 'error');
        btn.innerHTML = '<i data-lucide="x"></i>';
        btn.classList.remove('success');
        lucide.createIcons();
    }
}

async function rateArticle(id, score) {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        showToast('Token required to save rating!', 'error');
        return;
    }

    // Optimistic Update
    const article = newsData.find(a => a.id === id);
    if (article) article.user_score = score;
    renderNews(newsData);

    showToast(`Saving rating ${score}...`, 'info');
    await updateGitHubFile(NEWS_SOURCE, newsData, `User rated article ${id} as ${score}`);
}

async function saveNewPortal() {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        showToast('GitHub Token is required!', 'error');
        return;
    }

    const url = document.getElementById('portal-url').value;
    const section = document.getElementById('portal-section').value;
    const btn = document.getElementById('save-portal-btn');

    if (!url) {
        showToast('URL is required', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerText = 'Saving...';

    const newPortal = {
        id: Date.now(),
        url,
        section,
        enabled: true,
        selectors: { item: 'h2', link: 'a' } // Default
    };

    // Add locally immediately
    portalsData.push(newPortal);
    renderPortals(portalsData);

    try {
        await updateGitHubFile(PORTALS_SOURCE, portalsData, `Add portal ${url}`);
        // Reset form on success
        document.getElementById('portal-url').value = '';
        document.getElementById('test-result').classList.add('hidden');
    } catch (e) {
        showToast('Failed to save to GitHub', 'error');
        // Optional: revert logic here
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Portal';
    }
}

async function deletePortal(id) {
    if (!confirm('Are you sure?')) return;
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        showToast('Token required!', 'error');
        return;
    }

    portalsData = portalsData.filter(p => p.id !== id);
    renderPortals(portalsData);
    await updateGitHubFile(PORTALS_SOURCE, portalsData, `Delete portal ${id}`);
}

async function testPortalExtraction() {
    const url = document.getElementById('portal-url').value;
    const resultBox = document.getElementById('test-result');
    const saveBtn = document.getElementById('save-portal-btn');

    if (!url) {
        showToast('Enter URL first', 'error');
        return;
    }

    resultBox.classList.remove('hidden');
    resultBox.className = 'test-result';
    resultBox.innerText = 'Testing reachability...';

    try {
        // Allow saving regardless of test result result, but warn.
        saveBtn.disabled = false;

        const res = await fetch(url, { mode: 'no-cors' });
        // With no-cors, we get status 0. If it throws, it's a network error.
        resultBox.className = 'test-result success';
        resultBox.innerText = `✅ Network Reachable. Ready to save.`;
    } catch (e) {
        resultBox.className = 'test-result error';
        resultBox.innerText = `⚠️ Network Error: ${e.message}. You can still try to save.`;
        saveBtn.disabled = false;
    }
}

// GitHub Utilities

async function updateGitHubFile(path, contentObj, msg) {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) throw new Error('Token is empty');

    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

    try {
        // 1. Get current SHA
        const getRes = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Cache-Control': 'no-cache'
            }
        });

        if (!getRes.ok) {
            if (getRes.status === 401) throw new Error('Bad Credentials (401). Check Token.');
            if (getRes.status === 403) throw new Error('Permission Denied (403). Token needs "repo" scope.');
            if (getRes.status === 404) throw new Error('File not found (404). Check Repo/Path.');
            throw new Error(`Get File Error: ${getRes.status} ${getRes.statusText}`);
        }

        const getData = await getRes.json();

        // 2. Update
        const contentStr = JSON.stringify(contentObj, null, 2);
        const encoded = btoa(unescape(encodeURIComponent(contentStr)));

        const putRes = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: msg,
                content: encoded,
                sha: getData.sha
            })
        });

        if (!putRes.ok) {
            if (putRes.status === 401) throw new Error('Unauthorized (401).');
            if (putRes.status === 403) throw new Error('Write Denied (403). Check Permissions.');
            if (putRes.status === 409) throw new Error('Conflict (409). Try again.');
            throw new Error(`Save Error: ${putRes.status} ${putRes.statusText}`);
        }

        showToast('Saved successfully!', 'success');
    } catch (e) {
        console.error(e);
        // Distinguish network errors (Failed to fetch) from API errors
        if (e.message === 'Failed to fetch') {
            showToast('Network Error. Check ID/CORS/AdBlock.', 'error');
        } else {
            showToast(e.message, 'error');
        }
        throw e;
    }
}

async function triggerScraper() {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        showToast('Token required!', 'error');
        return;
    }

    try {
        const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`, {
            method: 'POST',
            headers: { 'Authorization': `token ${token}` },
            body: JSON.stringify({ event_type: 'trigger-scraper' })
        });

        if (res.ok) showToast('Bot Triggered! Refresh in 2-3 mins.', 'success');
        else showToast('Failed to trigger bot', 'error');
    } catch (e) {
        showToast('Error triggering bot', 'error');
    }
}

function showToast(msg, type = 'info') {
    TOAST_MSG.innerText = msg;
    TOAST.className = `toast visible`;
    setTimeout(() => TOAST.className = 'toast hidden', 3000);
}

// Placeholder for checkLinks from v1
async function checkLinks() {
    // ... same as before
    const cards = document.querySelectorAll('.card');
    showToast('Checking links...', 'info');
    for (const card of cards) {
        try {
            await fetch(card.dataset.url, { mode: 'no-cors', method: 'HEAD' });
            document.getElementById(`status-${card.dataset.id}`).style.background = 'var(--success)';
        } catch (e) {
            document.getElementById(`status-${card.dataset.id}`).style.background = 'var(--error)';
        }
    }
}
