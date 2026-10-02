# Daily Government Bulletin Studio v2.0 🇮🇳

An interactive, feature-rich desktop and web studio engineered for creating official multi-page government bulletins, press releases, newsletters, and public circulars.

---

## ✨ Features

- **Double Action Bar UI**: Dedicated document management header paired with a streamlined formatting/styling toolbar.
- **10+ Curated Official Themes & Templates**:
  - *National Tricolor*, *Kashi Sandhya*, *Saffron Heritage*, *Jal Shakti*, *Forest Green*, *Swachh Bharat*, *Digital India*, *Vibrant Crimson*, *Executive Minimal*, and *Midnight Gold*.
- **Google Gemini AI Integration**:
  - Direct integration with Google Gemini API for auto-drafting, headline summarization, tone refinement, and automated multi-page content structuring.
  - Safe client-side storage for user API keys.
- **Dynamic Multi-Page Support**:
  - Add, duplicate, delete, and reorder bulletin pages seamlessly.
  - Independent page headers, footers, pagination, and seal/emblem toggles.
- **Granular Header & Logo Controls**:
  - Toggle and customize Left Logo, Center Emblem, and Right Logo with instant preview updates.
- **High-Fidelity PDF & Image Export**:
  - Client-side high-resolution multi-page PDF generation and high-DPI image exports.
- **Portable Windows Executable**:
  - Zero-installation, standalone desktop executable powered by Electron.

---

## 🚀 Getting Started

### Option 1: Run with Portable Desktop App
If you built or downloaded the portable app:
- Launch `dist/Daily-Bulletin-Studio-v2-Portable.exe` directly on Windows (no install required).

### Option 2: Run Electron Desktop App Locally
Make sure [Node.js](https://nodejs.org/) (v18+) is installed.

```bash
# Install dependencies
npm install

# Start the desktop application
npm start
```

### Option 3: Run as Web Application
Run the bundled batch script or any local static web server:
- Double-click `Start_Bulletin_Studio.bat` or `Start_Server.bat`.
- Or serve `bulletin_app/index.html` with your favorite web server.

---

## 📦 Building Portable Executable

To package into a standalone Windows `.exe`:
```bash
npm run dist
```
The output will be placed in the `dist/` directory as `Daily-Bulletin-Studio-v2-Portable.exe`.

---

## 🛠 Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3, Google Fonts.
- **Desktop Wrapper**: Electron 33+, Electron Builder.
- **AI Engine**: Google Gemini API (`@google/genai`).
- **Rendering & Export**: html2pdf.js, html2canvas, jsPDF.

---

## 📄 License

ISC License.
