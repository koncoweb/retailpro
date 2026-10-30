import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { QUICK, replyTo } from "@/lib/chat";
import { useCatalog } from "@/lib/catalog";
import { SHOP, waLink } from "@/lib/shop";
import { useShop } from "@/lib/store";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/chat")({ component: ChatPage });

function ChatPage() {
  const chat = useShop((s) => s.chat);
  const pushChat = useShop((s) => s.pushChat);
  const { state } = useCatalog();
  const products = state.status === "ready" ? state.catalog.products : [];
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length]);

  function send(raw: string) {
    const t = raw.trim();
    if (!t) return;
    pushChat("user", t);
    setText("");
    window.setTimeout(() => pushChat("cs", replyTo(t, products)), 420);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
        <LogoMark className="size-10" />
        <div>
          <p className="text-[15px] font-medium">CS Thalia</p>
          <p className="text-[12px] text-muted">Online · {SHOP.hours}</p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {chat.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[80%] rounded-[18px] px-3.5 py-2.5 text-[14px] leading-relaxed",
                m.from === "user"
                  ? "rounded-br-md bg-primary text-primary-fg"
                  : "rounded-bl-md bg-surface text-fg shadow-[var(--shadow-border)]",
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="shrink-0 border-t border-line px-3 pt-3 pb-3">
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="h-8 shrink-0 rounded-full bg-surface px-3 text-[12px] text-fg shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tulis pesan…"
            className="h-11 flex-1 rounded-full bg-surface px-4 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] outline-none placeholder:text-subtle"
          />
          <button
            type="submit"
            aria-label="Kirim"
            className="grid size-11 place-items-center rounded-full bg-primary text-primary-fg"
          >
            <Send className="size-4" strokeWidth={1.75} />
          </button>
        </form>
        <a
          href={waLink("Halo Thalia, saya ingin tanya bahan kue.")}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center text-[12px] text-muted"
        >
          Lanjutkan di WhatsApp
        </a>
      </div>
    </div>
  );
}
