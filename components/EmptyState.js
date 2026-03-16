"use client";

const STATES = {
  "welcome": {
    title: "Welcome to FFA Scout Board",
    description: "Your AI-powered transfer opportunity radar is ready. Run your first analysis to populate the dashboard.",
  },
  "no-data": {
    title: "No transfer opportunities available",
    description: "Run the analysis pipeline to generate results.",
    codeHint: "npm run run-analysis --sample",
  },
  "no-matches": {
    title: "No opportunities match your filters",
    description: "Try adjusting your filter criteria.",
  },
  "no-tags": {
    title: "No players tagged yet",
    description: "Tag a player on any opportunity to track your pipeline here.",
  },
  "no-players": {
    title: "No players in your roster yet",
    description: "Add your first player to start seeing match suggestions.",
  },
  "no-player-matches": {
    title: "No matching opportunities for this player",
    description: "Check back after the next analysis run.",
    codeHint: "npm run run-matching",
  },
  "no-opportunity-matches": {
    title: "No matching players",
    description: "Add players to your roster to see AI-powered match suggestions.",
  },
};

export default function EmptyState({ type, clearFilters, onRefresh, refreshState }) {
  const state = STATES[type] || STATES["no-data"];

  return (
    <div className="bg-scout-card border border-scout-border rounded-lg p-12 text-center">
      <p className="text-gray-300 text-lg mb-2">{state.title}</p>
      <p className="text-gray-500 text-sm">{state.description}</p>
      {state.codeHint && (
        <p className="text-gray-500 text-sm mt-2">
          Run <code className="text-scout-accent">{state.codeHint}</code>
        </p>
      )}
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshState === "analyzing"}
          className="mt-4 px-4 py-2 text-sm bg-scout-accent text-scout-bg rounded font-medium hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {refreshState === "analyzing" ? "Analyzing..." : "Run First Analysis"}
        </button>
      )}
      {clearFilters && (
        <button
          onClick={clearFilters}
          className="mt-4 px-4 py-2 text-sm bg-scout-accent/20 text-scout-accent rounded hover:bg-scout-accent/30 transition-colors"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
