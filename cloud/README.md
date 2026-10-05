# TrueTone on Alibaba Cloud

Recommended split:

- Frontend: Alibaba Cloud ESA Functions & Pages, imported from this GitHub repository.
- AI API: Function Compute Web Function using `cloud/fc/app.py`.
- Model: Alibaba Cloud Model Studio / Qwen.
- Raw sample images and complete structured datasets: private OSS bucket.
- Selfie: browser-local by default. If server upload is later required, use temporary private OSS objects with lifecycle deletion.

## Function Compute

Start command:

```bash
python cloud/fc/app.py
```

Environment variables:

```
DASHSCOPE_API_KEY=...
MODEL_STUDIO_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
PORT=9000
```

After the Function Compute URL or custom API domain is available, edit `config.js`:

```js
window.TRUETONE_CONFIG = {
  apiBase: "https://YOUR-API-DOMAIN"
};
```

The public frontend never contains the Model Studio API key.
