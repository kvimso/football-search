"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { POSITIONS } from "../lib/sample-data.js";
import PlayerCard from "./PlayerCard.js";
import AddPlayerModal from "./AddPlayerModal.js";

export default function PlayerRoster({ initialPlayers, fallbackMode }) {
  const [players, setPlayers] = useState(initialPlayers);
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // Load from localStorage in fallback mode
  useEffect(() => {
    if (fallbackMode) {
      try {
        const saved = localStorage.getItem("ffa-scout-players");
        if (saved) {
          const parsed = JSON.parse(saved);
          // Merge: sample players + any user-added players
          const sampleIds = new Set(initialPlayers.map(p => p.id));
          const userAdded = parsed.filter(p => !sampleIds.has(p.id));
          setPlayers([...initialPlayers, ...userAdded]);
        }
      } catch {}
    }
  }, [fallbackMode, initialPlayers]);

  // Persist to localStorage in fallback mode
  useEffect(() => {
    if (fallbackMode) {
      try {
        localStorage.setItem("ffa-scout-players", JSON.stringify(players));
      } catch {}
    }
  }, [players, fallbackMode]);

  const filtered = useMemo(() => {
    let result = players;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(q));
    }
    if (positionFilter) {
      result = result.filter(p =>
        p.primary_position === positionFilter || p.secondary_position === positionFilter
      );
    }
    return result;
  }, [players, search, positionFilter]);

  const handlePlayerAdded = useCallback((player) => {
    setPlayers(prev => [...prev, player]);
  }, []);

  const handlePlayerRemoved = useCallback((playerId) => {
    setPlayers(prev => prev.filter(p => p.id !== playerId));
  }, []);

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Player Roster</h1>
          <p className="text-gray-400 text-sm mt-1">
            {players.length} player{players.length !== 1 ? "s" : ""}
            {fallbackMode && <span className="text-amber-400 ml-2">Demo mode</span>}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 text-sm bg-scout-accent text-scout-bg font-medium rounded hover:bg-green-400 transition-colors"
        >
          + Add Player
        </button>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 bg-scout-card border border-scout-border rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-scout-accent text-sm"
        />
        <select
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
          className="px-3 py-2 bg-scout-card border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent"
        >
          <option value="">All Positions</option>
          {POSITIONS.map(pos => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="bg-scout-card border border-scout-border rounded-lg p-12 text-center">
          <p className="text-gray-300 text-lg mb-2">
            {players.length === 0 ? "No players in your roster yet" : "No players match your search"}
          </p>
          <p className="text-gray-500 text-sm">
            {players.length === 0
              ? "Add your first player to start seeing match suggestions."
              : "Try adjusting your search or filter."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((player, index) => (
            <PlayerCard key={player.id} player={player} index={index} />
          ))}
        </div>
      )}

      {/* Add Player Modal */}
      {showAddModal && (
        <AddPlayerModal
          fallbackMode={fallbackMode}
          onClose={() => setShowAddModal(false)}
          onPlayerAdded={handlePlayerAdded}
        />
      )}
    </main>
  );
}
