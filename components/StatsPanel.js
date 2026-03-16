"use client";

export default function StatsPanel({ opportunities, tags }) {
  const totalOpportunities = opportunities.length;
  const criticalCount = opportunities.filter((op) => op.urgency === 3).length;
  const playersTagged = new Set(tags.map((t) => t.player_name)).size;
  const clubsAnalyzed = new Set(
    opportunities.map((op) => op.clubs?.name).filter(Boolean)
  ).size;

  const stats = [
    { label: "Opportunities", value: totalOpportunities },
    { label: "Critical", value: criticalCount },
    { label: "Players Tagged", value: playersTagged },
    { label: "Clubs", value: clubsAnalyzed },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-scout-card border border-scout-border rounded-lg p-4 text-center"
        >
          <p className="text-2xl font-bold text-gray-100">{stat.value}</p>
          <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
        </div>
      ))}
    </div>
  );
}
