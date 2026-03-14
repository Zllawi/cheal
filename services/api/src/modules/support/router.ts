import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/jwt.js";
import { asyncHandler } from "../../utils/async-handler.js";
import { HttpError } from "../../utils/http-error.js";
import { SupportMessageModel, SupportThreadModel, UserModel } from "../../db/models.js";

const router = Router();

const createThreadSchema = z.object({
  subject: z.string().max(120).optional(),
  message: z.string().min(1).max(2000)
});

const sendMessageSchema = z.object({
  body: z.string().min(1).max(2000)
});

const adminThreadQuerySchema = z.object({
  read: z.enum(["all", "read", "unread"]).default("all"),
  q: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0)
});

function threadToDto(thread: any) {
  return {
    id: thread._id,
    user: {
      id: thread.userId,
      fullName: thread.userFullName,
      phoneE164: thread.userPhoneE164 ?? null
    },
    subject: thread.subject ?? null,
    status: thread.status,
    unreadForAdmin: thread.unreadForAdmin ?? 0,
    unreadForUser: thread.unreadForUser ?? 0,
    lastMessageAt: thread.lastMessageAt ?? null,
    lastMessagePreview: thread.lastMessagePreview ?? null,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  };
}

function messageToDto(message: any) {
  return {
    id: message._id,
    threadId: message.threadId,
    senderId: message.senderId,
    senderRole: message.senderRole,
    body: message.body,
    readByAdmin: Boolean(message.readByAdmin),
    readByUser: Boolean(message.readByUser),
    createdAt: message.createdAt
  };
}

function ensureCanAccessThread(actor: { id: string; role: string }, thread: any): void {
  if (actor.role === "admin") {
    return;
  }
  if (thread.userId !== actor.id) {
    throw new HttpError(403, "Forbidden");
  }
}

router.post(
  "/threads",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const body = createThreadSchema.parse(req.body);
    const user = (await UserModel.findById(actor.id).lean()) as any;
    if (!user) {
      throw new HttpError(401, "Unauthorized");
    }

    let thread = (await SupportThreadModel.findOne({
      userId: actor.id,
      status: "open"
    })
      .sort({ updatedAt: -1 })
      .lean()) as any;

    if (!thread) {
      const createdThread = await SupportThreadModel.create({
        userId: actor.id,
        userFullName: user.fullName ?? "User",
        userPhoneE164: user.phoneE164 ?? null,
        subject: body.subject ?? null,
        status: "open",
        unreadForAdmin: 0,
        unreadForUser: 0,
        lastMessageAt: new Date(),
        lastMessagePreview: body.message.slice(0, 300)
      });
      thread = createdThread.toObject();
    }

    const isAdminSender = actor.role === "admin";
    const message = await SupportMessageModel.create({
      threadId: thread._id,
      senderId: actor.id,
      senderRole: actor.role,
      body: body.message.trim(),
      readByAdmin: isAdminSender,
      readByUser: !isAdminSender
    });

    const threadSet: Record<string, unknown> = {
      ...(body.subject && !thread.subject ? { subject: body.subject } : {}),
      lastMessageAt: new Date(),
      lastMessagePreview: body.message.slice(0, 300),
      ...(isAdminSender ? { unreadForAdmin: 0 } : { unreadForUser: 0 })
    };

    await SupportThreadModel.updateOne(
      { _id: thread._id },
      {
        $set: threadSet,
        $inc: isAdminSender ? { unreadForUser: 1 } : { unreadForAdmin: 1 }
      }
    );

    const updatedThread = (await SupportThreadModel.findById(thread._id).lean()) as any;

    res.status(201).json({
      thread: threadToDto(updatedThread),
      message: messageToDto(message.toObject())
    });
  })
);

router.get(
  "/threads/my",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    if (actor.role === "admin") {
      res.json({ items: [] });
      return;
    }

    const threads = (await SupportThreadModel.find({ userId: actor.id })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()) as any[];

    res.json({
      items: threads.map(threadToDto)
    });
  })
);

router.get(
  "/admin/threads",
  requireAuth(["admin"]),
  asyncHandler(async (req, res) => {
    const query = adminThreadQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (query.read === "unread") {
      filter.unreadForAdmin = { $gt: 0 };
    } else if (query.read === "read") {
      filter.unreadForAdmin = 0;
    }

    if (query.q?.trim()) {
      const regex = new RegExp(query.q.trim(), "i");
      filter.$or = [{ userFullName: regex }, { userPhoneE164: regex }, { subject: regex }];
    }

    const threads = (await SupportThreadModel.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .lean()) as any[];

    res.json({
      items: threads.map(threadToDto),
      count: threads.length
    });
  })
);

router.get(
  "/threads/:id/messages",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const threadId = z.string().min(8).parse(req.params.id);
    const thread = (await SupportThreadModel.findById(threadId).lean()) as any;
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    ensureCanAccessThread(actor, thread);

    const messages = (await SupportMessageModel.find({ threadId })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean()) as any[];

    if (actor.role === "admin") {
      await Promise.all([
        SupportThreadModel.updateOne({ _id: threadId }, { $set: { unreadForAdmin: 0 } }),
        SupportMessageModel.updateMany({ threadId, readByAdmin: false }, { $set: { readByAdmin: true } })
      ]);
    } else {
      await Promise.all([
        SupportThreadModel.updateOne({ _id: threadId }, { $set: { unreadForUser: 0 } }),
        SupportMessageModel.updateMany({ threadId, readByUser: false }, { $set: { readByUser: true } })
      ]);
    }

    res.json({
      items: messages.map(messageToDto)
    });
  })
);

router.post(
  "/threads/:id/messages",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const threadId = z.string().min(8).parse(req.params.id);
    const body = sendMessageSchema.parse(req.body);

    const thread = (await SupportThreadModel.findById(threadId).lean()) as any;
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    ensureCanAccessThread(actor, thread);

    const isAdminSender = actor.role === "admin";
    const message = await SupportMessageModel.create({
      threadId,
      senderId: actor.id,
      senderRole: actor.role,
      body: body.body.trim(),
      readByAdmin: isAdminSender,
      readByUser: !isAdminSender
    });

    const threadSet: Record<string, unknown> = {
      lastMessageAt: new Date(),
      lastMessagePreview: body.body.trim().slice(0, 300),
      ...(isAdminSender ? { unreadForAdmin: 0 } : { unreadForUser: 0 })
    };

    await SupportThreadModel.updateOne(
      { _id: threadId },
      {
        $set: threadSet,
        $inc: isAdminSender ? { unreadForUser: 1 } : { unreadForAdmin: 1 }
      }
    );

    const updatedThread = (await SupportThreadModel.findById(threadId).lean()) as any;

    res.status(201).json({
      thread: threadToDto(updatedThread),
      message: messageToDto(message.toObject())
    });
  })
);

router.post(
  "/threads/:id/read",
  requireAuth(["user", "station_manager", "admin"]),
  asyncHandler(async (req, res) => {
    const actor = req.user;
    if (!actor) {
      throw new HttpError(401, "Unauthorized");
    }

    const threadId = z.string().min(8).parse(req.params.id);
    const thread = (await SupportThreadModel.findById(threadId).lean()) as any;
    if (!thread) {
      throw new HttpError(404, "Thread not found");
    }
    ensureCanAccessThread(actor, thread);

    if (actor.role === "admin") {
      await Promise.all([
        SupportThreadModel.updateOne({ _id: threadId }, { $set: { unreadForAdmin: 0 } }),
        SupportMessageModel.updateMany({ threadId, readByAdmin: false }, { $set: { readByAdmin: true } })
      ]);
    } else {
      await Promise.all([
        SupportThreadModel.updateOne({ _id: threadId }, { $set: { unreadForUser: 0 } }),
        SupportMessageModel.updateMany({ threadId, readByUser: false }, { $set: { readByUser: true } })
      ]);
    }

    res.json({ ok: true });
  })
);

export const supportRouter = router;
