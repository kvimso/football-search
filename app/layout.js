import "./globals.css";
import NavBar from "../components/NavBar.js";
import { logEnvStatus } from "../lib/env-check.js";

logEnvStatus();

export const metadata = {
  title: "FFA Scout Board",
  description: "AI-powered transfer opportunity radar for Free Football Agency",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-scout-bg text-gray-200 antialiased">
        <NavBar />
        {children}
        <footer className="border-t border-scout-border mt-12 py-6 text-center text-sm text-gray-500">
          FFA Scout Board v0.1 — Built for Free Football Agency
        </footer>
      </body>
    </html>
  );
}
