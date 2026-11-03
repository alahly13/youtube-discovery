import { redirect } from "next/navigation";

export default function OldSearchHistoryRedirect() {
  redirect("/old/saved-search-history");
}
