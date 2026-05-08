import { POST as postFilter } from "../filter/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ manifestId: string }> }) {
  return postFilter(request, context);
}
