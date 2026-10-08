// All project data lives here. Edit this file to change the cards.
// demoUrl: the live demo (null = none, and no "Live demo" link is shown).
// liveEnabled: true lets visitors load that demo in an iframe inside the showcase ("Try it live").
// liveNote: an optional short caption shown under the frame while the demo is live.
// slug is used in the URL (#/projects/<slug>); tracks are the three notes in the info panel (and the list view).
// The screenshot for each project is public/demos/<slug>.png. cover.color / cover.motif style the album sleeve
// on the shelf (motif: "document" | "bars" | "compass" | "wave").
export const projects = [
  {
    title: "RAG Document Assistant",
    slug: "rag",
    tracks: [
      { name: "What it does", text: "Upload your PDFs, ask questions in any language, and get answers based on your own documents." },
      { name: "The tricky part", text: "Getting answers to stick to the uploaded documents instead of the model making things up. Chunking the text and searching with pgvector took most of the tuning." },
      { name: "What I learned", text: "How retrieval works end to end: embeddings, vector search, and feeding the right context to Gemini." },
    ],
    cover: { color: "#3b4a5a", motif: "document" },
    side: "A",
    year: 2026,
    description:
      "What if you had a personal assistant for your own study and research documents? Upload your PDFs, ask questions in any language, and get answers based on what you uploaded. Try my RAG app.",
    stack: "React · FastAPI · PostgreSQL + pgvector · Gemini",
    repoUrl: "https://github.com/xuannhi-tran/rag-frontend",
    demoUrl: "https://rag-frontend-lilac.vercel.app/",
    liveEnabled: true,
    liveNote: "",
  },
  {
    title: "Expense Tracker",
    slug: "expense-tracker",
    tracks: [
      { name: "What it does", text: "Log what you spend, see where it goes, and keep track of your budget for the month." },
      { name: "The tricky part", text: "Designing the data model so categories and monthly summaries stay simple to query." },
      { name: "What I learned", text: "Building a full app from scratch: React frontend, a Django REST API, PostgreSQL, and deploying it." },
    ],
    cover: { color: "#4a5a3f", motif: "bars" },
    side: "A",
    year: 2026,
    description:
      "Struggling to make your money last until the end of the month? Haha, I've been there. Log what you spend, see where it all goes, and try my expense tracker.",
    stack: "React · Django REST · PostgreSQL",
    repoUrl: "https://github.com/xuannhi-tran/expense-frontend",
    demoUrl: "https://expense-frontend-tau-eight.vercel.app/?demo=1",
    liveEnabled: true,
    liveNote: "Demo mode with sample data, nothing is saved.",
  },
  {
    title: "JobCompass",
    slug: "jobcompass",
    tracks: [
      { name: "What it does", text: "Reads a job ad and tells you whether to apply, tailor your application, or skip." },
      { name: "The tricky part", text: "Turning messy job ad text into clear rules, like spotting \"PR or citizens only\", and checking the results against a holdout dataset instead of just trusting them." },
      { name: "What I learned", text: "A rule-based engine is easier to explain and debug than a black box. I built the whole app myself, and a teammate prepared the ground-truth dataset." },
    ],
    cover: { color: "#6b4a3a", motif: "compass" },
    side: "A",
    year: 2026,
    description:
      "As an international student, I know how long it takes to read a whole job ad, only to find out at the end that they want PR or citizens. JobCompass checks the ad for you and tells you whether to apply, tailor your application, or skip. It can also point you to jobs that suit you.",
    stack: "Next.js · TypeScript · rule-based engine",
    repoUrl: "https://github.com/xuannhi-tran/Hackathon-Futura-Remix",
    demoUrl: "https://hackathon-futura-remix.vercel.app/",
    liveEnabled: true,
    liveNote: "",
  },
  {
    title: "Discord Music Bot",
    slug: "music-bot",
    tracks: [
      { name: "What it does", text: "Plays YouTube links in voice chat with a queue, plus play, pause, resume, skip and stop commands." },
      { name: "The tricky part", text: "Streaming audio live: yt-dlp feeds ffmpeg, which converts it to raw audio for @discordjs/voice. The bot also needs a separate queue for each server." },
      { name: "What I learned", text: "Working with audio streams and the Discord voice API, and building something my friends actually use." },
    ],
    cover: { color: "#5a3f55", motif: "wave" },
    side: "B",
    year: 2025,
    description:
      "A Discord music bot I built for my friends' server, since the community bots all start charging after a while. Drop in a YouTube link and it plays in voice chat, with a queue and the usual play, pause, skip and stop commands.",
    stack: "Node.js · discord.js · yt-dlp · ffmpeg",
    repoUrl: "https://github.com/xuannhi-tran/Music-Bot",
    demoUrl: null, // a personal bot, not hosted publicly
    liveEnabled: false,
    liveNote: "",
  },
];
