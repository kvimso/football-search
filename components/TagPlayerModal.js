"use client";

import { useState, useEffect, useRef } from "react";

export default function TagPlayerModal({
  opportunity,
  existingTags,
  fallbackMode,
  onClose,
  onTagAdded,
  rosterPlayers = [],
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedName = playerName.trim();
    if (!trimmedName) return;

    // Duplicate check
    if (existingTags.some((t) => t.player_name.toLowerCase() === trimmedName.toLowerCase())) {
      setError("This player is already tagged to this opportunity");
      return;
    }

    setSubmitting(true);
    setError(null);

    if (fallbackMode) {
      // localStorage mode
      const tag = {
        id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        opportunity_id: opportunity.id,
        player_name: trimmedName,
        player_id: selectedPlayerId || null,
        notes: notes.trim() || null,
        tagged_at: new Date().toISOString(),
      };
      onTagAdded(tag);
      onClose();
      return;
    }

    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity_id: opportunity.id,
          player_name: trimmedName,
          player_id: selectedPlayerId || null,
          notes: notes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to tag player");
        setSubmitting(false);
        return;
      }

      const tag = await res.json();
      onTagAdded(tag);
      onClose();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  const club = opportunity.clubs;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-scout-card border border-scout-border rounded-lg w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">Tag Player</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          {club?.name} &middot; {opportunity.position}
        </p>

        <form onSubmit={handleSubmit}>
          {/* Roster Player Picker */}
          {rosterPlayers.length > 0 && (
            <div className="mb-4">
              <label htmlFor="roster-player" className="block text-sm text-gray-300 mb-1">
                Select from Roster
              </label>
              <select
                id="roster-player"
                value={selectedPlayerId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedPlayerId(id);
                  if (id) {
                    const p = rosterPlayers.find((r) => r.id === id);
                    if (p) setPlayerName(p.name);
                  }
                }}
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent"
              >
                <option value="">— Choose a player —</option>
                {rosterPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.primary_position}{p.age ? `, ${p.age}` : ""}
                  </option>
                ))}
              </select>
              {!selectedPlayerId && (
                <p className="text-xs text-gray-500 mt-1">Or enter a name manually below</p>
              )}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="player-name" className="block text-sm text-gray-300 mb-1">
              Player Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={inputRef}
              id="player-name"
              type="text"
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                if (selectedPlayerId) setSelectedPlayerId("");
              }}
              placeholder="e.g. Giorgi Kochorashvili"
              className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-scout-accent text-sm"
              required
            />
          </div>

          <div className="mb-4">
            <label htmlFor="notes" className="block text-sm text-gray-300 mb-1">
              Notes
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this player a good fit?"
              rows={3}
              className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-scout-accent text-sm resize-none"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 mb-3">{error}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !playerName.trim()}
              className="px-4 py-2 text-sm bg-scout-accent text-scout-bg font-medium rounded hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Tag Player
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
