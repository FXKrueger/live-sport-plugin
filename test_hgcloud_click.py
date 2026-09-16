import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        # Launch headed to allow auto-play if needed, but headless is easier in this env
        browser = await p.chromium.launch(headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        page = await browser.new_page()
        
        media_urls = []
        api_requests = []
        
        def handle_request(request):
            url = request.url
            if ".m3u8" in url or ".mp4" in url or "video" in url:
                media_urls.append(url)
            if "hgcloud.to/api" in url or "hgcloud.to/v" in url or request.method == "POST":
                api_requests.append((request.method, url, request.post_data))
                
        page.on("request", handle_request)
        
        print("Navigating to hgcloud...")
        try:
            await page.goto("https://hgcloud.to/e/hb7sq8m5o1hh", wait_until="networkidle", timeout=10000)
        except Exception:
            pass
            
        print("Clicking body to trigger video...")
        try:
            await page.click("body", force=True, position={"x": 300, "y": 200})
            await asyncio.sleep(2)
            await page.click("body", force=True, position={"x": 300, "y": 200})
        except Exception as e:
            print("Click failed:", e)
            
        await asyncio.sleep(5)
        
        print("Found API Requests:")
        for r in api_requests:
            print(f"{r[0]} {r[1]} - Data: {r[2]}")
            
        print("\nFound Media URLs:")
        for url in set(media_urls):
            print(url)
            
        await browser.close()

asyncio.run(main())
