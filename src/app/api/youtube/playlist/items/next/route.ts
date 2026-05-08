import { POST as postItems } from "../start/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return postItems(request);
}
