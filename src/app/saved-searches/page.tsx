import { redirect } from "next/navigation";

/**
 * Legacy route redirect: `/saved-searches` now lives on `/saved-titles-links#saved-searches`
 * in its own separated workspace section beneath Saved Titles & Links.
 */
export default function SavedSearchesRedirectPage() {
  redirect("/saved-titles-links#saved-searches");
}
