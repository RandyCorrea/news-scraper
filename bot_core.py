import os
import json
import joblib
import numpy as np
import requests
from bs4 import BeautifulSoup
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from datetime import datetime, timedelta
from newspaper import Article, Config
from telegraph import Telegraph
from fake_useragent import UserAgent
from newsapi import NewsApiClient
import nltk
try:
    nltk.data.find('tokenizers/punkt')
except LookupError:
    nltk.download('punkt')
    nltk.download('punkt_tab') # For newer NLTK versions

MODEL_FILE = 'data/model.pkl'
NEWS_FILE = 'data/news.json'
PORTALS_FILE = 'data/portals.json'
NEWSAPI_CONFIG_FILE = 'data/newsapi_config.json'
TELEGRAPH_TOKEN_FILE = 'data/telegraph_token.json'

class NewsAPIFetcher:
    def __init__(self):
        self.config = self._load_config()
        self.api_key = self.config.get('api_key')
        self.client = NewsApiClient(api_key=self.api_key) if self.api_key else None
        self.publisher = TelegraphPublisher()

    def _load_config(self):
        if os.path.exists(NEWSAPI_CONFIG_FILE):
             try:
                with open(NEWSAPI_CONFIG_FILE, 'r') as f:
                    return json.load(f)
             except:
                 return {}
        return {}

    def fetch_headlines(self):
        if not self.client:
            print("NewsAPI: No API Key configured.")
            return []

        print("Fetching NewsAPI headlines...")
        articles = []
        try:
            # Default params if not in config
            category = self.config.get('category', 'technology')
            country = self.config.get('country', 'us')
            language = self.config.get('language', 'en')
            
            # Fetch
            response = self.client.get_top_headlines(
                category=category,
                country=country,
                language=language,
                page_size=20
            )

            if response.get('status') != 'ok':
                print(f"NewsAPI Error: {response.get('message')}")
                return []

            for item in response.get('articles', []):
                # Publish content to Telegraph if full content missing? 
                # NewsAPI only gives description/content snippet.
                # Ideally we scrape the 'url' with newspaper3k too?
                # For hybrid speed, let's just use what we get or do a light wrap.
                
                # To keep it consistent, let's just point 'telegraph_url' to the real global URL 
                # OR actually fetch & publish like valid scraper if we want Reader Mode.
                # Let's do a lightweight publish of Title + Description + Link to original.
                
                html_body = f"<p>{item.get('description', '')}</p><br><a href='{item['url']}'>Read Original Source</a>"
                if item.get('urlToImage'):
                     html_body = f"<img src='{item['urlToImage']}'><br>" + html_body

                telegraph_url = self.publisher.publish(
                    title=item['title'],
                    html_content=html_body,
                    author=item.get('source', {}).get('name', 'NewsAPI')
                )

                articles.append({
                    "id": abs(hash(item['url'])),
                    "source": item.get('source', {}).get('name', 'NewsAPI'),
                    "title": item['title'],
                    "url": item['url'],
                    "telegraph_url": telegraph_url,
                    "image": item.get('urlToImage'),
                    "summary": item.get('description'),
                    "scraped_at": datetime.now().isoformat(),
                    "user_score": None
                })
                
        except Exception as e:
            print(f"NewsAPI Fetch failed: {e}")

        return articles

class TelegraphPublisher:
    def __init__(self):
        self.tokens = self._load_or_create_accounts()
        self.current_token_index = 0
        self.telegraph = None
        self._update_client()

    def _update_client(self):
        if self.tokens:
            token = self.tokens[self.current_token_index]
            self.telegraph = Telegraph(access_token=token)

    def _load_or_create_accounts(self):
        tokens = []
        if os.path.exists(TELEGRAPH_TOKEN_FILE):
            try:
                with open(TELEGRAPH_TOKEN_FILE, 'r') as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        tokens = data
                    elif isinstance(data, dict) and 'access_token' in data:
                        # Legacy single token support
                        tokens = [data['access_token']]
            except Exception as e:
                print(f"Error loading Telegraph tokens: {e}")
        
        # Ensure we have at least 5 tokens
        if len(tokens) < 5:
            print(f"Generating Telegraph tokens (Current: {len(tokens)}, Target: 5)...")
            temp_client = Telegraph()
            while len(tokens) < 5:
                try:
                    account = temp_client.create_account(short_name=f'NewsBot_{len(tokens)+1}', author_name='AI News Aggregator')
                    tokens.append(account['access_token'])
                    print(f"  -> Created token {len(tokens)}")
                except Exception as e:
                    print(f"  -> Failed to create token: {e}")
                    break
            
            # Save updated list
            with open(TELEGRAPH_TOKEN_FILE, 'w') as f:
                json.dump(tokens, f)
                
        print(f"Loaded {len(tokens)} Telegraph tokens.")
        return tokens

    def _rotate_token(self):
        if not self.tokens: return
        self.current_token_index = (self.current_token_index + 1) % len(self.tokens)
        self._update_client()
        print(f"  -> Rotated to Telegraph Token #{self.current_token_index + 1}")

    def publish(self, title, html_content, author="AI Bot"):
        if not self.telegraph: return None
        
        max_retries = len(self.tokens)
        attempts = 0
        
        while attempts < max_retries:
            try:
                response = self.telegraph.create_page(
                    title=title[:256],
                    html_content=html_content,
                    author_name=author
                )
                return response['url']
            except Exception as e:
                err_str = str(e).lower()
                if "flood" in err_str:
                    print(f"  -> Telegraph Flood Control hit. Rotating token...")
                    self._rotate_token()
                    attempts += 1
                else:
                    print(f"  -> Telegraph publish failed: {e}")
                    return None
        
        print("  -> All Telegraph tokens hit rate limits.")
        return None

class NewsML:
    def __init__(self):
        self.pipeline = make_pipeline(
            TfidfVectorizer(stop_words='english', max_features=1000),
            Ridge(alpha=1.0)
        )
        self.is_trained = False
        self.load()

    def load(self):
        if os.path.exists(MODEL_FILE):
            try:
                self.pipeline = joblib.load(MODEL_FILE)
                self.is_trained = True
                print("ML Model loaded.")
            except Exception as e:
                print(f"Failed to load model: {e}")

    def save(self):
        joblib.dump(self.pipeline, MODEL_FILE)
        print("ML Model saved.")

    def train(self, articles):
        """
        Train on articles that have a 'user_score' (1-10).
        """
        training_data = [a for a in articles if a.get('user_score') is not None]
        
        if not training_data:
            print("No training data available (no user scores).")
            return

        texts = [f"{a['title']} {a.get('source', '')}" for a in training_data]
        scores = [float(a['user_score']) for a in training_data]

        if len(texts) < 2:
            print("Not enough data to train (need at least 2 scored articles).")
            return

        print(f"Training model on {len(texts)} samples...")
        self.pipeline.fit(texts, scores)
        self.is_trained = True
        self.save()

    def predict(self, article):
        if not self.is_trained:
            return 5.0  # Default neutral score
        
        text = f"{article['title']} {article.get('source', '')}"
        try:
            prediction = self.pipeline.predict([text])[0]
            return max(1.0, min(10.0, float(prediction))) # Clamp between 1 and 10
        except Exception as e:
            print(f"Prediction error: {e}")
            return 5.0

class PortalManager:
    def __init__(self):
        self.portals = self._load_portals()
        self.publisher = TelegraphPublisher()

    def _load_portals(self):
        if os.path.exists(PORTALS_FILE):
            with open(PORTALS_FILE, 'r') as f:
                return json.load(f)
        return []

    def scrape_all(self):
        articles = []
        for portal in self.portals:
            if not portal.get('enabled', True):
                continue
            
            print(f"Scraping {portal['url']}...")
            extracted = self._scrape_portal(portal)
            articles.extend(extracted)
        return articles

    def _scrape_portal(self, portal):
        # 1. Get Links first using basic requests/bs4 to find article URLs
        # (Newspaper can do this too, but we want to stick to the 'portal' definition logic loosely)
        ua = UserAgent()
        headers = {
            "User-Agent": ua.random
        }
        
        items = []
        try:
            resp = requests.get(portal['url'], headers=headers, timeout=10)
            soup = BeautifulSoup(resp.content, 'lxml')
            
            # Find links
            candidates = soup.find_all('a')
            seen_links = set()
            
            count = 0
            for link in candidates:
                href = link.get('href')
                if not href: continue
                
                # Normalize URL
                if not href.startswith('http'):
                    base = '/'.join(portal['url'].split('/')[:3])
                    if href.startswith('/'):
                        href = base + href
                    else:
                        href = base + '/' + href

                if href in seen_links: continue
                seen_links.add(href)
                
                # Basic filter: length and keywords? 
                # Newspaper will do better validation, but we don't want to scan every single link (nav, footer)
                # Heuristic: link text length > 15 chars OR href contains specific path
                text = link.get_text(strip=True)
                if len(text) < 15 and len(href) < 30: continue
                
                # Processing with Newspaper3k
                try:
                    print(f"  -> Processing {href}...")
                    
                    # Create Config with Random UA
                    config = Config()
                    config.browser_user_agent = ua.random
                    config.request_timeout = 10

                    article = Article(href, config=config)
                    article.download()
                    article.parse()
                    
                    if not article.title or len(article.text) < 200:
                        # Skip short/empty content
                        continue
                        
                    # NLP (Optional, can be slow)
                    # article.nlp() 
                    
                    # Prepare content for Telegraph
                    # Simple formatting from text to HTML paragraphs
                    # For better HTML preservation, we'd need more complex parsing, 
                    # but newspaper gives clean updates.
                    
                    # Convert text to simple HTML for telegraph
                    html_body = ""
                    if article.top_image:
                        html_body += f"<img src='{article.top_image}'><br>"
                    
                    # Paragraphs
                    paragraphs = article.text.split('\n\n')
                    for p in paragraphs:
                        if p.strip():
                            html_body += f"<p>{p.strip()}</p>"
                            
                    # Publish
                    telegraph_url = self.publisher.publish(
                        title=article.title,
                        html_content=html_body,
                        author=f"{portal.get('section', 'Bot')} - {', '.join(article.authors)}"
                    )
                    
                    items.append({
                        "id": abs(hash(href)),
                        "source": portal.get('section', 'General'),
                        "title": article.title,
                        "url": href,
                        "telegraph_url": telegraph_url, # NEW field
                        "image": article.top_image or "https://placehold.co/600x400?text=News",
                        "summary": article.meta_description or article.text[:150] + "...",
                        "scraped_at": datetime.now().isoformat(),
                        "user_score": None
                    })
                    
                    count += 1
                    if count >= 3: break # Limit to 3 deep articles per portal for speed/rate-limits
                    
                except Exception as e:
                    print(f"    Failed to process article {href}: {e}")
                    continue

        except Exception as e:
            print(f"Error scraping portal {portal['url']}: {e}")
            
        return items

def merge_news(old_news, new_news):
    # Dedup by URL
    existing_map = {n['url']: n for n in old_news}
    
    merged = []
    # Keep old news 
    for n in old_news:
        merged.append(n)
        
    count_new = 0
    for n in new_news:
        if n['url'] not in existing_map:
            merged.insert(0, n)
            count_new += 1
            
    return merged, count_new

def cleanup_and_sort_news(news_items, hours=72):
    """
    1. Removes items older than 'hours'
    2. Sorts by scraped_at descending (newest first)
    """
    cutoff = datetime.now() - timedelta(hours=hours)
    
    valid_items = []
    for item in news_items:
        try:
            item_date = datetime.fromisoformat(item['scraped_at'])
            if item_date > cutoff:
                valid_items.append(item)
        except ValueError:
            valid_items.append(item)
            
    # Sort
    valid_items.sort(key=lambda x: x.get('scraped_at', ''), reverse=True)
    
    print(f"Cleanup: Removed {len(news_items) - len(valid_items)} old articles. Remaining: {len(valid_items)}")
    return valid_items
