export const dynamic = "force-dynamic";
const DISPLAY_URL = process.env.DISPLAY_URL ?? "https://sundai.willsarg.com/api/i/jolly-seal/frame";
const ROWS = 17, COLS = 9;
function isChannel(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255; }
function isFrame(value: unknown): value is number[][][] {
  return Array.isArray(value) && value.length === ROWS && value.every((row) => Array.isArray(row) && row.length === COLS && row.every((pixel) => Array.isArray(pixel) && pixel.length === 3 && pixel.every(isChannel)));
}
export async function POST(request: Request) {
  try {
    const frame: unknown = await request.json();
    if (!isFrame(frame)) return Response.json({ error: "Expected 17 rows of 9 RGB pixels" }, { status: 400 });
    const response = await fetch(DISPLAY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(frame) });
    if (!response.ok) return Response.json({ error: "Building display unavailable" }, { status: 502 });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("frame relay failed", error);
    return Response.json({ error: "Could not relay frame" }, { status: 500 });
  }
}
