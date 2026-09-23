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

## GitHub hosting

GitHub Pages can host the `client/` frontend, but it cannot run the Node.js signaling server. Deploy `server/` separately on a Node host such as Render, Railway, or Fly.io, then set its `CLIENT_ORIGIN` to the GitHub Pages URL.

1. Create a GitHub repository and push this project to it.
2. In repository settings, enable Pages with **GitHub Actions** as the source.
3. Add a repository variable named `VITE_SERVER_URL` containing the public HTTPS URL of the deployed server.
4. The workflow in `.github/workflows/deploy-pages.yml` will build and publish `client/` automatically.
