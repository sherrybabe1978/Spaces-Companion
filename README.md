<p align="center">
  <img src="https://img.mytsi.org/i/ioZt903.png" height="300" alt="Spaces Companion Logo"/>
</p>
<p align="center">
  <em>🎙️ Download and transcribe X Spaces effortlessly 🎙️</em>
</p>

<p align="center">
<a href="#overview">📝 Overview</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="#tech-stack">💻 Tech Stack</a>
<span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
<a href="#getting-started">🚀 Getting Started</a>
</p>

## 📝 Overview

Spaces Companion is a powerful platform that enables users to download spaces from X.com (formerly Twitter) and generate transcriptions. The platform is built with a modern tech stack and follows a separated backend-frontend architecture. The frontend is based on the [next-saas-starter](https://github.com/leerob/next-saas-starter) template, while the backend is powered by an Express API.

## 💻 Tech Stack

- ✅ **Framework**: Next.js with TypeScript
- ✅ **Database ORM**: Drizzle
- ✅ **Database**: PostgreSQL (Neon)
- ✅ **UI Components**: shadcn/ui
- ✅ **Payments**: Stripe Integration
- ✅ **Runtime**: Node.js with Express
- ✅ **Web Scraping**: Puppeteer
- ✅ **Transcription**: Groq (Whisper)

## 🚀 Getting Started

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```
2. Create a `.env` file with the following variables:
```env
TWITTER_USERNAME=
TWITTER_PASSWORD=
TWITTER_PHONE_NUMBER=
OUTPUT_PATH=./downloads
PORT=3000
DATABASE_URL=
FRONTEND_URL=http://localhost:3001
```

> **Note**: It's recommended to create a new X account without two-factor authentication for the bot.

3. Install dependencies and start the server:
```bash
npm install
npm build
npm link
npm start
```

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Create a `.env` file with the following variables:
```env
POSTGRES_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
BASE_URL=http://localhost:3001
AUTH_SECRET=
GROQ_API_KEY=
NEXT_PUBLIC_API_URL=http://localhost:3000
```

3. Install dependencies and start the development server:
```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The application should now be running at:
- Frontend: `http://localhost:3001`
- Backend: `http://localhost:3000`
