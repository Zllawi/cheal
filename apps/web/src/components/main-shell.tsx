"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Fuel, Info, MessageCircle, Route } from "lucide-react";
import { FuelDashboard } from "./fuel-dashboard";
import { GasDashboard } from "./gas-dashboard";
import { SupportCenter } from "./support-center";
import { fetchSupportThreads } from "./api";
import type { SupportThread } from "./types";

type MainTab = "fuel" | "gas" | "support" | "about";

export function MainShell() {
  const [activeTab, setActiveTab] = useState<MainTab>("fuel");
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);

  const refreshSupportUnread = useCallback(async () => {
    const token = window.localStorage.getItem("fuelmap_token");
    if (!token) {
      setSupportUnreadCount(0);
      return;
    }

    try {
      let threads: SupportThread[] = [];
      let adminView = false;

      try {
        threads = await fetchSupportThreads(token, { admin: true, read: "unread" });
        adminView = true;
      } catch {
        threads = await fetchSupportThreads(token);
      }

      const unreadCount = threads.reduce(
        (sum, thread) => sum + (adminView ? thread.unreadForAdmin : thread.unreadForUser),
        0
      );
      setSupportUnreadCount(unreadCount);
    } catch {
      setSupportUnreadCount(0);
    }
  }, []);

  useEffect(() => {
    void refreshSupportUnread();

    const timer = setInterval(() => {
      void refreshSupportUnread();
    }, 15000);

    const onFocus = () => {
      void refreshSupportUnread();
    };

    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSupportUnread]);

  useEffect(() => {
    if (activeTab === "support") {
      void refreshSupportUnread();
    }
  }, [activeTab, refreshSupportUnread]);

  const tabs = useMemo(
    () => [
      { id: "fuel" as const, title: "خريطة الوقود", icon: Fuel },
      { id: "gas" as const, title: "تواجد الغاز", icon: Route },
      { id: "support" as const, title: "التواصل", icon: MessageCircle },
      { id: "about" as const, title: "من نحن", icon: Info }
    ],
    []
  );

  return (
    <div className="space-y-4">
      <header className="sticky top-2 z-[1200] rounded-2xl border border-black/10 bg-white/90 p-2 shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-brand-800 text-white shadow"
                      : "bg-white text-black/75 hover:bg-black/[0.04] border border-black/10"
                  }`}
                >
                  <Icon size={16} />
                  {tab.title}
                  {tab.id === "support" && supportUnreadCount > 0 ? (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                        active ? "bg-white/90 text-brand-900" : "bg-red-600 text-white"
                      }`}
                    >
                      {formatBadgeCount(supportUnreadCount)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setActiveTab("support")}
            className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-black/80 hover:bg-black/[0.04]"
            title="الإشعارات"
            aria-label="الإشعارات"
          >
            <span className="relative inline-flex">
              <Bell size={16} />
              {supportUnreadCount > 0 ? (
                <span className="absolute -left-2 -top-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {formatBadgeCount(supportUnreadCount)}
                </span>
              ) : null}
            </span>
            الإشعارات
          </button>
        </div>
      </header>

      {activeTab === "fuel" ? <FuelDashboard /> : null}
      {activeTab === "gas" ? <GasDashboard /> : null}
      {activeTab === "support" ? <SupportCenter /> : null}
      {activeTab === "about" ? <AboutSection /> : null}
    </div>
  );
}

function formatBadgeCount(value: number): string {
  if (value > 99) {
    return "99+";
  }
  return String(value);
}

function AboutSection() {
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-black/10 bg-white/85 p-6 shadow-md">
        <h2 className="text-2xl font-bold text-brand-900">من نحن</h2>
        <p className="mt-2 text-sm leading-7 text-black/75">
          منصة FuelMap ليبيا مشروع تقني مجتمعي يهدف لتسهيل وصول المواطنين إلى معلومات توفر الوقود والغاز بطريقة
          واضحة وسريعة، وتقليل الازدحام عبر بيانات محدثة وقابلة للتوسع مستقبلًا لتطبيقات الهواتف.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <InfoCard
          title="رؤيتنا"
          body="تجربة يومية أبسط للمستخدم عبر خريطة موحدة للوقود والغاز، مع تحديثات موثوقة مدعومة بالمجتمع."
        />
        <InfoCard
          title="قيمة المنصة"
          body="المساعدة في اتخاذ قرار أسرع: أين أذهب الآن؟ وأي محطة أقل ازدحامًا وأكثر مناسبة لاحتياجي."
        />
        <InfoCard
          title="المرحلة القادمة"
          body="تهيئة كاملة لإطلاق تطبيق Android و iOS مع نفس الـAPI، وإضافة إشعارات ذكية وتحليلات تشغيلية."
        />
      </div>
    </section>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-md">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-black/70">{body}</p>
    </article>
  );
}
