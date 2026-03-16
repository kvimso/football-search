"use client";
import { useState, useEffect, useRef } from "react";
import { POSITIONS } from "../lib/sample-data.js";

export default function AddPlayerModal({ fallbackMode, onClose, onPlayerAdded, editPlayer }) {
  const isEdit = !!editPlayer;
  const [form, setForm] = useState({
    name: editPlayer?.name || "",
    age: editPlayer?.age || "",
    primary_position: editPlayer?.primary_position || "",
    secondary_position: editPlayer?.secondary_position || "",
    nationality: editPlayer?.nationality || "Georgia",
    current_club: editPlayer?.current_club || "",
    contract_status: editPlayer?.contract_status || "",
    scouting_notes: editPlayer?.scouting_notes || "",
    video_links: editPlayer?.video_links?.join("\n") || "",
    photo_url: editPlayer?.photo_url || "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const updateField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.primary_position) return;

    setSubmitting(true);
    setError(null);

    const playerData = {
      name: form.name.trim(),
      age: form.age ? parseInt(form.age) : null,
      primary_position: form.primary_position,
      secondary_position: form.secondary_position || null,
      nationality: form.nationality.trim() || "Georgia",
      current_club: form.current_club.trim() || null,
      contract_status: form.contract_status || null,
      scouting_notes: form.scouting_notes.trim() || null,
      video_links: form.video_links.trim() ? form.video_links.trim().split("\n").map(l => l.trim()).filter(Boolean) : [],
      photo_url: form.photo_url.trim() || null,
    };

    if (fallbackMode) {
      const player = {
        ...playerData,
        id: editPlayer?.id || `player-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        stats: editPlayer?.stats || {},
        source: editPlayer?.source || "manual",
        cantera_id: editPlayer?.cantera_id || null,
        cantera_active: true,
        is_active: true,
        created_at: editPlayer?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      onPlayerAdded(player);
      onClose();
      return;
    }

    try {
      const url = isEdit ? `/api/players/${editPlayer.id}` : "/api/players";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(playerData),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save player");
        setSubmitting(false);
        return;
      }

      const player = await res.json();
      onPlayerAdded(player);
      onClose();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-scout-card border border-scout-border rounded-lg w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-100">{isEdit ? "Edit Player" : "Add Player"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="player-name" className="block text-sm text-gray-300 mb-1">
              Name <span className="text-red-400">*</span>
            </label>
            <input ref={inputRef} id="player-name" type="text" value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="e.g. Giorgi Kochorashvili"
              className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-scout-accent text-sm"
              required />
          </div>

          {/* Position + Age row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="primary-pos" className="block text-sm text-gray-300 mb-1">
                Primary Position <span className="text-red-400">*</span>
              </label>
              <select id="primary-pos" value={form.primary_position}
                onChange={(e) => updateField("primary_position", e.target.value)}
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent"
                required>
                <option value="">Select...</option>
                {POSITIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="age" className="block text-sm text-gray-300 mb-1">Age</label>
              <input id="age" type="number" min="15" max="45" value={form.age}
                onChange={(e) => updateField("age", e.target.value)}
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent" />
            </div>
          </div>

          {/* Secondary Position + Nationality */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="secondary-pos" className="block text-sm text-gray-300 mb-1">Secondary Position</label>
              <select id="secondary-pos" value={form.secondary_position}
                onChange={(e) => updateField("secondary_position", e.target.value)}
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent">
                <option value="">None</option>
                {POSITIONS.filter(p => p !== form.primary_position).map(pos => (
                  <option key={pos} value={pos}>{pos}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="nationality" className="block text-sm text-gray-300 mb-1">Nationality</label>
              <input id="nationality" type="text" value={form.nationality}
                onChange={(e) => updateField("nationality", e.target.value)}
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent" />
            </div>
          </div>

          {/* Club + Contract */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="club" className="block text-sm text-gray-300 mb-1">Current Club</label>
              <input id="club" type="text" value={form.current_club}
                onChange={(e) => updateField("current_club", e.target.value)}
                placeholder="e.g. Levante UD"
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-scout-accent" />
            </div>
            <div>
              <label htmlFor="contract" className="block text-sm text-gray-300 mb-1">Contract Status</label>
              <select id="contract" value={form.contract_status}
                onChange={(e) => updateField("contract_status", e.target.value)}
                className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 text-sm focus:outline-none focus:border-scout-accent">
                <option value="">Unknown</option>
                <option value="under_contract">Under Contract</option>
                <option value="free_agent">Free Agent</option>
                <option value="loan">On Loan</option>
                <option value="expiring">Expiring</option>
              </select>
            </div>
          </div>

          {/* Scouting Notes */}
          <div>
            <label htmlFor="notes" className="block text-sm text-gray-300 mb-1">Scouting Notes</label>
            <textarea id="notes" value={form.scouting_notes}
              onChange={(e) => updateField("scouting_notes", e.target.value)}
              placeholder="Strengths, weaknesses, playing style..."
              rows={3}
              className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-scout-accent resize-none" />
          </div>

          {/* Video Links */}
          <div>
            <label htmlFor="videos" className="block text-sm text-gray-300 mb-1">Video Links (one per line)</label>
            <textarea id="videos" value={form.video_links}
              onChange={(e) => updateField("video_links", e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              rows={2}
              className="w-full px-3 py-2 bg-scout-bg border border-scout-border rounded text-gray-200 placeholder-gray-500 text-sm focus:outline-none focus:border-scout-accent resize-none" />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
            <button type="submit" disabled={submitting || !form.name.trim() || !form.primary_position}
              className="px-4 py-2 text-sm bg-scout-accent text-scout-bg font-medium rounded hover:bg-green-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {submitting && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {isEdit ? "Save Changes" : "Add Player"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
