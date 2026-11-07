export class NextResponse extends Response {
  static json(body: unknown, init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json; charset=utf-8");
    }
    return new NextResponse(JSON.stringify(body), {
      ...init,
      headers,
    });
  }

  static redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    const headers = new Headers(typeof init === "object" ? init?.headers : undefined);
    headers.set("Location", String(url));
    return new NextResponse(null, {
      ...(typeof init === "object" ? init : {}),
      status,
      headers,
    });
  }
}
