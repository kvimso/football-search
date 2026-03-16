"use client";

import Image from "next/image";
import { useState } from "react";
import MatchSuggestions from "./MatchSuggestions.js";

const URGENCY_CONFIG = {
  3: { label: "CRITICAL", classes: "bg-red-500/20 text-red-400 border border-red-500/30" },
  2: { label: "MEDIUM", classes: "bg-amber-500/20 text-amber-400 border border-amber-500/30" },
  1: { label: "LOW", classes: "bg-blue-500/20 text-blue-400 border border-blue-500/30" },
};

const BUDGET_CONFIG = {
  high: { label: "HIGH budget", classes: "bg-green-500/20 text-green-400" },
  mid: { label: "MID budget", classes: "bg-amber-500/20 text-amber-400" },
  low: { label: "LOW budget", classes: "bg-blue-500/20 text-blue-400" },
};

function ClubLogo({ name, logoUrl }) {
  const [imgError, setImgError] = useState(false);

  if (!logoUrl || imgError) {
    const initials = name
      .split(" ")
      .filter((w) => w.length > 1)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();

    return (
      <div className="w-10 h-10 rounded-full bg-scout-accent/20 flex items-center justify-center text-scout-accent font-bold text-sm shrink-0">
        {initials}
      </div>
    );
  }

  return (
    <Image
      src={logoUrl}
      alt={`${name} logo`}
      width={40}
      height={40}
      className="rounded-full shrink-0"
      onError={() => setImgError(true)}
    />
  );
}

export default function OpportunityCard({
  opportunity,
  index,
  isExpanded,
  onToggle,
  tags,
  onTagPlayer,
  onRemoveTag,
  showOutdated,
  matches,
  onConfirmMatch,
  onDismissMatch,
  showTagDetails,
}) {
  const club = opportunity.clubs;
  const urgency = URGENCY_CONFIG[opportunity.urgency] || URGENCY_CONFIG[1];
  const budget = BUDGET_CONFIG[opportunity.budget_tier] || BUDGET_CONFIG["mid"];

  return (
    <div
      className="bg-scout-card border border-scout-border rounded-lg p-5 opacity-0 animate-slide-up"
      style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}
    >
      {/* Club Header */}
      <div className="flex items-start gap-3 mb-3">
        <ClubLogo name={club?.name || "?"} logoUrl={club?.logo_url} />
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-100 truncate">{club?.name}</h3>
          <p className="text-sm text-gray-400">
            {club?.league} &middot; {club?.country}
          </p>
        </div>
        {showOutdated && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-gray-600/30 text-gray-400 border border-gray-600/30 shrink-0">
            OUTDATED
          </span>
        )}
      </div>

      {/* Position */}
      <p className="text-gray-200 font-medium mb-2">{opportunity.position}</p>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${urgency.classes}`}>
          {urgency.label}
        </span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${budget.classes}`}>
          {budget.label}
        </span>
      </div>

      {/* Expandable Reasoning */}
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300 transition-colors mb-2 w-full text-left"
      >
        <svg
          className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        AI Reasoning
      </button>

      {isExpanded && (
        <div className="bg-scout-bg/50 border border-scout-border rounded p-3 mb-3 text-sm">
          <p className="text-gray-300">{opportunity.reason}</p>
          {opportunity.ideal_profile && (
            <p className="text-gray-400 mt-2">
              <span className="text-gray-500">Ideal:</span> {opportunity.ideal_profile}
            </p>
          )}
        </div>
      )}

      {/* Tagged Players */}
      {tags.length > 0 && (
        showTagDetails ? (
          <div className="space-y-2 mb-3">
            {tags.map((tag) => {
              const truncatedNotes = tag.notes && tag.notes.length > 100
                ? tag.notes.slice(0, 100) + "..."
                : tag.notes;
              return (
                <div
                  key={tag.id}
                  className="bg-scout-bg/50 border border-scout-border rounded p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-scout-accent">{tag.player_name}</span>
                    <button
                      onClick={() => onRemoveTag(tag.id)}
                      className="text-gray-500 hover:text-red-400 transition-colors text-sm"
                      aria-label={`Remove ${tag.player_name}`}
                    >
                      &times;
                    </button>
                  </div>
                  {tag.notes && (
                    <p
                      className="text-xs text-gray-400 mt-1"
                      title={tag.notes}
                    >
                      {truncatedNotes}
                    </p>
                  )}
                  {tag.tagged_at && (
                    <p className="text-xs text-gray-500 mt-1">
                      Tagged {new Date(tag.tagged_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1 mb-3">
            {tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-scout-accent/10 text-scout-accent"
              >
                {tag.player_name}
                <button
                  onClick={() => onRemoveTag(tag.id)}
                  className="hover:text-red-400 transition-colors ml-0.5"
                  aria-label={`Remove ${tag.player_name}`}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )
      )}

      {/* Tag Player Button */}
      <button
        onClick={onTagPlayer}
        className="text-sm text-scout-accent hover:text-green-400 transition-colors flex items-center gap-1"
      >
        <span className="text-base">+</span> Tag Player
      </button>

      {/* AI Match Suggestions */}
      {matches && matches.length > 0 && (
        <MatchSuggestions
          matches={matches}
          onConfirm={onConfirmMatch}
          onDismiss={onDismissMatch}
        />
      )}
    </div>
  );
}
