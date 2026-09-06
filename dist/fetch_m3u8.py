import sys
import os
try:
    from curl_cffi import requests
except ImportError:
    print("MISSING_CURL_CFFI")
    sys.exit(1)

m3u8_url = sys.argv[1]
referer = sys.argv[2]
origin = sys.argv[3] if len(sys.argv) > 3 else "https://embed.st"

headers = {
    "Origin": origin,
    "Referer": referer,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
}

proxy_url = os.environ.get("RESIDENTIAL_PROXY")
proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

try:
    r = requests.get(m3u8_url, headers=headers, impersonate="chrome124", timeout=10, proxies=proxies)
    if r.status_code == 200:
        print(r.text)
    else:
        print(f"ERROR_STATUS_{r.status_code}")
except Exception as e:
    print(f"ERROR_EXCEPTION_{str(e)}")
