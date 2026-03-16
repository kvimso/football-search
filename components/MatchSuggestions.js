"use client";

import { useState } from "react";

const SCORE_CONFIG = {
  strong: { label: "Strong", classes: "bg-green-500/20 text-green-400 border border-green-500/30" },
  moderate: { label: "Moderate", classes: "bg-amber-500/20 text-amber-400 border border-amber-500/30" },
  weak: { label: "Weak", classes: "bg-blue-500/20 text-blue-400 border border-blue-500/30" },
};

function getScoreConfig(score) {
  if (score >= 80) return SCORE_CONFIG.strong;
  if (score >= 50) return SCORE_CONFIG.moderate;
  return SCORE_CONFIG.weak;
}

export default function MatchSuggestions({
  matches,
  onConfirm,
  onDismiss,
}) {
  const [showAll, setShowAll] = useState(false);

  if (!matches || matches.length === 0) return null;

  const displayMatches = showAll ? matches : matches.slice(0, 3);

  return (
    <div className="mt-3 pt-3 border-t border-scout-border/50">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">AI Suggestions</p>
      <div className="space-y-1.5">
        {displayMatches.map((match) => {
          const scoreConfig = getScoreConfig(match.match_score);
          const playerName = match.players?.name || match.player_name || "Unknown";

          return (
            <div
              key={match.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-dashed border-scout-border/60 bg-scout-bg/30"
            >
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${scoreConfig.classes}`}>
                {match.match_score}
              </span>
              <span className="text-sm text-gray-300 truncate flex-1">{playerName}</span>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => onConfirm(match)}
                  className="text-xs px-1.5 py-0.5 rounded text-green-400 hover:bg-green-500/20 transition-colors"
                  title="Accept match"
                >
                  +
                </button>
                <button
                  onClick={() => onDismiss(match)}
                  className="text-xs px-1.5 py-0.5 rounded text-gray-500 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                  title="Dismiss"
                >
                  &times;
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {matches.length > 3 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-xs text-scout-accent hover:text-green-400 transition-colors mt-1.5"
        >
          +{matches.length - 3} more
        </button>
      )}
    </div>
  );
}
