import { POST as postSearch } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return postSearch(request);
}
