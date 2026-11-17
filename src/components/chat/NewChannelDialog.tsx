import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { searchUsers } from "@/lib/chat";
import { normalizeChannelName } from "@/lib/chat";
import { useCreateChannel } from "@/hooks/use-chat";

interface NewChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (conversationId: string) => void;
}

/**
 * Create a channel and seed its membership.
 *
 * The name is previewed through the same `normalizeChannelName` the write uses,
 * so what the form shows is what actually gets stored (a duplicate reads back as
 * an error from the unique index rather than silently making a second channel).
 * The creator joins automatically, so they are excluded from the picker.
 */
export function NewChannelDialog({ open, onOpenChange, onCreated }: NewChannelDialogProps) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ id: string; label: string }[]>([]);

  const create = useCreateChannel();
  const slug = normalizeChannelName(name);

  const results = useQuery({
    queryKey: ["chat", "user-search", query],
    enabled: open && query.trim().length > 0,
    queryFn: () => searchUsers(query),
    staleTime: 30_000,
  });

  const reset = () => {
    setName("");
    setTopic("");
    setIsPrivate(false);
    setQuery("");
    setPicked([]);
  };

  const togglePicked = (id: string, label: string) =>
    setPicked((prev) =>
      prev.some((p) => p.id === id) ? prev.filter((p) => p.id !== id) : [...prev, { id, label }]
    );

  const submit = async () => {
    if (!slug) {
      toast.error("Nama channel tidak valid.");
      return;
    }
    try {
      const id = await create.mutateAsync({
        name,
        topic: topic.trim() || undefined,
        isPrivate,
        memberIds: picked.map((p) => p.id),
      });
      onCreated(id);
      reset();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(/unique/i.test(message) ? "Nama channel sudah dipakai." : "Gagal membuat channel.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Channel baru</DialogTitle>
          <DialogDescription>
            Percakapan bergrup untuk satu topik, misalnya #operasional-toko.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="channel-name">Nama</Label>
            <Input
              id="channel-name"
              value={name}
              placeholder="operasional-toko"
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {slug ? `Tersimpan sebagai #${slug}` : "Gunakan huruf, angka, atau tanda hubung."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="channel-topic">Topik (opsional)</Label>
            <Input
              id="channel-topic"
              value={topic}
              placeholder="Untuk apa channel ini?"
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="channel-private">Channel privat</Label>
              <p className="text-xs text-muted-foreground">Hanya anggota yang bisa melihatnya.</p>
            </div>
            <Switch id="channel-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>

          <div className="space-y-1.5">
            <Label>Tambahkan anggota</Label>
            <div className="relative">
              <Input
                value={query}
                placeholder="Cari nama atau email…"
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && results.isLoading && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            {picked.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {picked.map((p) => (
                  <Badge key={p.id} variant="secondary" className="gap-1 pr-1">
                    {p.label}
                    <button
                      type="button"
                      onClick={() => togglePicked(p.id, p.label)}
                      className="rounded-full p-0.5 hover:bg-background/60"
                      aria-label={`Hapus ${p.label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {query && (results.data?.length ?? 0) > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {results.data!.map((s) => {
                  const chosen = picked.some((p) => p.id === s.entity_id);
                  return (
                    <button
                      key={s.entity_id}
                      type="button"
                      onClick={() => togglePicked(s.entity_id, s.label)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <span className="min-w-0 truncate">{s.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{s.sublabel}</span>
                      {chosen && <Plus className="h-3.5 w-3.5 rotate-45 text-primary" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={submit} disabled={create.isPending || !slug}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Buat channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
