// All project data lives here. Edit this file to change the cards.
// Leave demoUrl as "" and no "Live demo" link is shown.
// cover.color / cover.motif style the album sleeve on the shelf
// (motif: "document" | "bars" | "compass" | "wave").
export const projects = [
  {
    title: "RAG Document Assistant",
    cover: { color: "#3b4a5a", motif: "document" },
    side: "A",
    year: 2026,
    description:
      "What if you had a personal assistant for your own study and research documents? Upload your PDFs, ask questions in any language, and get answers based on what you uploaded. Try my RAG app.",
    stack: "React · FastAPI · PostgreSQL + pgvector · Gemini",
    repoUrl: "https://github.com/xuannhi-tran/rag-frontend",
    demoUrl: "https://rag-frontend-lilac.vercel.app/",
  },
  {
    title: "Expense Tracker",
    cover: { color: "#4a5a3f", motif: "bars" },
    side: "A",
    year: 2026,
    description:
      "Struggling to make your money last until the end of the month? Haha, I've been there. Log what you spend, see where it all goes, and try my expense tracker.",
    stack: "React · Django REST · PostgreSQL",
    repoUrl: "https://github.com/xuannhi-tran/expense-frontend",
    demoUrl: "https://expense-frontend-tau-eight.vercel.app/",
  },
  {
    title: "JobCompass",
    cover: { color: "#6b4a3a", motif: "compass" },
    side: "A",
    year: 2026,
    description:
      "As an international student, I know how long it takes to read a whole job ad, only to find out at the end that they want PR or citizens. JobCompass checks the ad for you and tells you whether to apply, tailor your application, or skip. It can also point you to jobs that suit you.",
    stack: "Next.js · TypeScript · rule-based engine",
    repoUrl: "https://github.com/xuannhi-tran/Hackathon-Futura-Remix",
    demoUrl: "https://hackathon-futura-remix.vercel.app/",
  },
  {
    title: "Discord Music Bot",
    cover: { color: "#5a3f55", motif: "wave" },
    side: "B",
    year: 2025,
    description:
      "A Discord music bot I built for my friends' server, since the community bots all start charging after a while. Drop in a YouTube link and it plays in voice chat, with a queue and the usual play, pause, skip and stop commands.",
    stack: "Node.js · discord.js · yt-dlp · ffmpeg",
    repoUrl: "https://github.com/xuannhi-tran/Music-Bot",
    demoUrl: "",
  },
];
