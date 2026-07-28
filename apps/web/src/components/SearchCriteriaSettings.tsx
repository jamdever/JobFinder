"use client";

import { JobSearchForm, normalizeJobTitles } from "@/components/JobSearchForm";
import { isSearchConfigured } from "@/lib/search";
import { api } from "@/lib/api";
import type { UserProfile } from "@jobfinder/shared";
import { useEffect, useState } from "react";

export function SearchCriteriaSettings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        const sources = p.search.sources.filter((s) => s !== "remotive" && s !== "remoteok");
        setProfile({
          ...p,
          preferences: {
            ...p.preferences,
            titles: p.preferences.titles.length
              ? normalizeJobTitles(p.preferences.titles)
              : ["Junior Software Developer"],
            maxPostedDays: p.preferences.maxPostedDays ?? 7,
            minMatchScore: Math.max(p.preferences.minMatchScore ?? 0.55, 0.55),
          },
          search: {
            sources: sources.length ? sources : ["indeed", "linkedin"],
            country: p.search.country ?? "Ireland",
            counties: p.search.counties?.length
              ? p.search.counties
              : p.search.county
                ? [p.search.county]
                : [],
            county: p.search.county ?? "",
          },
        });
      })
      .catch(() => setMessage("Could not load profile. Is the API running?"));
  }, []);

  async function save() {
    if (!profile) return;
    if (!isSearchConfigured(profile)) {
      setMessage("Add at least one job title and select a job board.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.updateProfile(profile);
      setProfile(updated);
      setMessage("Search criteria saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return <p className="text-gray-400">{message || "Loading..."}</p>;
  }

  return (
    <div className="space-y-6">
      <JobSearchForm profile={profile} onChange={setProfile} />

      {message && (
        <p
          className={`text-sm ${message.includes("saved") ? "text-emerald-400" : "text-gray-400"}`}
        >
          {message}
        </p>
      )}

      <button className="btn-primary" disabled={saving} onClick={save}>
        {saving ? "Saving..." : "Save search criteria"}
      </button>
    </div>
  );
}
