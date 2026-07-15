import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import {
  buildLiveStreamPayload,
  createInitialLiveStreamState,
  reduceLiveStreamAction
} from "./session-state.js";
import { publicStreamCatalog } from "./stream-catalog.js";

export function createLiveStreamApp(options = {}) {
  const sessionSecret = String(options.sessionSecret || "");
  const liveStreamEnabled = options.liveStreamEnabled === true;
  const allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [];
  const users = Array.isArray(options.users) ? options.users : [];
  const streamCatalog = Array.isArray(options.streamCatalog) ? options.streamCatalog : [];

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required.");
  }

  const app = express();
  let liveStreamState = createInitialLiveStreamState();

  app.use(express.json({ limit: "32kb" }));
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.set("Pragma", "no-cache");
    response.set("Expires", "0");
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      if (!allowedOrigins.length || !origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      const corsError = new Error("Origin not allowed by CORS.");
      corsError.status = 403;
      callback(corsError);
    }
  }));

  app.get("/healthz", (_request, response) => {
    response.json({
      ok: true,
      liveStreamEnabled,
      users: users.length
    });
  });

  app.get("/api/live/session", requireAuth, (_request, response) => {
    response.json(buildLiveStreamPayload({
      enabled: liveStreamEnabled,
      state: liveStreamState
    }));
  });

  app.get("/api/streams", requireAuth, (_request, response) => {
    response.json({
      streams: publicStreamCatalog(streamCatalog)
    });
  });

  app.post("/api/live/session", requireAuth, (request, response) => {
    if (!liveStreamEnabled) {
      response.status(503).json({
        enabled: false,
        error: "Live stream service is not enabled."
      });
      return;
    }

    const result = reduceLiveStreamAction(liveStreamState, {
      action: request.body?.action,
      title: request.body?.title,
      streamUrl: request.body?.streamUrl,
      username: request.user.username,
      now: new Date().toISOString(),
      sessionId: crypto.randomUUID()
    });

    if (!result.ok) {
      response.status(result.statusCode).json({ error: result.error });
      return;
    }

    liveStreamState = result.state;
    response.status(result.statusCode).json(buildLiveStreamPayload({
      enabled: liveStreamEnabled,
      state: liveStreamState
    }));
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(error.status || 500).json({
      error: error.message || "Unexpected server error."
    });
  });

  return app;

  function requireAuth(request, response, next) {
    const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    try {
      const payload = verifySessionToken(token, sessionSecret);
      const username = String(payload.username || "").trim().toLowerCase();
      if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) {
        throw new Error("Session expired.");
      }

      if (!username) {
        response.status(401).json({ error: "Session user is missing." });
        return;
      }

      const allowedUser = users.find((user) => user.username === username);
      if (users.length && !allowedUser) {
        response.status(401).json({ error: "User is no longer authorized." });
        return;
      }

      request.user = {
        ...payload,
        username,
        isAdmin: users.length ? allowedUser?.isAdmin === true : payload.isAdmin === true
      };
      next();
    } catch (error) {
      response.status(401).json({ error: error.message || "Invalid session." });
    }
  }
}

export function createSessionToken(payload, sessionSecret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signValue(encodedPayload, sessionSecret);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token, sessionSecret) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid session token.");
  }

  const expectedSignature = signValue(encodedPayload, sessionSecret);
  if (signature.length !== expectedSignature.length) {
    throw new Error("Invalid token signature.");
  }

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    throw new Error("Invalid token signature.");
  }

  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
}

function signValue(value, sessionSecret) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}
