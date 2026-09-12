# 🏴‍☠️ Dead-Man's-Wake

A fast-paced 3D naval combat and Caribbean exploration game built with **Three.js**, **Vite**, and **PeerJS** (WebRTC multiplayer).

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 3. Production Build
```bash
npm run build
```
Generates the optimized production files in `dist/`.

### 4. Preview Production Build Locally
```bash
npm run preview
```

---

## 🌐 Deploying to Netlify

The project is fully pre-configured for Netlify with [`netlify.toml`](./netlify.toml), [`public/_redirects`](./public/_redirects), and [`public/_headers`](./public/_headers).

### Option 1: Git-Connected Deployment (Recommended)
1. Push your repository to GitHub, GitLab, or Bitbucket:
   ```bash
   git add .
   git commit -m "Deploy to Netlify"
   git push origin main
   ```
2. Go to [app.netlify.com](https://app.netlify.com) and click **"Add new site"** > **"Import an existing project"**.
3. Select your repository.
4. Netlify will automatically detect the settings from `netlify.toml`:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
   - **Node version**: `20`
5. Click **"Deploy site"**. Every future push to `main` will automatically build and deploy!

---

### Option 2: Netlify CLI
If you have the Netlify CLI installed:
```bash
# 1. Build production bundle
npm run build

# 2. Deploy directly to Netlify
netlify deploy --prod --dir=dist
```

---

### Option 3: Netlify Drag & Drop (Zero Setup)
1. Run the build command:
   ```bash
   npm run build
   ```
2. Navigate to [app.netlify.com/drop](https://app.netlify.com/drop).
3. Drag and drop the `dist/` folder into the upload box.
4. Your game goes live immediately with full SPA routing and 3D asset caching!

---

## ⚙️ Netlify Pre-Configurations Included

- **SPA Routing**: Automatic fallback redirect (`/* -> /index.html 200`) so refreshing any page or direct deep links never return 404.
- **Asset Caching**: 1-year immutable caching for hashed JS/CSS assets in `/assets/*`.
- **3D Asset & Audio Headers**: Optimized caching and CORS headers for GLB/GLTF models and audio files.
- **Security Headers**: Includes `X-Frame-Options`, `X-Content-Type-Options: nosniff`, and modern `Referrer-Policy`.
- **PeerJS Multiplayer**: Works out-of-the-box over HTTPS using WebRTC and public STUN servers.
