# Proxy MakerWorld (opcional) — importação com 1 clique, também no telemóvel

O MakerWorld não permite que outros sites leiam a sua API diretamente no browser (CORS).
A app tenta vários métodos automaticamente; este Worker gratuito torna a importação **100% fiável**.

## Instalação (≈5 minutos, gratuito)

1. Cria conta em <https://dash.cloudflare.com/sign-up> (plano Free).
2. Menu **Workers & Pages** → **Create** → **Create Worker** → dá o nome `imagina3d-mw` → **Deploy**.
3. Clica em **Edit code**, apaga tudo e cola o conteúdo de [`makerworld-proxy.js`](./makerworld-proxy.js).
4. Se a tua app estiver noutro endereço (ex.: Netlify), adiciona-o em `ALLOWED_ORIGINS`.
5. **Deploy**. Copia o URL do Worker (ex.: `https://imagina3d-mw.<conta>.workers.dev`).
6. Na app: **⚙️ Definições → Importação MakerWorld → URL do Proxy** → cola o URL → **Guardar**.

Teste rápido no browser: `https://imagina3d-mw.<conta>.workers.dev/?id=1400373` deve mostrar JSON.

## Sem Worker?

- **Computador:** usa o botão/bookmarklet **"→ Imagina3D"** (ver Definições) diretamente na página do modelo.
- **Qualquer dispositivo:** na Calculadora, "Modo manual" → abre o link de dados → copia tudo → cola.
