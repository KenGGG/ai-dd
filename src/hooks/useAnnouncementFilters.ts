import { useState } from "react";
import { LOCAL_STORAGE_ANNOUNCEMENT_FILTERS_KEY } from "../constants/storage-keys";

const DEFAULT_ANNOUNCEMENT_FILTERS = ["开会通知", "会议通知"];

export function useAnnouncementFilters() {
  const [announcementFilterInput, setAnnouncementFilterInput] = useState(() => {
    const stored = localStorage.getItem(LOCAL_STORAGE_ANNOUNCEMENT_FILTERS_KEY);
    if (stored) return stored;
    const initial = DEFAULT_ANNOUNCEMENT_FILTERS.join("\n");
    localStorage.setItem(LOCAL_STORAGE_ANNOUNCEMENT_FILTERS_KEY, initial);
    return initial;
  });

  const announcementFilterTerms = announcementFilterInput
    .split(/\r?\n|,|，/)
    .map((term) => term.trim())
    .filter(Boolean);

  const handleAnnouncementFilterChange = (value: string) => {
    setAnnouncementFilterInput(value);
    localStorage.setItem(LOCAL_STORAGE_ANNOUNCEMENT_FILTERS_KEY, value);
  };

  const handleResetAnnouncementFilters = () => {
    const initial = DEFAULT_ANNOUNCEMENT_FILTERS.join("\n");
    setAnnouncementFilterInput(initial);
    localStorage.setItem(LOCAL_STORAGE_ANNOUNCEMENT_FILTERS_KEY, initial);
  };

  return {
    announcementFilterInput,
    announcementFilterTerms,
    handleAnnouncementFilterChange,
    handleResetAnnouncementFilters,
  };
}
