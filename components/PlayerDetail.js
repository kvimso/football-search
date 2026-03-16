"use client";
import { useState } from "react";
import Link from "next/link";

const CONTRACT_LABELS = {
  free_agent: "Free Agent",
  under_contract: "Under Contract",
  loan: "On Loan",
  expiring: "Expiring",
};

const MATCH_SCORE_CONFIG = {
  strong: { label: "Strong", classes: "bg-green-500/20 text-green-400 border-green-500/30" },
  moderate: { label: "Moderate", classes: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  weak: { label: "Weak", classes: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

function getScoreConfig(score) {
  if (score >= 80) return MATCH_SCORE_CONFIG.strong;
  if (score >= 50) return MATCH_SCORE_CONFIG.moderate;
  return MATCH_SCORE_CONFIG.weak;
}

const URGENCY_CONFIG = {
  3: { label: "CRITICAL", classes: "bg-red-500/20 text-red-400" },
  2: { label: "MEDIUM", classes: "bg-amber-500/20 text-amber-400" },
  1: { label: "LOW", classes: "bg-blue-500/20 text-blue-400" },
};

export default function PlayerDetail({ player, matches }) {
  const [showAllMatches, setShowAllMatches] = useState(false);
  const displayMatches = showAllMatches ? matches : matches.slice(0, 6);

  const initials = player.name
    .split(" ")
    .filter(w => w.length > 0)
    .slice(0, 2)
    .map(w => w[0])
    .join("")
    .toUpperCase();

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      {/* Back link */}
      <Link href="/players" className="text-sm text-gray-400 hover:text-gray-300 transition-colors mb-4 inline-block">
        &larr; Back to roster
      </Link>

      {/* Profile Header */}
      <div className="bg-scout-card border border-scout-border rounded-lg p-6 mb-6">
        <div className="flex items-start gap-4">
          {player.photo_url ? (
            <img src={player.photo_url} alt={player.name} className="w-16 h-16 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-scout-accent/20 flex items-center justify-center text-scout-accent font-bold text-xl shrink-0">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-100">{player.name}</h1>
            <p className="text-gray-400 mt-1">
              {player.primary_position}
              {player.secondary_position && <span className="text-gray-500"> / {player.secondary_position}</span>}
              {player.age && <span className="text-gray-500 ml-2">Age {player.age}</span>}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {player.nationality && (
                <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">{player.nationality}</span>
              )}
              {player.current_club && (
                <span className="text-xs px-2 py-0.5 rounded bg-gray-600/20 text-gray-300">{player.current_club}</span>
              )}
              {player.contract_status && (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  player.contract_status === "free_agent" || player.contract_status === "expiring"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-gray-600/20 text-gray-400"
                }`}>
                  {CONTRACT_LABELS[player.contract_status] || player.contract_status}
                </span>
              )}
              {player.source === "cantera" && (
                <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">Cantera</span>
              )}
            </div>
          </div>
        </div>

        {/* Scouting Notes */}
        {player.scouting_notes && (
          <div className="mt-4 pt-4 border-t border-scout-border">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Scouting Notes</h3>
            <p className="text-sm text-gray-400">{player.scouting_notes}</p>
          </div>
        )}

        {/* Stats */}
        {player.stats && Object.keys(player.stats).length > 0 && (
          <div className="mt-4 pt-4 border-t border-scout-border">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Stats</h3>
            <div className="flex flex-wrap gap-3">
              {Object.entries(player.stats).map(([key, value]) => (
                <div key={key} className="text-center">
                  <p className="text-lg font-semibold text-gray-200">{value}</p>
                  <p className="text-xs text-gray-500">{key.replace(/_/g, " ")}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Video Links */}
        {player.video_links && player.video_links.length > 0 && (
          <div className="mt-4 pt-4 border-t border-scout-border">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Videos</h3>
            <div className="space-y-1">
              {player.video_links.map((link, i) => (
                <a key={i} href={link} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-scout-accent hover:text-green-400 transition-colors block truncate">
                  {link}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Matching Opportunities */}
      <h2 className="text-lg font-semibold text-gray-100 mb-4">
        Matching Opportunities
        {matches.length > 0 && <span className="text-gray-500 text-sm font-normal ml-2">({matches.length})</span>}
      </h2>

      {matches.length === 0 ? (
        <div className="bg-scout-card border border-scout-border rounded-lg p-8 text-center">
          <p className="text-gray-300 mb-1">No matching opportunities yet</p>
          <p className="text-gray-500 text-sm">Run the matching pipeline to generate suggestions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayMatches.map((match) => {
            const opp = match.opportunities;
            const club = opp.clubs;
            const scoreConfig = getScoreConfig(match.match_score);
            const urgency = URGENCY_CONFIG[opp.urgency] || URGENCY_CONFIG[1];

            return (
              <div key={match.id} className="bg-scout-card border border-scout-border rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-200">{club.name}</p>
                    <p className="text-sm text-gray-400">{club.league} &middot; {club.country}</p>
                    <p className="text-sm text-gray-300 mt-1">{opp.position}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${urgency.classes}`}>
                      {urgency.label}
                    </span>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded text-sm font-bold border ${scoreConfig.classes}`}>
                      {match.match_score}
                    </span>
                  </div>
                </div>
                {match.match_reasoning && (
                  <p className="text-sm text-gray-400 mt-2">{match.match_reasoning}</p>
                )}
              </div>
            );
          })}

          {matches.length > 6 && !showAllMatches && (
            <button onClick={() => setShowAllMatches(true)}
              className="w-full text-sm text-scout-accent hover:text-green-400 transition-colors py-2">
              Show all {matches.length} matches
            </button>
          )}
        </div>
      )}
    </main>
  );
}
