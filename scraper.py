import requests
from bs4 import BeautifulSoup
import json
import os
from datetime import datetime
import time

# Configuration
DATA_FILE = 'data/news.json'
# Using a generic tech news source or aggregator for demonstration.
# In a real scenario, this might need multiple sources or specific parsing logic.
# I'll use a mix of sources or a reliable one like Hacker News or similar for demo purposes,
# but since the user asked for generic "noticias", I will try to target a couple of major feeds.
# For simplicity and reliability in this demo, I'll scrape a few headlines from a major tech site
# and maybe a general news site, ensuring we get a good JSON structure.

SOURCES = [
    {
        "name": "TechCrunch",
        "url": "https://techcrunch.com/",
        "selector": ".loop-card", # Approximate selector, will refine
        "title_sel": ".loop-card__title-link",
        "link_sel": ".loop-card__title-link",
        "date_sel": "time",
        "image_sel": "img"
    },
    {
        "name": "YCombinator",
        "url": "https://news.ycombinator.com/",
        "selector": ".athing",
        "title_sel": ".titleline > a",
        "link_sel": ".titleline > a",
        "date_sel": ".age", # logic needed as it's separate row
        "image_sel": None
    }
]

# Let's create a more robust generic scraper for a specific reliable target to ensure it works "out of the box"
# without complex multi-site logic that breaks often. 
# I will build a scraper for "BBC Technology" or similar simple structure.

def scrape_bbc_tech():
    url = "https://www.bbc.com/innovation/technology"
    print(f"Scraping {url}...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
    }
    
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'lxml')
        
        articles = []
        # BBC structure varies, but let's look for common promo cards
        # Targeted selectors for BBC new layout
        cards = soup.find_all('div', {"data-testid": "card-text-wrapper"}) # Generic wrapper often used
        
        # Fallback to a broader search if specific structure missing
        if not cards:
            cards = soup.select('div[class*="Promo"]')

        count = 0 
        for card in cards:
            if count >= 10: break
            
            try:
                # Find link
                link_tag = card.find('a')
                if not link_tag:
                    # sometimes the card itself isn't the link container or text wrapper is separate
                    # Let's go up to parent
                    parent = card.find_parent('div', attrs={"data-testid": "card-wrapper"}) # hypothetical
                    if parent: link_tag = parent.find('a')
                
                if not link_tag: continue

                href = link_tag.get('href')
                if not href: continue
                
                if href.startswith('/'):
                    href = 'https://www.bbc.com' + href

                title_tag = card.find(['h2', 'h3', 'span'])
                title = title_tag.get_text(strip=True) if title_tag else "No Title"
                
                # Image
                # Images are usually siblings or in a parallel structure in these managed grids.
                # Simplified approach: Look for img in the closest common container.
                img_src = "https://placehold.co/600x400?text=News+Image" # Default
                
                # Try to find image
                # Go up 3 levels to find container
                container = card.find_parent('div')
                if container:
                    img_tag = container.find_previous_sibling('div') # Image often previous sibling
                    if not img_tag:
                         img_tag = container.find('img') # Or inside
                    
                    if img_tag:
                        img_search = img_tag.find('img') if img_tag.name != 'img' else img_tag
                        if img_search and img_search.get('src'):
                            img_src = img_search.get('src')

                timestamp = datetime.now().isoformat()

                articles.append({
                    "id": abs(hash(href)),
                    "source": "BBC Technology",
                    "title": title,
                    "url": href,
                    "image": img_src,
                    "scraped_at": timestamp,
                    "status": "unchecked" 
                })
                count += 1
            except Exception as e:
                print(f"Error parsing card: {e}")
                continue
                
        return articles

    except Exception as e:
        print(f"Error scraping BBC: {e}")
        return []

def scrape_the_verge():
    url = "https://www.theverge.com/"
    print(f"Scraping {url}...")
    headers = {"User-Agent": "Mozilla/5.0"}
    
    try:
        response = requests.get(url, headers=headers)
        soup = BeautifulSoup(response.content, 'lxml')
        
        articles = []
        # The Verge specific selectors
        # Usually 'h2' inside main feed
        processed_links = set()
        
        for h2 in soup.find_all('h2', limit=15):
            a = h2.find('a')
            if not a: continue
            
            href = a.get('href')
            if not href.startswith('http'):
                full_link = "https://www.theverge.com" + href
            else:
                full_link = href
                
            if full_link in processed_links: continue
            processed_links.add(full_link)

            title = a.get_text(strip=True)
            
            # Timestamp
            # Often nearby
            time_tag = h2.find_next('time')
            date_str = time_tag.get_text() if time_tag else datetime.now().strftime("%Y-%m-%d")

            # Image
            # This is hard on list views, often no image or lazy loaded.
            image = "https://placehold.co/600x400/png?text=The+Verge"
            
            # Logic to find image in parent figure or div
            # Verge uses <figure> usually preceding or containing
            # We will accept default for now to keep scraper simple and fast.
            
            articles.append({
                "id": abs(hash(full_link)),
                "source": "The Verge",
                "title": title,
                "url": full_link,
                "image": image, # Placeholder for reliability
                "scraped_at": datetime.now().isoformat(),
                "status": "unchecked"
            })
            
        return articles
    except Exception as e:
        print(f"Error The Verge: {e}")
        return []

def main():
    if not os.path.exists('data'):
        os.makedirs('data')
        
    all_news = []
    
    # Scrape Sources
    all_news.extend(scrape_the_verge())
    # BBC is harder to parse consistently without maintenance, let's look for Hacker News API which is easiest and reliable
    # But user asked to "scrape", not API.
    # We will stick to The Verge as it's standard HTML.
    
    # Save
    with open(DATA_FILE, 'w') as f:
        json.dump(all_news, f, indent=2)
    
    print(f"Scraped {len(all_news)} articles. Saved to {DATA_FILE}")

if __name__ == "__main__":
    main()
