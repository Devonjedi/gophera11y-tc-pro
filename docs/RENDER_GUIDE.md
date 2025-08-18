# Render One-Click Deploy (Guide)

1. Push this folder to a new GitHub repo.
2. In Render, click **New → Blueprint** and select your repo.
3. Render will detect `render.yaml` and create two services: **gophera11y-api** and **gophera11y-web**.
4. After **gophera11y-api** is live, copy its URL (e.g., https://gophera11y-api.onrender.com).
5. Open the **gophera11y-web** service → **Environment** → set `NEXT_PUBLIC_API_URL` to the API URL.
6. Click **Deploy latest commit** for the web service.
7. Open the web URL and run a scan/crawl to verify.
