"use client";
import Link from "next/link";

const CONTRACT_LABELS = {
  free_agent: "Free Agent",
  under_contract: "Under Contract",
  loan: "On Loan",
  expiring: "Expiring",
};

const SOURCE_LABELS = {
  manual: null, // Don't show badge for manual
  cantera: "Cantera",
  csv_import: "Imported",
};

export default function PlayerCard({ player, index }) {
  const initials = player.name
    .split(" ")
    .filter(w => w.length > 0)
    .slice(0, 2)
    .map(w => w[0])
    .join("")
    .toUpperCase();

  const content = (
    <div
      className="bg-scout-card border border-scout-border rounded-lg p-5 hover:border-scout-accent/40 transition-colors opacity-0 animate-slide-up"
      style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {player.photo_url ? (
          <img src={player.photo_url} alt={player.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-scout-accent/20 flex items-center justify-center text-scout-accent font-bold text-sm shrink-0">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-100 truncate">{player.name}</h3>
          <p className="text-sm text-gray-400">
            {player.primary_position}
            {player.secondary_position && <span className="text-gray-500"> / {player.secondary_position}</span>}
          </p>
        </div>
        {player.age && (
          <span className="ml-auto text-sm text-gray-500 shrink-0">Age {player.age}</span>
        )}
      </div>

      {/* Details */}
      <div className="space-y-1 text-sm">
        {player.current_club && (
          <p className="text-gray-300">{player.current_club}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {player.contract_status && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              player.contract_status === "free_agent" || player.contract_status === "expiring"
                ? "bg-green-500/20 text-green-400"
                : "bg-gray-600/20 text-gray-400"
            }`}>
              {CONTRACT_LABELS[player.contract_status] || player.contract_status}
            </span>
          )}
          {player.nationality && player.nationality !== "Georgia" && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
              {player.nationality}
            </span>
          )}
          {SOURCE_LABELS[player.source] && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
              {SOURCE_LABELS[player.source]}
            </span>
          )}
        </div>
      </div>

      {/* Scouting Notes Preview */}
      {player.scouting_notes && (
        <p className="text-xs text-gray-500 mt-3 line-clamp-2">{player.scouting_notes}</p>
      )}
    </div>
  );

  // In Supabase mode, cards link to detail page. In fallback, they don't (no dynamic routes for sample IDs).
  if (player.id?.startsWith("sample-")) {
    return content;
  }

  return <Link href={`/players/${player.id}`}>{content}</Link>;
}
