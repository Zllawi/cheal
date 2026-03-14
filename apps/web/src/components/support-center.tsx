"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Search } from "lucide-react";
import {
  createSupportThread,
  fetchMe,
  fetchSupportMessages,
  fetchSupportThreads,
  markSupportThreadRead,
  sendSupportMessage
} from "./api";
import type { AuthUserProfile, SupportMessage, SupportThread } from "./types";

export function SupportCenter() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<AuthUserProfile | null>(null);
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [subject, setSubject] = useState("");
  const [compose, setCompose] = useState("");
  const [readFilter, setReadFilter] = useState<"all" | "read" | "unread">("all");
  const [search, setSearch] = useState("");
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("يمكنك التواصل مباشرة مع إدارة النظام من هنا.");

  const isAdmin = me?.role === "admin";
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId]
  );

  const loadThreads = useCallback(async () => {
    if (!token || !me) {
      return;
    }

    setLoadingThreads(true);
    try {
      const list = await fetchSupportThreads(
        token,
        isAdmin
          ? {
              admin: true,
              read: readFilter,
              search
            }
          : undefined
      );
      setThreads(list);
      if (!selectedThreadId && list.length > 0) {
        setSelectedThreadId(list[0].id);
      } else if (selectedThreadId && !list.some((thread) => thread.id === selectedThreadId)) {
        setSelectedThreadId(list[0]?.id ?? null);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل المحادثات");
    } finally {
      setLoadingThreads(false);
    }
  }, [token, me, isAdmin, readFilter, search, selectedThreadId]);

  const loadMessages = useCallback(async () => {
    if (!token || !selectedThreadId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    try {
      const items = await fetchSupportMessages(token, selectedThreadId);
      setMessages(items);
      await markSupportThreadRead(token, selectedThreadId).catch(() => null);
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === selectedThreadId
            ? {
                ...thread,
                unreadForAdmin: isAdmin ? 0 : thread.unreadForAdmin,
                unreadForUser: isAdmin ? thread.unreadForUser : 0
              }
            : thread
        )
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر تحميل الرسائل");
    } finally {
      setLoadingMessages(false);
    }
  }, [isAdmin, selectedThreadId, token]);

  useEffect(() => {
    const stored = window.localStorage.getItem("fuelmap_token");
    if (!stored) {
      return;
    }
    setToken(stored);
    void fetchMe(stored)
      .then(setMe)
      .catch(() => {
        window.localStorage.removeItem("fuelmap_token");
        setToken(null);
        setMe(null);
      });
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!token || !me) {
      return;
    }
    const timer = setInterval(() => {
      void loadThreads();
    }, 15000);
    return () => clearInterval(timer);
  }, [token, me, loadThreads]);

  async function handleSend(): Promise<void> {
    if (!token || !me || !compose.trim()) {
      return;
    }

    setSending(true);
    try {
      if (!selectedThreadId) {
        if (isAdmin) {
          setNotice("اختر محادثة من القائمة أولًا.");
          return;
        }

        const created = await createSupportThread(token, {
          subject: subject.trim() || undefined,
          message: compose.trim()
        });

        setThreads((prev) => [created.thread, ...prev.filter((thread) => thread.id !== created.thread.id)]);
        setSelectedThreadId(created.thread.id);
        setMessages([created.message]);
        setCompose("");
        setSubject("");
        setNotice("تم إنشاء المحادثة وإرسال الرسالة.");
      } else {
        const sent = await sendSupportMessage(token, selectedThreadId, compose.trim());
        setMessages((prev) => [...prev, sent]);
        setCompose("");
        await loadThreads();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "تعذر إرسال الرسالة");
    } finally {
      setSending(false);
    }
  }

  if (!token || !me) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white/80 p-6 shadow-md">
        <h2 className="text-2xl font-bold text-brand-900">التواصل</h2>
        <p className="mt-2 text-sm text-black/70">
          يلزم تسجيل الدخول أولًا لإرسال الرسائل. سجّل الدخول من تبويب خريطة الوقود ثم ارجع إلى هنا.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-md backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-brand-900">قسم التواصل</h2>
            <p className="text-sm text-black/70">
              {isAdmin
                ? "لوحة مدير النظام: راجع المحادثات وفرزها حسب الحالة."
                : "تواصل مع إدارة النظام مباشرة لأي مشكلة أو اقتراح."}
            </p>
          </div>

          <div className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs">
            <MessageCircle size={14} />
            {me.fullName || "مستخدم"} | {isAdmin ? "مدير النظام" : "مستخدم"}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[330px_1fr]">
        <aside className="space-y-3 rounded-2xl border border-black/10 bg-white/80 p-3 shadow-md">
          {isAdmin ? (
            <div className="grid grid-cols-1 gap-2">
              <select
                value={readFilter}
                onChange={(event) => setReadFilter(event.target.value as "all" | "read" | "unread")}
                className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              >
                <option value="all">كل المحادثات</option>
                <option value="unread">غير المقروءة</option>
                <option value="read">المقروءة</option>
              </select>

              <div className="relative">
                <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black/45" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="بحث باسم أو رقم"
                  className="w-full rounded-lg border border-black/15 bg-white px-9 py-2 text-sm"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-black/10 bg-white/70 p-2">
              <label className="text-xs text-black/60">عنوان المحادثة (اختياري)</label>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="مثال: مشكلة تحديث محطة"
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadThreads()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-700 px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50"
          >
            <RefreshCw size={14} />
            تحديث القائمة
          </button>

          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {loadingThreads ? (
              <div className="rounded-lg border border-black/10 bg-white p-3 text-center text-xs text-black/60">
                جاري تحميل المحادثات...
              </div>
            ) : threads.length === 0 ? (
              <div className="rounded-lg border border-black/10 bg-white p-3 text-center text-xs text-black/60">
                لا توجد محادثات بعد.
              </div>
            ) : (
              threads.map((thread) => {
                const unread = isAdmin ? thread.unreadForAdmin : thread.unreadForUser;
                const isSelected = thread.id === selectedThreadId;
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelectedThreadId(thread.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-right text-sm shadow-sm ${
                      isSelected ? "border-brand-700 bg-brand-50" : "border-black/10 bg-white hover:bg-black/[0.02]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate font-semibold">{thread.user.fullName}</div>
                      {unread > 0 ? (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                          {unread}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-black/70">{thread.subject || "بدون عنوان"}</div>
                    <div className="mt-1 truncate text-xs text-black/55">{thread.lastMessagePreview || "..."}</div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-md">
          {!selectedThread ? (
            <div className="rounded-xl border border-dashed border-black/15 bg-white/70 p-6 text-center text-sm text-black/65">
              {isAdmin ? "اختر محادثة من القائمة لمراجعة الرسائل." : "اكتب رسالة في الصندوق بالأسفل لبدء محادثة."}
            </div>
          ) : (
            <>
              <div className="mb-3 rounded-xl border border-black/10 bg-white/70 p-3">
                <div className="text-sm font-semibold">{selectedThread.user.fullName}</div>
                <div className="text-xs text-black/60">
                  {selectedThread.user.phoneE164 || "لا يوجد رقم"} | {selectedThread.subject || "بدون عنوان"}
                </div>
              </div>

              <div className="mb-3 h-[320px] space-y-2 overflow-y-auto rounded-xl border border-black/10 bg-white/70 p-3">
                {loadingMessages ? (
                  <div className="flex items-center justify-center text-sm text-black/60">
                    <Loader2 size={14} className="ml-2 animate-spin" />
                    جاري تحميل الرسائل...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-black/60">لا توجد رسائل بعد.</div>
                ) : (
                  messages.map((message) => {
                    const mine = message.senderId === me.id;
                    return (
                      <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[78%] rounded-xl px-3 py-2 text-sm shadow-sm ${
                            mine ? "bg-brand-800 text-white" : "bg-white border border-black/10 text-black/85"
                          }`}
                        >
                          <div>{message.body}</div>
                          <div className={`mt-1 text-[10px] ${mine ? "text-white/80" : "text-black/45"}`}>
                            {new Intl.DateTimeFormat("ar-LY", {
                              dateStyle: "short",
                              timeStyle: "short"
                            }).format(new Date(message.createdAt))}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          <div className="space-y-2">
            <textarea
              value={compose}
              onChange={(event) => setCompose(event.target.value)}
              placeholder="اكتب رسالتك هنا..."
              rows={4}
              className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm shadow-sm"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-black/60">{notice}</p>
              <button
                type="button"
                disabled={sending || !compose.trim()}
                onClick={() => void handleSend()}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                إرسال
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
