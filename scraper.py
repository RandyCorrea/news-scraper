import json
import os
from bot_core import NewsML, PortalManager, NewsAPIFetcher, merge_news, cleanup_and_sort_news, NEWS_FILE

def main():
    # 1. Load Data
    if os.path.exists(NEWS_FILE):
        with open(NEWS_FILE, 'r') as f:
            old_news = json.load(f)
    else:
        old_news = []

    # 2. Train Model (if we have scored data)
    ml = NewsML()
    ml.train(old_news)

    # 3. Scrape & Fetch
    manager = PortalManager()
    custom_articles = manager.scrape_all()

    api_fetcher = NewsAPIFetcher()
    api_articles = api_fetcher.fetch_headlines()

    new_articles = custom_articles + api_articles

    # 4. Predict Scores for new articles
    for article in new_articles:
        article['predicted_score'] = ml.predict(article)
        # Auto-score based on prediction if confidence high? No, user wants supervised.
        # Just store the prediction for sorting/badging.

    # 5. Merge
    final_news, added_count = merge_news(old_news, new_articles)
    
    # 6. Cleanup & Sort (72h limit, newest first)
    final_news = cleanup_and_sort_news(final_news, hours=72)

    print(f"Added {added_count} new articles.")
    
    # 7. Save
    with open(NEWS_FILE, 'w') as f:
        json.dump(final_news, f, indent=2)

    print(f"Process Complete. Model trained: {ml.is_trained}. New Articles: {added_count}. Total: {len(final_news)}")

if __name__ == "__main__":
    main()

