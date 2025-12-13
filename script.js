const NEWS_SOURCE = 'data/news.json';
const GRID = document.getElementById('news-grid');
const TOAST = document.getElementById('toast');
const TOAST_MSG = document.getElementById('toast-message');

// Initial Load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch(NEWS_SOURCE);
        if (!response.ok) throw new Error('Failed to load news data');
        const news = await response.json();
        renderNews(news);
    } catch (error) {
        console.error(error);
        GRID.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 2rem;">
                <h3 style="color: var(--text-secondary);">Local data not found or empty.</h3>
                <p>If this is the first run, trigger the scraper.</p>
            </div>
        `;
    }

    // Event Listeners
    document.getElementById('check-links-btn').addEventListener('click', checkLinks);
    document.getElementById('trigger-btn').addEventListener('click', triggerScraper);
});

function renderNews(articles) {
    if (!articles || articles.length === 0) {
        GRID.innerHTML = '<p class="no-data">No articles found.</p>';
        return;
    }

    GRID.innerHTML = articles.map(article => `
        <article class="card" data-url="${article.url}" data-id="${article.id}">
            <div class="card-image-container">
                <img src="${article.image || 'https://placehold.co/600x400'}" alt="${article.title}" class="card-image" onerror="this.src='https://placehold.co/600x400?text=Error'">
            </div>
            <div class="card-content">
                <span class="source-badge">${article.source}</span>
                <a href="${article.url}" target="_blank" class="card-title">${article.title}</a>
                <div class="card-meta">
                    <span class="date">${new Date(article.scraped_at).toLocaleDateString()}</span>
                    <div class="status-indicator">
                        <div class="status-dot" id="status-${article.id}"></div>
                        <span id="status-text-${article.id}">Unknown</span>
                    </div>
                </div>
            </div>
        </article>
    `).join('');

    // Re-init icons for dynamic content if needed, but here simple static icons
}

async function checkLinks() {
    const cards = document.querySelectorAll('.card');
    showToast('Checking links compatibility...', 'info');

    for (const card of cards) {
        const url = card.dataset.url;
        const id = card.dataset.id;
        const dot = document.getElementById(`status-${id}`);
        const text = document.getElementById(`status-text-${id}`);

        dot.className = 'status-dot checking';
        text.innerText = 'Checking...';

        try {
            // Note: CORS often blocks direct HEAD/GET requests to external news sites from a browser.
            // We'll use no-cors mode which returns an opaque response. 
            // If it doesn't throw a network error, it often means the domain is reachable.
            // However, 404s might be masked. This is a "reachability" check.
            await fetch(url, { mode: 'no-cors', method: 'HEAD' });

            // If we got here, DNS/Connection likely OK.
            dot.className = 'status-dot active';
            text.innerText = 'Active';
        } catch (error) {
            dot.className = 'status-dot error';
            text.innerText = 'Unreachable';
        }

        // Small delay to visualize progress
        await new Promise(r => setTimeout(r, 200));
    }
    showToast('Link check completed', 'success');
}

async function triggerScraper() {
    const token = document.getElementById('gh-token').value;
    if (!token) {
        showToast('Please enter a GitHub Token', 'error');
        return;
    }

    // Infer repo details from URL or user must hardcode them?
    // Since this is a template, we can't easily guess the repo if running locally without config.
    // For now, I'll assume the user might need to input repo/owner or we defaults to current context if deployed.
    // BUT since we are running locally, let's ask for repo or assume it from the plan logic.
    // I'll make the user input "owner/repo" or hardcode it if known. 
    // Wait, the user prompt implies "a la web local debe... boton para arrancar la action".

    // I will try to fetch the repo info from the git config or just prompt.
    // Simplifying: I'll hardcode a placeholder or ask user to fill it. 
    // Better: Add an input for "Repo" or just use the token and assume the user knows they need to edit the script/input.
    // I'll stick to a prompt approach for Repo to be generic.

    let repoSlug = prompt("Enter repository (owner/repo):", "RandyCorrea/usdt-p2p-venezuela-extension");
    // Wait, user is in "chat-hub"? The user path is `Documents/P2P/chat-hub`. 
    // Repo context: `RandyCorrea/usdt-p2p-venezuela-extension` is the P2P extension. This is likely a NEW repo or subfolder.
    // User said "web alojada en githubpages with un bot".
    // I will use a prompt for flexibility.

    if (!repoSlug) return;

    showToast('Triggering GitHub Action...', 'info');

    try {
        const response = await fetch(`https://api.github.com/repos/${repoSlug}/dispatches`, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                event_type: 'trigger-scraper'
            })
        });

        if (response.ok) {
            showToast('Scraper triggered successfully!', 'success');
        } else {
            const err = await response.json();
            showToast(`Error: ${err.message || 'Failed'}`, 'error');
        }
    } catch (error) {
        showToast('Network error triggering action', 'error');
        console.error(error);
    }
}

function showToast(msg, type = 'info') {
    TOAST_MSG.innerText = msg;
    TOAST.className = `toast visible`;
    // could style based on type
    setTimeout(() => {
        TOAST.className = 'toast hidden';
    }, 3000);
}
