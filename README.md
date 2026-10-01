# Kuch Batein

Starter full-stack project for a private 1-to-1 video call app.

## Structure

- `client/` - React and Vite frontend
- `server/` - Node.js, Express, and Socket.IO backend

## Requirements

- Node.js 18 or newer
- npm

## Install

Open two terminal windows from the project root:

```powershell
cd client
npm install
```

```powershell
cd server
npm install
```

## Run

Start the backend:

```powershell
cd server
npm run dev
```

Start the frontend in a second terminal:

```powershell
cd client
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173`.
The page should show `Connected to server`. Stop the backend and the page should change to `Disconnected`.

You can also verify the backend directly at `http://localhost:3001/health`.

## Make a call

1. Open the app in two browser tabs or on two devices.
2. In the first tab, click `Create a new room`, then click `Join call`.
3. Send the displayed room code to one friend. They enter it and click `Join call`.
4. Allow camera and microphone access when the browser asks.

Calls use WebRTC for media and Socket.IO for room membership, signaling, and live chat. Chat messages and media exist only during the active call: they are not stored, and chat is cleared when either participant leaves. The app has no accounts, recordings, or call persistence. For calls across different networks, the included public STUN server helps establish a direct connection; a TURN server may be needed on restrictive networks.

## Install on a phone

The client is an installable PWA. It must be deployed over HTTPS.

- Android: open the deployed client URL in Chrome and choose `Install app` when the app offers it, or use Chrome's menu and choose `Install app`.
- iPhone/iPad: open the deployed client URL in Safari, tap `Share`, choose `Add to Home Screen`, then open the new Kuch Batein icon.

Both people open the installed app, one creates a room, and the other joins using the room code or shared room link. Camera and microphone permissions must be granted. The current backend supports one two-person room at a time per room code and uses memory only, so restarting the server removes active rooms.

For the most reliable calls on restrictive mobile networks, add a TURN provider to the client environment (`VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL`). STUN is included for normal networks, but TURN is required when direct peer-to-peer traffic is blocked. Do not commit TURN credentials; configure them as deployment environment variables.

## Deploy publicly

The repository includes `render.yaml` for a two-service Render deployment. In Render, create a new Blueprint from this repository and deploy it. The blueprint builds the React client as a static site, runs the Socket.IO backend as a web service, passes the backend URL into the client build, and configures the client origin for CORS. After deployment, share the `kuch-batein-client.onrender.com` URL over HTTPS; phone browsers require HTTPS for camera and microphone access.

For local development, copy `server/.env.example` and `client/.env.example` to `.env` files when you need to override the defaults. `CLIENT_ORIGIN` accepts a comma-separated list of allowed frontend origins.
