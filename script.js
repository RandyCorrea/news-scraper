const REPO_OWNER = 'RandyCorrea';
const REPO_NAME = 'news-scraper';
const NEWS_SOURCE = 'data/news.json';
const PORTALS_SOURCE = 'data/portals.json';
const SETTINGS_SOURCE = 'data/newsapi_config.json';

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
        // Global Error Handler
        window.onerror = function (msg, url, line) {
            console.error(`JS Error: ${msg} (Line ${line})`);
            showToast(`Error: ${msg}`, 'error');
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
        await Promise.all([loadNews(), loadPortals(), loadSettings()]);

        // Events
        document.getElementById('test-portal-btn').addEventListener('click', testPortalExtraction);
        document.getElementById('save-portal-btn').addEventListener('click', saveNewPortal);
        document.getElementById('trigger-btn').addEventListener('click', triggerScraper);
        document.getElementById('check-links-btn').addEventListener('click', checkLinks);
        document.getElementById('verify-btn').addEventListener('click', verifyToken);
        document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

        // Initial Icons
        lucide.createIcons();

        // Auto-load Token
        const savedToken = localStorage.getItem('gh_token');
        if (savedToken) {
            document.getElementById('gh-token').value = savedToken;
            // Verify silently on load to update UI state if valid
            verifyToken(true);
        }

    } catch (e) {
        console.error("Init Error", e);
        showToast("Failed to initialize app", 'error');
    }
});

async function loadNews() {
    try {
        const response = await fetch(NEWS_SOURCE + '?t=' + Date.now());
        if (!response.ok) throw new Error('Failed to load news');
        newsData = await response.json();
        renderNews(newsData);
    } catch (error) {
        console.error(error);
        GRID.innerHTML = `<div class="no-data"><i data-lucide="alert-triangle" size="48"></i><p>No news data found or failed to load.</p></div>`;
        lucide.createIcons();
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

async function loadSettings() {
    try {
        const response = await fetch('data/newsapi_config.json' + '?t=' + Date.now());
        if (response.ok) {
            const config = await response.json();
            document.getElementById('news-api-key').value = config.api_key || '';
            document.getElementById('news-country').value = config.country || 'us';
            document.getElementById('news-category').value = config.category || 'technology';
        }
    } catch (e) {
        console.log("No config found or load error", e);
    }
}

function renderNews(articles) {
    if (!articles || articles.length === 0) {
        GRID.innerHTML = '<div class="no-data"><p>No articles found. Trigger the bot to fetch news.</p></div>';
        return;
    }

    // Sort by predicted score desc
    articles.sort((a, b) => (b.predicted_score || 0) - (a.predicted_score || 0));

    // Filter discarded
    const visibleArticles = articles.filter(a => a.status !== 'discarded');

    GRID.innerHTML = visibleArticles.map(article => {
        const rating = article.user_score || 0;
        const pred = article.predicted_score ? article.predicted_score.toFixed(1) : '?';
        const cleanLink = article.telegraph_url ?
            `<a href="${article.telegraph_url}" target="_blank" class="btn secondary small" title="Read Clean View"><i data-lucide="book-open"></i> Read</a>` : '';

        return `
        <article class="card fade-in" data-url="${article.url}" data-id="${article.id}">
            <div class="card-image-container">
                <span class="prediction-badge">AI Score: ${pred}</span>
                <button class="discard-btn" onclick="discardArticle('${article.id}')" title="Discard"><i data-lucide="x"></i></button>
                <img src="${article.image || 'https://placehold.co/600x400'}" alt="Img" class="card-image" onerror="this.src='https://placehold.co/600x400?text=News+Image'">
            </div>
            <div class="card-content">
                <span class="source-badge">${article.source}</span>
                <a href="${article.url}" target="_blank" class="card-title" title="${article.title}">${article.title}</a>
                <p class="summary">${article.summary || 'No summary available.'}</p>
                
                <div class="actions-row">
                    ${cleanLink}
                    <div class="rating-container">
                        <div class="stars" data-id="${article.id}">
                            ${[1, 2, 3, 4, 5].map(n => `
                                <span class="star ${n <= rating ? 'active' : ''}" data-val="${n}" onclick="rateArticle('${article.id}', ${n})">★</span>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="card-meta">
                    <span class="date">${new Date(article.scraped_at).toLocaleDateString()}</span>
                    <div class="status-indicator">
                        <div class="status-dot" id="status-${article.id}" title="Link Status"></div>
                    </div>
                </div>
            </div>
        </article>
    `}).join('');

    lucide.createIcons();
}

// Global scope for onclick handlers
window.discardArticle = async function (id) {
    // Direct discard without confirmation

    // Optimistic remove
    const article = newsData.find(a => String(a.id) === String(id));
    if (article) {
        article.status = 'discarded';
        renderNews(newsData);
        showToast('Article discarded', 'info');
        try {
            await updateGitHubFile(NEWS_SOURCE, newsData, `Discard article ${id}`);
        } catch (e) {
            showToast('Failed to sync discard to GitHub', 'error');
        }
    }
};

window.rateArticle = async function (id, score) {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        showToast('Token required to save rating!', 'error');
        return;
    }

    // Optimistic Update
    const article = newsData.find(a => String(a.id) === String(id));
    if (article) {
        article.user_score = score;
        renderNews(newsData);
    }

    showToast(`Saving rating ${score}...`, 'info');
    try {
        await updateGitHubFile(NEWS_SOURCE, newsData, `User rated article ${id} as ${score}`);
        showToast('Rating saved!', 'success');
    } catch (e) {
        showToast('Failed to save rating to GitHub', 'error');
    }
};

window.deletePortal = async function (id) {
    if (!confirm('Are you sure you want to delete this portal?')) return;
    const token = document.getElementById('gh-token').value.trim();
    if (!token) {
        showToast('Token required!', 'error');
        return;
    }

    portalsData = portalsData.filter(p => p.id !== id);
    renderPortals(portalsData);

    try {
        await updateGitHubFile(PORTALS_SOURCE, portalsData, `Delete portal ${id}`);
        showToast('Portal deleted', 'success');
    } catch (e) {
        showToast('Failed to delete portal', 'error');
    }
};

function renderPortals(portals) {
    if (!portals || portals.length === 0) {
        PORTALS_LIST.innerHTML = '<p class="text-muted">No portals configured.</p>';
        return;
    }
    PORTALS_LIST.innerHTML = portals.map(p => `
        <div class="portal-item">
            <div class="portal-info">
                <strong>${p.url}</strong>
                <span class="portal-url">${p.section} | Enabled: ${p.enabled}</span>
            </div>
            <button class="btn danger small" onclick="deletePortal(${p.id})"><i data-lucide="trash-2"></i> Delete</button>
        </div>
    `).join('');
    lucide.createIcons();
}

async function verifyToken(silent = false) {
    const token = document.getElementById('gh-token').value.trim();
    const btn = document.getElementById('verify-btn');

    if (!token) {
        if (!silent) showToast('Enter token first', 'error');
        return;
    }

    if (!silent) btn.innerHTML = '...';

    try {
        const res = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (res.ok) {
            const user = await res.json();
            localStorage.setItem('gh_token', token);
            if (!silent) {
                showToast(`Connected as ${user.login}`, 'success');
                btn.classList.add('success');
            }
            btn.innerHTML = '<i data-lucide="check"></i>';
            lucide.createIcons();
        } else {
            throw new Error(`API Error: ${res.status}`);
        }
    } catch (e) {
        console.error(e);
        if (!silent) {
            showToast(`Verify Failed: ${e.message}`, 'error');
            btn.classList.remove('success');
            btn.innerHTML = '<i data-lucide="x"></i>';
            lucide.createIcons();
        }
    }
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
        selectors: { item: 'h2', link: 'a' }
    };

    portalsData.push(newPortal);
    renderPortals(portalsData);

    try {
        await updateGitHubFile(PORTALS_SOURCE, portalsData, `Add portal ${url}`);
        showToast('Portal saved successfully!', 'success');
        document.getElementById('portal-url').value = '';
        document.getElementById('test-result').classList.add('hidden');
    } catch (e) {
        showToast('Failed to save to GitHub', 'error');
        // Revert optimization
        portalsData.pop();
        renderPortals(portalsData);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save Portal';
    }
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
        saveBtn.disabled = false;
        // Simple fetch attempt
        await fetch(url, { mode: 'no-cors' });
        resultBox.className = 'test-result success';
        resultBox.innerText = `✅ Network Reachable. Ready to save.`;
    } catch (e) {
        resultBox.className = 'test-result error';
        resultBox.innerText = `⚠️ Network Error: ${e.message}. You can save anyway.`;
        saveBtn.disabled = false;
    }
}

async function updateGitHubFile(path, contentObj, msg) {
    const token = document.getElementById('gh-token').value.trim();
    if (!token) throw new Error('Token is empty');

    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;

    // Get SHA
    let sha = null;
    const getRes = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }
    });

    if (getRes.ok) {
        const getData = await getRes.json();
        sha = getData.sha;
    } else if (getRes.status !== 404) {
        throw new Error(`Fetch Error ${getRes.status}`);
    }

    // Update or Create
    const contentStr = JSON.stringify(contentObj, null, 2);
    // Safe Base64 encoding for UTF-8
    const encoded = btoa(unescape(encodeURIComponent(contentStr)));

    const body = {
        message: msg,
        content: encoded
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify(body)
    });

    if (!putRes.ok) throw new Error(`Save Error ${putRes.status}`);
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
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ event_type: 'trigger-scraper' })
        });

        if (res.ok) showToast('Bot Triggered! It will run in the cloud.', 'success');
        else showToast('Failed to trigger bot', 'error');
    } catch (e) {
        showToast('Error triggering bot', 'error');
    }
}

function showToast(msg, type = 'info') {
    TOAST_MSG.innerText = msg;
    TOAST.className = `toast visible`;
    if (type === 'error') TOAST.style.borderColor = 'var(--error)';
    else if (type === 'success') TOAST.style.borderColor = 'var(--success)';
    else TOAST.style.borderColor = 'var(--glass-border)';

    setTimeout(() => TOAST.className = 'toast hidden', 4000);
}

// Check Links
async function checkLinks() {
    const cards = document.querySelectorAll('.card');
    showToast('Checking links reachability...', 'info');

    for (const card of cards) {
        const dot = document.getElementById(`status-${card.dataset.id}`);
        if (!dot) continue;

        dot.style.background = 'var(--primary)'; // checking
        try {
            await fetch(card.dataset.url, { mode: 'no-cors', method: 'HEAD' });
            dot.style.background = 'var(--success)';
            dot.title = "Link Reachable";
        } catch (e) {
            dot.style.background = 'var(--error)';
            dot.title = "Link Unreachable";
        }
    }
    showToast('Link check complete.', 'success');
}
async function saveSettings() {
    const btn = document.getElementById('save-settings-btn');
    const originalText = btn.innerText;

    try {
        btn.innerText = 'Saving...';
        btn.disabled = true;

        const config = {
            api_key: document.getElementById('news-api-key').value.trim(),
            country: document.getElementById('news-country').value,
            category: document.getElementById('news-category').value,
            language: 'en'
        };

        const token = document.getElementById('gh-token').value.trim();
        if (!token) throw new Error("GitHub Token required to save settings.");

        await updateGitHubFile(SETTINGS_SOURCE, JSON.stringify(config, null, 4), "Update NewsAPI Config");
        showToast("Settings Saved Successfully!", "success");

    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}
