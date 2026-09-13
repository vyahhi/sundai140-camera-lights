# You, In Light

Turn a webcam view into a live 17 × 9 pixel portrait for the Green Building simulator. The browser processes video locally and sends only the resulting 153 RGB pixels through a server-side relay.

## Modes

- Natural camera pixelation
- Face-aware Portrait
- Color-coded Stick Man with pose tracking

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`, allow camera access, choose a mode, and press **Go live on building**.

## Configuration and secrets

`DISPLAY_URL` selects the frame receiver. The default points to the public `jolly-seal` simulator endpoint.

Local environment files are ignored by Git. Keep credentials in `.env.local`; commit only non-secret placeholders to `.env.example`.

## Privacy

Webcam video stays in the browser. The relay receives only a 17 × 9 array of RGB values.
