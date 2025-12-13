import os
import json
import joblib
import numpy as np
import requests
from bs4 import BeautifulSoup
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from datetime import datetime
from newspaper import Article, Config
from telegraph import Telegraph

MODEL_FILE = 'data/model.pkl'
NEWS_FILE = 'data/news.json'
PORTALS_FILE = 'data/portals.json'
TELEGRAPH_TOKEN_FILE = 'data/telegraph_token.json'

class TelegraphPublisher:
    def __init__(self):
        self.telegraph = Telegraph()
        self.token = self._load_or_create_account()
        
    def _load_or_create_account(self):
        if os.path.exists(TELEGRAPH_TOKEN_FILE):
            try:
                with open(TELEGRAPH_TOKEN_FILE, 'r') as f:
                    data = json.load(f)
                    token = data.get('access_token')
                    print(f"Loaded Telegraph token.")
                    self.telegraph = Telegraph(access_token=token)
                    return token
            except Exception as e:
                print(f"Error loading Telegraph token: {e}")
        
        # Create new
        try:
            print("Creating new Telegraph account...")
            account = self.telegraph.create_account(short_name='NewsBot', author_name='AI News Aggregator')
            with open(TELEGRAPH_TOKEN_FILE, 'w') as f:
                json.dump(account, f)
            return account['access_token']
        except Exception as e:
            print(f"Failed to create Telegraph account: {e}")
            return None

    def publish(self, title, html_content, author="AI Bot"):
        if not self.token: return None
        try:
            response = self.telegraph.create_page(
                title=title[:256], # Limit title length
                html_content=html_content,
                author_name=author
            )
            return response['url']
        except Exception as e:
            print(f"Telegraph publish failed: {e}")
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
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
                    article = Article(href)
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
