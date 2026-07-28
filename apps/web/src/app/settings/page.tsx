"use client";

import { SearchCriteriaSettings } from "@/components/SearchCriteriaSettings";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>
      <SearchCriteriaSettings />
    </div>
  );
}
