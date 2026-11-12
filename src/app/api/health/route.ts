export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok", time: new Date().toISOString() });
}