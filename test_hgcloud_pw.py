import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # We'll intercept network requests to catch the m3u8 or mp4
        media_urls = []
        
        page.on("request", lambda request: media_urls.append(request.url) if ".m3u8" in request.url or ".mp4" in request.url else None)
        
        print("Navigating to hgcloud...")
        await page.goto("https://hgcloud.to/e/hb7sq8m5o1hh", wait_until="networkidle", timeout=15000)
        
        print("Found media URLs:")
        for url in set(media_urls):
            print(url)
            
        await browser.close()

asyncio.run(main())
