import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        media_urls = []
        
        def handle_request(request):
            if ".m3u8" in request.url or ".mp4" in request.url:
                media_urls.append(request.url)
                
        page.on("request", handle_request)
        
        print("Navigating to hgcloud...")
        try:
            # don't wait for networkidle, just load and wait a bit
            await page.goto("https://hgcloud.to/e/hb7sq8m5o1hh", timeout=5000)
        except Exception as e:
            print("Goto exception (expected):", e)
            
        await asyncio.sleep(5)
        
        print("Found media URLs:")
        for url in set(media_urls):
            print(url)
            
        await browser.close()

asyncio.run(main())
