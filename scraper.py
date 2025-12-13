import json
import os
from bot_core import NewsML, PortalManager, merge_news, NEWS_FILE

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

    # 3. Scrape
    manager = PortalManager()
    new_articles = manager.scrape_all()

    # 4. Predict Scores for new articles
    for article in new_articles:
        article['predicted_score'] = ml.predict(article)
        # Auto-score based on prediction if confidence high? No, user wants supervised.
        # Just store the prediction for sorting/badging.

    # 5. Merge
    final_list, added_count = merge_news(old_news, new_articles)
    
    # 6. Save
    with open(NEWS_FILE, 'w') as f:
        json.dump(final_list, f, indent=2)

    print(f"Process Complete. Model trained: {ml.is_trained}. New Articles: {added_count}. Total: {len(final_list)}")

if __name__ == "__main__":
    main()

