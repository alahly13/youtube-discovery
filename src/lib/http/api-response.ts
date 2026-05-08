import { ZodError } from "zod";

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function validationError(error: ZodError) {
  return Response.json(
    {
      error: "validation_error",
      message: "The request payload did not match the expected contract.",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400 },
  );
}

export function notFound(message: string) {
  return Response.json(
    {
      error: "not_found",
      message,
    },
    { status: 404 },
  );
}
