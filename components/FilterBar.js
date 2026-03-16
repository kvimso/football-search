"use client";

import { useCallback } from "react";

const URGENCY_OPTIONS = [
  { value: 3, label: "CRITICAL" },
  { value: 2, label: "MEDIUM" },
  { value: 1, label: "LOW" },
];

const BUDGET_OPTIONS = [
  { value: "high", label: "HIGH" },
  { value: "mid", label: "MID" },
  { value: "low", label: "LOW" },
];

function FilterGroup({ label, options, selected, onChange }) {
  const toggle = useCallback(
    (value) => {
      if (selected.includes(value)) {
        onChange(selected.filter((v) => v !== value));
      } else {
        onChange([...selected, value]);
      }
    },
    [selected, onChange]
  );

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const isActive = selected.includes(opt.value);
          return (
            <button
              key={String(opt.value)}
              onClick={() => toggle(opt.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                isActive
                  ? "bg-scout-accent/20 text-scout-accent border-scout-accent/40"
                  : "bg-scout-card text-gray-400 border-scout-border hover:border-gray-500"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FilterBar({
  filters,
  setFilters,
  filterOptions,
  totalCount,
  filteredCount,
  hasActiveFilters,
  clearFilters,
}) {
  return (
    <div className="mb-6 p-4 bg-scout-card border border-scout-border rounded-lg">
      <div className="flex flex-wrap gap-4 items-start">
        <FilterGroup
          label="League"
          options={filterOptions.leagues.map((l) => ({ value: l, label: l }))}
          selected={filters.league}
          onChange={(val) => setFilters((prev) => ({ ...prev, league: val }))}
        />
        <FilterGroup
          label="Position"
          options={filterOptions.positions.map((p) => ({ value: p, label: p }))}
          selected={filters.position}
          onChange={(val) => setFilters((prev) => ({ ...prev, position: val }))}
        />
        <FilterGroup
          label="Urgency"
          options={URGENCY_OPTIONS}
          selected={filters.urgency}
          onChange={(val) => setFilters((prev) => ({ ...prev, urgency: val }))}
        />
        <FilterGroup
          label="Budget"
          options={BUDGET_OPTIONS}
          selected={filters.budget}
          onChange={(val) => setFilters((prev) => ({ ...prev, budget: val }))}
        />
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-scout-border">
        <p className="text-sm text-gray-400">
          {hasActiveFilters ? (
            <>
              <span className="text-gray-200 font-medium">{filteredCount}</span> of{" "}
              <span>{totalCount}</span> opportunities
            </>
          ) : (
            <>
              <span className="text-gray-200 font-medium">{totalCount}</span> opportunities
            </>
          )}
        </p>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-scout-accent hover:text-green-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
