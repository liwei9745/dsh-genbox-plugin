import asyncio
import traceback
import urllib.request

import httpx


async def main() -> None:
    print("getproxies:", urllib.request.getproxies())
    try:
        async with httpx.AsyncClient(timeout=10, proxy=None, verify=True) as client:
            response = await client.post(
                "http://127.0.0.1:8899/v1/images/generations",
                json={"model": "mock-image-1", "prompt": "x", "n": 1, "size": "512x512", "response_format": "b64_json"},
                headers={"Authorization": "Bearer sk-mock"},
            )
            print("status:", response.status_code, response.text[:120])
    except Exception:
        traceback.print_exc()


asyncio.run(main())
