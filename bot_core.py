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

MODEL_FILE = 'data/model.pkl'
NEWS_FILE = 'data/news.json'
PORTALS_FILE = 'data/portals.json'

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
        # Generic scraper using selectors from JSON
        # If selectors missing, try heuristic fallback
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        try:
            resp = requests.get(portal['url'], headers=headers, timeout=10)
            soup = BeautifulSoup(resp.content, 'lxml')
            
            items = []
            selectors = portal.get('selectors', {})
            item_sel = selectors.get('item', 'h2') # Default assumption
            
            if not item_sel:
                # Fallback: find all 'a' tags with length > 20 chars
                candidates = soup.find_all('a')
            else:
                candidates = soup.select(item_sel)

            seen_links = set()

            for item in candidates:
                link_tag = item if item.name == 'a' else item.find('a')
                if not link_tag: continue
                
                href = link_tag.get('href')
                if not href: continue
                
                if not href.startswith('http'):
                    base = '/'.join(portal['url'].split('/')[:3]) # simple base extraction
                    if href.startswith('/'):
                        href = base + href
                    else:
                        href = base + '/' + href # simplistic

                if href in seen_links: continue
                seen_links.add(href)

                title = link_tag.get_text(strip=True)
                if len(title) < 10: continue

                # Image attempt
                img = "https://placehold.co/600x400?text=News"
                # Try simple heuristic for image
                # Parent logic... similar to previous scraper
                
                items.append({
                    "id": abs(hash(href)),
                    "source": portal.get('section', 'General'),
                    "title": title,
                    "url": href,
                    "image": img,
                    "scraped_at": datetime.now().isoformat(),
                    "user_score": None # New items have no score
                })
                
                if len(items) >= 10: break # Limit per portal
            
            return items

        except Exception as e:
            print(f"Error scraping {portal['url']}: {e}")
            return []

def merge_news(old_news, new_news):
    # Dedup by URL
    existing_map = {n['url']: n for n in old_news}
    
    merged = []
    # Keep old news (preserving user scores)
    for n in old_news:
        merged.append(n)
        
    count_new = 0
    for n in new_news:
        if n['url'] not in existing_map:
            merged.insert(0, n) # Add new to top
            count_new += 1
    
    # Sort by date? Or score? 
    # For now, keep somewhat chronological, but we could sort by predicted score later.
    return merged, count_new
