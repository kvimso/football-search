"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import FilterBar from "./FilterBar.js";
import OpportunityCard from "./OpportunityCard.js";
import TagPlayerModal from "./TagPlayerModal.js";
import EmptyState from "./EmptyState.js";
import StatsPanel from "./StatsPanel.js";

function formatRelativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const SORT_COMPARATOR = (a, b) => {
  if (b.urgency !== a.urgency) return b.urgency - a.urgency;
  const leagueA = a.clubs?.league || "";
  const leagueB = b.clubs?.league || "";
  return leagueA.localeCompare(leagueB);
};

export default function Dashboard({ opportunities, initialTags, fallbackMode, initialMatches = [], initialPlayers = [] }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("opportunities");
  const [filters, setFilters] = useState({ league: [], position: [], urgency: [], budget: [] });
  const [expandedCards, setExpandedCards] = useState(new Set());
  const [tags, setTags] = useState(initialTags);
  const [matches, setMatches] = useState(initialMatches);
  const [rosterPlayers, setRosterPlayers] = useState(initialPlayers);
  const [modalOpportunityId, setModalOpportunityId] = useState(null);
  const [refreshState, setRefreshState] = useState("idle");
  const [refreshError, setRefreshError] = useState(null);

  // Load tags from localStorage in fallback mode
  useEffect(() => {
    if (fallbackMode) {
      try {
        const saved = localStorage.getItem("ffa-scout-tags");
        if (saved) setTags(JSON.parse(saved));
      } catch {}
      // Load roster players for the tag modal
      try {
        const savedPlayers = localStorage.getItem("ffa-scout-players");
        if (savedPlayers) setRosterPlayers(JSON.parse(savedPlayers));
      } catch {}
    }
  }, [fallbackMode]);

  // Load saved filters from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ffa-scout-filters");
      if (saved) setFilters(JSON.parse(saved));
    } catch {}
  }, []);

  // Persist filters to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("ffa-scout-filters", JSON.stringify(filters));
    } catch {}
  }, [filters]);

  // Persist tags in fallback mode
  useEffect(() => {
    if (fallbackMode) {
      try {
        localStorage.setItem("ffa-scout-tags", JSON.stringify(tags));
      } catch {}
    }
  }, [tags, fallbackMode]);

  const toggleCard = useCallback((id) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddTag = useCallback((tag) => {
    setTags((prev) => [...prev, tag]);
  }, []);

  const handleConfirmMatch = useCallback(async (match) => {
    const playerName = match.players?.name || match.player_name || "Unknown";
    // Optimistically add tag
    const newTag = {
      id: `match-tag-${Date.now()}`,
      opportunity_id: match.opportunity_id || match.opportunities?.id,
      player_name: playerName,
      player_id: match.player_id || match.players?.id,
      notes: `AI match score: ${match.match_score}/100`,
      tagged_at: new Date().toISOString(),
    };
    setTags((prev) => [...prev, newTag]);
    // Remove from matches
    setMatches((prev) => prev.filter((m) => m.id !== match.id));

    if (!fallbackMode) {
      try {
        await fetch("/api/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_id: match.id, action: "confirm" }),
        });
      } catch (err) {
        console.error("Failed to confirm match:", err);
      }
    }
  }, [fallbackMode]);

  const handleDismissMatch = useCallback(async (match) => {
    setMatches((prev) => prev.filter((m) => m.id !== match.id));

    if (!fallbackMode) {
      try {
        await fetch("/api/matches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_id: match.id, action: "dismiss" }),
        });
      } catch (err) {
        console.error("Failed to dismiss match:", err);
      }
    }
  }, [fallbackMode]);

  const handleRemoveTag = useCallback(async (tagId) => {
    setTags((prev) => prev.filter((t) => t.id !== tagId));

    if (!fallbackMode) {
      try {
        const res = await fetch(`/api/tags?id=${tagId}`, { method: "DELETE" });
        if (!res.ok) {
          // Rollback on failure — re-fetch would be better but this is MVP
          console.error("Failed to delete tag");
        }
      } catch (err) {
        console.error("Failed to delete tag:", err);
      }
    }
  }, [fallbackMode]);

  const handleRefresh = useCallback(async () => {
    setRefreshState("analyzing");
    setRefreshError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      router.refresh();
      setRefreshState("idle");
    } catch (err) {
      setRefreshError(err.message);
      setRefreshState("error");
    }
  }, [router]);

  // Filter opportunities
  const filtered = useMemo(() => {
    let result = opportunities;

    if (activeTab === "pipeline") {
      const taggedIds = new Set(tags.map((t) => t.opportunity_id));
      result = opportunities.filter((op) => taggedIds.has(op.id));
    }

    if (filters.league.length > 0) {
      result = result.filter((op) => filters.league.includes(op.clubs?.league));
    }
    if (filters.position.length > 0) {
      result = result.filter((op) => filters.position.includes(op.position));
    }
    if (filters.urgency.length > 0) {
      result = result.filter((op) => filters.urgency.includes(op.urgency));
    }
    if (filters.budget.length > 0) {
      result = result.filter((op) => filters.budget.includes(op.budget_tier));
    }

    if (activeTab === "pipeline") {
      const taggedAtMap = new Map();
      for (const tag of tags) {
        const current = taggedAtMap.get(tag.opportunity_id);
        if (!current || tag.tagged_at > current) {
          taggedAtMap.set(tag.opportunity_id, tag.tagged_at);
        }
      }
      return [...result].sort((a, b) => {
        const dateA = taggedAtMap.get(a.id) || "";
        const dateB = taggedAtMap.get(b.id) || "";
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return SORT_COMPARATOR(a, b);
      });
    }

    return [...result].sort(SORT_COMPARATOR);
  }, [opportunities, filters, activeTab, tags]);

  // Data freshness
  const lastAnalyzed = useMemo(() => {
    if (opportunities.length === 0) return null;
    const dates = opportunities
      .map((op) => op.analyzed_at)
      .filter(Boolean)
      .map((d) => new Date(d));
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [opportunities]);

  const isStale = lastAnalyzed && (Date.now() - lastAnalyzed.getTime()) > 9 * 24 * 60 * 60 * 1000;

  // Extract unique filter options from data
  const filterOptions = useMemo(() => {
    const leagues = [...new Set(opportunities.map((op) => op.clubs?.league).filter(Boolean))].sort();
    const positions = [...new Set(opportunities.map((op) => op.position).filter(Boolean))].sort();
    return { leagues, positions };
  }, [opportunities]);

  const hasActiveFilters = filters.league.length > 0 || filters.position.length > 0 ||
    filters.urgency.length > 0 || filters.budget.length > 0;

  const clearFilters = useCallback(() => {
    setFilters({ league: [], position: [], urgency: [], budget: [] });
  }, []);

  const modalOpportunity = modalOpportunityId
    ? opportunities.find((op) => op.id === modalOpportunityId)
    : null;

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">Opportunities</h1>
            <p className="text-gray-400 text-sm mt-1">Transfer opportunity radar</p>
            <div className="flex gap-2 mt-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                fallbackMode
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "bg-green-500/20 text-green-400 border border-green-500/30"
              }`}>
                {fallbackMode ? "Sample Data" : "Live Data"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              {lastAnalyzed && (
                <p className="text-gray-400">
                  Last analyzed:{" "}
                  <span
                    className={isStale ? "text-amber-400" : "text-gray-300"}
                    title={lastAnalyzed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  >
                    {formatRelativeTime(lastAnalyzed)}
                  </span>
                  {isStale && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      STALE
                    </span>
                  )}
                </p>
              )}
            </div>
            {!fallbackMode && (
              <button
                onClick={handleRefresh}
                disabled={refreshState === "analyzing"}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  refreshState === "analyzing"
                    ? "bg-scout-accent/10 text-gray-400 cursor-wait"
                    : "bg-scout-accent/20 text-scout-accent hover:bg-scout-accent/30"
                }`}
              >
                {refreshState === "analyzing" ? "Analyzing..." : "Refresh Data"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {refreshError && (
        <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
          <span className="text-red-400 text-sm">{refreshError}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => { setRefreshError(null); setRefreshState("idle"); }}
              className="text-gray-500 hover:text-gray-400 transition-colors"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex gap-1 mb-4 border-b border-scout-border">
        <button
          onClick={() => setActiveTab("opportunities")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "opportunities"
              ? "border-scout-accent text-scout-accent"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          All Opportunities
          <span className="ml-2 text-xs text-gray-500">({opportunities.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("pipeline")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "pipeline"
              ? "border-scout-accent text-scout-accent"
              : "border-transparent text-gray-400 hover:text-gray-300"
          }`}
        >
          My Pipeline
          <span className="ml-2 text-xs text-gray-500">
            ({new Set(tags.map((t) => t.opportunity_id)).size})
          </span>
        </button>
      </div>

      {/* Stats Panel */}
      <StatsPanel opportunities={opportunities} tags={tags} />

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        filterOptions={filterOptions}
        totalCount={activeTab === "pipeline"
          ? opportunities.filter((op) => tags.some((t) => t.opportunity_id === op.id)).length
          : opportunities.length}
        filteredCount={filtered.length}
        hasActiveFilters={hasActiveFilters}
        clearFilters={clearFilters}
      />

      {/* Skeleton Loader */}
      {refreshState === "analyzing" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-scout-card border border-scout-border rounded-lg p-5 animate-pulse"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-scout-border" />
                <div className="flex-1">
                  <div className="h-4 bg-scout-border rounded w-3/4 mb-2" />
                  <div className="h-3 bg-scout-border rounded w-1/2" />
                </div>
              </div>
              <div className="h-4 bg-scout-border rounded w-1/3 mb-3" />
              <div className="flex gap-2 mb-3">
                <div className="h-5 bg-scout-border rounded w-16" />
                <div className="h-5 bg-scout-border rounded w-20" />
              </div>
              <div className="h-3 bg-scout-border rounded w-full mb-2" />
              <div className="h-3 bg-scout-border rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      {filtered.length === 0 ? (
        <EmptyState
          type={
            opportunities.length === 0
              ? (fallbackMode ? "no-data" : "welcome")
              : activeTab === "pipeline" && tags.length === 0
              ? "no-tags"
              : "no-matches"
          }
          clearFilters={hasActiveFilters ? clearFilters : null}
          onRefresh={!fallbackMode && opportunities.length === 0 ? handleRefresh : null}
          refreshState={refreshState}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((op, index) => (
            <OpportunityCard
              key={op.id}
              opportunity={op}
              index={index}
              isExpanded={expandedCards.has(op.id)}
              onToggle={() => toggleCard(op.id)}
              tags={tags.filter((t) => t.opportunity_id === op.id)}
              onTagPlayer={() => setModalOpportunityId(op.id)}
              onRemoveTag={handleRemoveTag}
              showTagDetails={activeTab === "pipeline"}
              showOutdated={activeTab === "pipeline" && !op.is_active}
              matches={matches.filter((m) => (m.opportunity_id || m.opportunities?.id) === op.id)}
              onConfirmMatch={handleConfirmMatch}
              onDismissMatch={handleDismissMatch}
            />
          ))}
        </div>
      )}

      {/* Tag Player Modal */}
      {modalOpportunity && (
        <TagPlayerModal
          opportunity={modalOpportunity}
          existingTags={tags.filter((t) => t.opportunity_id === modalOpportunity.id)}
          fallbackMode={fallbackMode}
          onClose={() => setModalOpportunityId(null)}
          onTagAdded={handleAddTag}
          rosterPlayers={rosterPlayers}
        />
      )}
    </main>
  );
}
