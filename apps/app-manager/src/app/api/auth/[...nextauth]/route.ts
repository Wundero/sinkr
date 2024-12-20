import { NextRequest } from "next/server";

import { handlers } from "~/server/auth";

function rewriteRequestUrl(req: NextRequest) {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const baseUrl = new URL(process.env.DEPLOYMENT_URL ?? req.url);
  req.nextUrl.port = baseUrl.port;
  req.nextUrl.hostname = baseUrl.hostname;
  req.nextUrl.protocol = baseUrl.protocol;
  const newReq = new NextRequest(req.nextUrl, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    cache: req.cache,
    cf: req.cf,
    credentials: req.credentials,
    redirect: req.redirect,
    fetcher: req.fetcher,
    integrity: req.integrity,
    keepalive: req.keepalive,
    mode: req.mode,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    signal: req.signal,
  });
  return newReq;
}

const { GET: _get, POST: _post } = handlers;

export function GET(req: NextRequest) {
  return _get(rewriteRequestUrl(req));
}

export function POST(req: NextRequest) {
  return _post(rewriteRequestUrl(req));
}
